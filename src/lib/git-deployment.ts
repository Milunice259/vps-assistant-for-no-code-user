import { createHash } from "node:crypto";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";
import { checked, quote, type DeployRunner, type DockerInput } from "./deploy-preflight";
import { composePreflight, deployCompose, composeRollbackPreview, rollbackCompose } from "./compose-deployment";
import { deployGit, type GitDeployInput, type GitSource } from "./ssh/deploy";
import { readDeploymentDefinition, deploymentFail as fail } from "./deployment-state";

const key = (id: string) => "git-source:v1:" + id;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type SourceRecord = { source: GitSource; assetsDigest: string; original: GitSource; previous: GitSource | null; pending: boolean };
type GitComposeInput = GitDeployInput & { compose: DockerInput; revision?: string };

export async function readGitSource(id: string, serverId: string): Promise<SourceRecord | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) fail("Invalid Git deployment identity",400);
  const row = await prisma.appSetting.findUnique({where:{key:key(id)}});
  if (!row) return null;
  try {
    if (!row.value.startsWith("enc:v1:")) throw Error();
    const record:SourceRecord = JSON.parse(decrypt(row.value.slice(7)));
    if (record.source.serverId !== serverId || !/^[a-f0-9]{40}$/.test(record.source.commitHash) || !/^[a-f0-9]{64}$/.test(record.assetsDigest) || typeof record.pending !== "boolean") throw Error();
    return record;
  } catch { fail("Encrypted Git source is unavailable or target differs",422); }
}

// Adapt the pinned target-side checkout to canonical reviewed Compose assets.
// ponytail: text assets <=2 MiB; binary/dotfile contexts need a reviewed archive API, not a raw compose bypass.
async function assets(run:DeployRunner, input:GitComposeInput, source:GitSource) {
  if (!input.sourcePath || input.compose.type !== "compose" || input.compose.projectPath !== source.customPath || (input.compose.serverId || "local") !== source.serverId) fail("Git and Compose targets must match",400);
  if (input.envVars) fail("Use explicit reviewed Compose environment; implicit .env files are not supported",400);
  const raw = Buffer.from(await checked(run,`git -C ${quote(input.sourcePath)} ls-files -s -z | base64 -w0`),"base64").toString();
  const files:Record<string,string> = Object.create(null);
  let bytes = 0;
  const entries = raw.split("\0").filter(Boolean);
  if (!entries.length || entries.length > 2048) fail("Unsupported Git source asset count",400);
  for (const entry of entries) {
    const match = entry.match(/^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/);
    if (!match || !/^[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(match[3]) || match[3].split("/").some(p=>!p || p === ".." || p.startsWith("."))) fail("Git source requires regular reviewed files without symlinks, submodules or hidden paths",400);
    const name = match[3], target = input.sourcePath + "/" + name;
    const size = await checked(run,`test -f ${quote(target)} && test ! -L ${quote(target)} && stat -c %s ${quote(target)}`);
    if (!/^\d+$/.test(size) || (bytes += Number(size)) > 2_000_000) fail("Git build assets exceed the reviewed text limit",400);
    const buffer = Buffer.from(await checked(run,`base64 -w0 ${quote(target)}`),"base64");
    const value = buffer.toString("utf8");
    if (buffer.length !== Number(size) || value.includes("\0") || !buffer.equals(Buffer.from(value))) fail("Binary Git assets require an explicit archive capability",400);
    files[name] = value;
  }
  const candidates = ["compose.yaml","compose.yml","docker-compose.yaml","docker-compose.yml"].filter(name=>Object.hasOwn(files,name));
  if (!input.compose.composeContent && candidates.length !== 1) fail("Supply an explicit reviewed Compose definition or exactly one repository Compose file",400);
  const content = input.compose.composeContent || files[candidates[0]];
  // docker-compose.yml is the canonical service's managed definition, not a second asset.
  delete files["docker-compose.yml"];
  const body:DockerInput = {...input.compose,composeContent:content,composeFiles:files};
  if (input.composeDeploymentId) {
    if (body.composeMode !== "update" || body.composeDeploymentId !== input.composeDeploymentId) fail("Git updates must reference the same managed Compose deployment",400);
  } else if (body.composeMode === "update") fail("Managed Git source identity is required",400);
  return {body,assetsDigest:digest([content,files])};
}

export async function gitComposePreflight(run:DeployRunner,input:GitComposeInput) {
  let plan:Awaited<ReturnType<typeof composePreflight>> | undefined;
  let assetsDigest = "";
  const result = await deployGit(run,input,async(r,staged,source)=>{
    const adapted = await assets(r,{...input,...staged},source);
    assetsDigest = adapted.assetsDigest;
    plan = await composePreflight(r,adapted.body,source.serverId);
    return {success:false,status:"UNVERIFIED",logs:"Read-only Git/Compose preview; no runtime mutation"};
  });
  return {...plan!,commitHash:result.commitHash,expectedCommit:result.source.originalCommit,revision:digest([result.source,assetsDigest,plan!.revision]),composeRevision:plan!.revision};
}

export async function deployGitCompose(run:DeployRunner,input:GitComposeInput,deploymentId:string,suppliedApi?:Parameters<typeof deployCompose>[4]) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(deploymentId) || !/^[a-f0-9]{64}$/.test(input.revision || "")) fail("Git execution requires an exact reviewed revision and deployment identity",400);
  const log = await prisma.deploymentLog.findUnique({where:{id:deploymentId},select:{serverId:true}});
  if (!log || (log.serverId || "local") !== (input.serverId || "local")) fail("Git deployment target binding changed");
  return deployGit(run,input,async(r,staged,source)=>{
    const adapted = await assets(r,{...input,...staged},source);
    const plan = await composePreflight(r,adapted.body,source.serverId);
    if (digest([source,adapted.assetsDigest,plan.revision]) !== input.revision) fail("Git/Compose preview changed; review again");
    const prior = input.composeDeploymentId ? await readGitSource(input.composeDeploymentId,source.serverId) : null;
    if (input.composeDeploymentId && (!prior || prior.pending || prior.source.commitHash !== source.originalCommit)) fail("Managed Git original changed or is pending");
    const record:SourceRecord = {source,assetsDigest:adapted.assetsDigest,original:prior?.original || source,previous:prior?.source || null,pending:true};
    const value = "enc:v1:" + encrypt(JSON.stringify(record));
    // Durable authenticated source baseline precedes any canonical runtime/file mutation.
    try { await prisma.appSetting.create({data:{key:key(deploymentId),value}}); } catch {fail("Git source baseline already exists or could not be persisted");}
    const baseline = await prisma.appSetting.findUnique({where:{key:key(deploymentId)}});
    if (baseline?.value !== value) fail("Git source baseline readback failed");
    const result = await deployCompose(r,{...adapted.body,composeRevision:plan.revision},source.serverId,deploymentId,suppliedApi);
    const saved = await readDeploymentDefinition(deploymentId);
    if (!saved || saved.state.pending || saved.state.serverId !== source.serverId || digest([saved.state.definition.submittedContent,saved.state.definition.files]) !== adapted.assetsDigest) fail("Git/Compose committed definition readback failed");
    const next = "enc:v1:" + encrypt(JSON.stringify({...record,pending:false}));
    if ((await prisma.appSetting.updateMany({where:{key:key(deploymentId),value},data:{value:next}})).count !== 1) fail("Git source commit changed");
    if ((await prisma.appSetting.findUnique({where:{key:key(deploymentId)}}))?.value !== next) fail("Git source commit readback failed");
    return {success:result.status === "RUNNING",status:result.status,logs:"Canonical Compose deployment verified; source commit pinned. Data/schema/bind/volume contents are not restored by rollback."};
  });
}

export async function gitRollbackPreview(run:DeployRunner,id:string,serverId:string) {
  const source = await readGitSource(id,serverId);
  if (!source || source.pending || !source.previous) fail("No verified earlier Git source is retained");
  const plan = await composeRollbackPreview(run,id,serverId);
  return {...plan,revision:digest([source,plan.revision]),composeRevision:plan.revision,commitHash:source.previous.commitHash};
}
export async function rollbackGitCompose(run:DeployRunner,api:Parameters<typeof rollbackCompose>[1],id:string,serverId:string,input:Parameters<typeof rollbackCompose>[4]) {
  const preview = await gitRollbackPreview(run,id,serverId);
  if (input.revision !== preview.revision || input.confirmation !== preview.confirmation || input.writableLayerLoss !== true || !["unchanged","operator-confirmed"].includes(input.dataCompatibility) || !["unchanged","operator-confirmed"].includes(input.schemaCompatibility)) fail("Git rollback requires exact preview, writable layer loss consent and compatibility acknowledgments",400);
  const row = await prisma.appSetting.findUnique({where:{key:key(id)}});
  const source = await readGitSource(id,serverId);
  if (!row || !source?.previous) fail("Git rollback source disappeared");
  const pending = "enc:v1:" + encrypt(JSON.stringify({...source,pending:true}));
  if ((await prisma.appSetting.updateMany({where:{key:key(id),value:row.value},data:{value:pending}})).count !== 1) fail("Git source changed");
  const result = await rollbackCompose(run,api,id,serverId,{...input,revision:preview.composeRevision});
  const restored = await readDeploymentDefinition(id);
  if (!restored || restored.state.pending) fail("Git rollback definition readback failed");
  const next = "enc:v1:" + encrypt(JSON.stringify({...source,source:source.previous,previous:null,assetsDigest:digest([restored.state.definition.content,restored.state.definition.files]),pending:false}));
  if ((await prisma.appSetting.updateMany({where:{key:key(id),value:pending},data:{value:next}})).count !== 1) fail("Git rollback source commit changed");
  if ((await prisma.appSetting.findUnique({where:{key:key(id)}}))?.value !== next) fail("Git rollback source readback failed");
  return {...result,commitHash:source.previous.commitHash};
}
