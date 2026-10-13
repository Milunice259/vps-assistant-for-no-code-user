import yaml from "js-yaml";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { prisma } from "./db";
import { checked, quote, projectName, resourcePreflight, readiness, validateDockerDeploy, type DeployRunner, type DockerInput } from "./deploy-preflight";
import { configurationHash as hash, createPayload, engine } from "./container-recreate";
import { readDeploymentDefinition, saveDeploymentDefinition, sealDeployment, deploymentFail as fail, type DeploymentState, type Native } from "./deployment-state";
import { validateDockerImage } from "./validation";

type API = Pick<Awaited<ReturnType<typeof engine>>, "call">;
const nameOK = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(v);
const relative = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(v) && v.split("/").every(p => p && p !== "." && p !== "..");
const absolute = (v: unknown): v is string => typeof v === "string" && /^\/[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(v) && v.slice(1).split("/").every(p => p && p !== "." && p !== "..") && !/^\/(?:etc|proc|sys|dev|root|boot|usr|bin|sbin|lib|lib64)(?:\/|$)/.test(v);
const sorted = (v: string[]) => [...v].sort();
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const encode = (v: string) => quote(Buffer.from(v).toString("base64"));
const decode = (v: string) => `printf %s ${encode(v)} | base64 -d`;
const scope = "Recreated container definition and pinned images only; original writable layers are lost on update and rollback. Anonymous volumes remain pinned; database, schema, bind and volume contents are not restored";
const activeOperations = new Set<string>();
const lossConsent = (body: DockerInput) => (body.composeConsent as unknown as {writableLayerLoss?: boolean})?.writableLayerLoss;

type ComposeVersion = { content: string; files: Record<string,string>; containers: Native[]; resources?: unknown[]; images: Array<{ id:string; repoDigests:string[] }> };
type Definition = { kind: "compose"; project: string; path: string; owner: string; submittedContent?: string; content: string; files: Record<string,string>; original?: ComposeVersion; previous?: ComposeVersion; retainedIds?: string[] };

export function validateComposeAssets(body: DockerInput, doc: Record<string, unknown>): string | null {
  if (!absolute(body.projectPath)) return "Use a dedicated absolute project directory without traversal";
  if (Object.keys(doc).some(k => !["version", "services", "volumes", "networks"].includes(k))) return "Overrides, includes and file secrets are not supported";
  if (body.composeMode !== undefined && !["create", "update"].includes(body.composeMode)) return "Invalid Compose mode";
  if (body.composeDeploymentId !== undefined && (typeof body.composeDeploymentId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.composeDeploymentId))) return "Invalid deployment identity";
  if (body.composeRevision !== undefined && (typeof body.composeRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.composeRevision))) return "Invalid preview revision";
  if (body.composeConsent !== undefined && (!body.composeConsent || typeof body.composeConsent !== "object" || Array.isArray(body.composeConsent) || Object.keys(body.composeConsent).some(k => !["directory", "builds", "foreignBinds", "externalVolumes", "externalNetworks", "recreate", "writableLayerLoss"].includes(k)))) return "Invalid reviewed consent";
  if (body.composeConsent?.directory !== undefined && typeof body.composeConsent.directory !== "string" || body.composeConsent?.recreate !== undefined && typeof body.composeConsent.recreate !== "boolean") return "Invalid reviewed consent";
  for (const key of ["builds", "foreignBinds", "externalVolumes", "externalNetworks"] as const) if (body.composeConsent?.[key] !== undefined && (!Array.isArray(body.composeConsent[key]) || body.composeConsent[key]!.some(v => typeof v !== "string"))) return "Invalid reviewed consent";
  if (body.composeMode === "update" && !body.composeDeploymentId) return "Managed update requires a deployment identity";
  const files = body.composeFiles || {};
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.entries(files).some(([k,v]) => !relative(k) || k.split("/").some(p => p.startsWith(".")) || k === "docker-compose.yml" || typeof v !== "string" || v.includes("\0")) || JSON.stringify(files).length > 2_000_000) return "Invalid build assets";
  for (const [name, raw] of Object.entries(doc.services as Record<string, Native>)) {
    if (!nameOK(name) || raw.image === undefined && raw.build === undefined || raw.image !== undefined && !validateDockerImage(raw.image).valid || "env_file" in raw) return "Use valid images/builds without env_file";
    if (raw.container_name !== undefined && !nameOK(raw.container_name)) return "Invalid container name";
    if (raw.deploy !== undefined && (!raw.deploy || typeof raw.deploy !== "object" || raw.deploy.replicas !== undefined && raw.deploy.replicas !== 1)) return "Only single-container services are supported";
    if (raw.labels && (Array.isArray(raw.labels) || typeof raw.labels !== "object" || Object.keys(raw.labels).some(k => k.startsWith("com.docker.compose.") || k.startsWith("vps-panel.")))) return "Reserved labels cannot be overridden";
    if (raw.build !== undefined) {
      const b = typeof raw.build === "string" ? {context:raw.build} : raw.build;
      if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k => !["context", "dockerfile", "args", "target"].includes(k)) || !(b.context === "." || typeof b.context === "string" && b.context.startsWith("./") && relative(b.context.slice(2))) || b.dockerfile !== undefined && !relative(b.dockerfile)) return "Build requires a reviewed local context and Dockerfile";
      const dockerfile = posix.join(b.context, b.dockerfile || "Dockerfile").replace(/^\.\//, "");
      if (!Object.hasOwn(files, dockerfile)) return "Supply the reviewed Dockerfile and context assets";
    }
    for (const v of raw.volumes || []) {
      const type = typeof v === "string" ? v.startsWith("/") ? "bind" : "volume" : v.type;
      const source = typeof v === "string" ? v.split(":")[0] : v.source;
      if (!["bind", "volume"].includes(type) || (type === "bind" ? !absolute(source) || /^\/(?:var\/(?:run|lib\/docker)|run|opt\/(?:vps-panel|chatBot|Gooffi))(?:\/|$)/.test(source) : !nameOK(source)) || typeof v === "string" && v.split(":").length < 2) return "Use explicit named volumes or reviewed absolute binds";
    }
  }
  for (const kind of ["volumes", "networks"]) {
    const resources = doc[kind];
    if (resources !== undefined && (!resources || typeof resources !== "object" || Array.isArray(resources))) return "Invalid resources";
    for (const [name,r] of Object.entries((resources || {}) as Record<string, Native>)) {
      if (!nameOK(name) || r !== null && (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !["name", "external"].includes(k)) || r.external !== undefined && typeof r.external !== "boolean" || r.name !== undefined && !nameOK(r.name) || r.name && !r.external)) return "Use default owned or explicitly external resources";
    }
  }
  if (lossConsent(body) !== undefined && typeof lossConsent(body) !== "boolean") return "Invalid writable-layer consent";
  return null;
}

// Resolve every existing path component: no symlink destination/ancestor or implicit bind creation.
async function pathCheck(run: DeployRunner, path: string, mustExist = false) {
  let cursor = "";
  const commands: string[] = [];
  for (const part of path.slice(1).split("/")) { cursor += "/" + part; commands.push(`test ! -L ${quote(cursor)}`); }
  if (mustExist) commands.push(`test -e ${quote(path)}`);
  await checked(run, commands.join(" && "));
}
function compose(body: DockerInput, content = body.composeContent!) {
  return `${decode(content)} | env -i PATH="$PATH" HOME=/nonexistent docker compose --env-file /dev/null --project-directory ${quote(body.projectPath!)} -p ${quote(projectName(body))} -f -`;
}
async function inventory(run: DeployRunner, project: string): Promise<Native[]> {
  const ids = (await checked(run, `docker ps -aq --no-trunc --filter ${quote(`label=com.docker.compose.project=${project}`)}`)).split(/\s+/).filter(Boolean);
  if (ids.some(id => !/^[a-f0-9]{64}$/.test(id))) fail("Compose inventory is invalid");
  const rows:Native[] = ids.length ? JSON.parse(await checked(run, `docker inspect ${ids.map(quote).join(" ")}`)) : [];
  return rows.filter(c=>!c.Config.Labels?.["vps-panel.retained"]);
}
function identity(rows: Native[]) {
  return rows.map(c => ({id:c.Id,name:c.Name,image:c.Image,config:c.Config,host:c.HostConfig,mounts:[...c.Mounts].sort((a,b)=>a.Destination.localeCompare(b.Destination)),networks:c.NetworkSettings.Networks,running:c.State.Running})).sort((a,b)=>a.id.localeCompare(b.id));
}
async function managed(id: string, serverId: string) {
  const saved = await readDeploymentDefinition(id);
  if (!saved || saved.state.serverId !== serverId || saved.state.definition.kind !== "compose" || saved.state.pending) fail("Managed Compose definition is unavailable, target differs or an operation is pending");
  return saved;
}
export async function composePreflight(run: DeployRunner, body: DockerInput, serverId = body.serverId || "local") {
  const invalid = validateDockerDeploy(body); if (invalid) fail(invalid,400);
  const project = projectName(body);
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project)) fail("Invalid project name",400);
  await pathCheck(run, body.projectPath!);
  const exists = await checked(run, `if test -e ${quote(body.projectPath!)}; then printf yes; else printf no; fi`);
  if (exists === "yes") await checked(run, `test -d ${quote(body.projectPath!)} && test ! -e ${quote(body.projectPath + "/.env")}`);
  const config = JSON.parse(await checked(run, `${compose(body)} config --format json`));
  const rows = (await inventory(run,project)).filter(c=>!c.Config.Labels?.["vps-panel.retained"]);
  const saved = body.composeMode === "update" ? await managed(body.composeDeploymentId!,serverId) : null;
  if (saved) {const retained=(saved.state.definition as Definition).retainedIds || []; for(let i=rows.length-1;i>=0;i--) if(retained.includes(rows[i].Id)) rows.splice(i,1);}
  if (saved) {
    const d = saved.state.definition as Definition;
    if (saved.state.runtime.composeVersion && !same(identity((saved.state.runtime.composeVersion as ComposeVersion).containers),identity(rows))) fail("Managed runtime configuration drift");
    if (d.path !== body.projectPath || d.project !== project || exists !== "yes" || !same(sorted(saved.state.runtime.containerIds), sorted(rows.map(c=>c.Id))) || rows.some(c=>c.Config.Labels?.["vps-panel.deployment"] !== d.owner)) fail("Project ownership or native runtime drift");
    if (!same(sorted(Object.keys(config.services)),sorted(rows.map(c=>c.Config.Labels["com.docker.compose.service"])))) fail("Service additions/removals require a separate reviewed migration; existing services are preserved");
    await checked(run, `test ! -L ${quote(d.path + "/docker-compose.yml")} && test -f ${quote(d.path + "/docker-compose.yml")}`);
    const diskFiles=(await checked(run,`find ${quote(d.path)} -type f -print`)).split("\n").filter(Boolean);
    const expectedFiles=Object.keys(d.files).map(name=>posix.join(d.path,name)).concat(d.path+"/docker-compose.yml");
    if (!same(sorted(diskFiles),sorted(expectedFiles)) || await checked(run,`find ${quote(d.path)} -type l -print`)) fail("Unreviewed project files or symlinks detected");
    if (!same(sorted(Object.keys(body.composeFiles || {})),sorted(Object.keys(d.files)))) fail("Build asset additions/removals require a separate reviewed migration");
    for (const [name,value] of Object.entries(d.files)) {
      const path=posix.join(d.path,name); await pathCheck(run,path,true);
      if (Buffer.from(await checked(run,`base64 -w0 ${quote(path)}`),"base64").toString() !== value) fail("Managed build assets drift");
    }
    const currentFile = await checked(run, `base64 -w0 ${quote(d.path + "/docker-compose.yml")}`);
    if (Buffer.from(currentFile,"base64").toString() !== d.content) fail("Managed definition file drift");
  } else {
    if (rows.length) fail("Existing unmanaged project cannot be recreated or adopted implicitly");
    if (exists === "yes") {
      if (body.composeConsent?.directory !== body.projectPath) fail("Explicit review of the existing directory is required");
      const names = await checked(run, `ls -A ${quote(body.projectPath!)}`);
      if (names) fail("Creation requires an empty reviewed existing directory");
    }
  }
  const resourceIdentities:unknown[]=rows.length ? await resources(run,rows) : [];
  const risks = {directory:exists === "yes" ? body.projectPath! : "", builds:[] as string[],foreignBinds:[] as string[],externalVolumes:[] as string[],externalNetworks:[] as string[],recreate:!!saved,writableLayerLoss:!!saved};
  for (const [kind,key] of [["volume","externalVolumes"],["network","externalNetworks"]] as const) {
    const names = (await checked(run,`docker ${kind} ls --format '{{.Name}}'`)).split(/\s+/);
    for (const r of Object.values(config[kind + "s"] || {}) as Native[]) {
      if (!nameOK(r.name)) fail("Invalid native resource name");
      if (names.includes(r.name)) resourceIdentities.push(JSON.parse(await checked(run,`docker ${kind} inspect ${quote(r.name)}`)));
      if (r.external) { if (!names.includes(r.name)) fail("External resource is missing"); risks[key].push(r.name); }
      else if (names.includes(r.name)) {
        if (!saved) fail("A project resource already exists");
        const resource = JSON.parse(await checked(run,`docker ${kind} inspect ${quote(r.name)}`))[0];
        if (resource.Labels?.["com.docker.compose.project"] !== project) fail("Resource ownership differs");
      }
    }
  }
  const allNames = (await checked(run,"docker ps -a --format '{{.Names}}'")).split(/\s+/);
  const allocated = (await checked(run,"docker ps -q --no-trunc")).split(/\s+/).filter(Boolean);
  if (allocated.some(id=>!/^[a-f0-9]{64}$/.test(id))) fail("Docker inventory unavailable");
  const activeIds = allocated.filter(id=>!rows.some(c=>c.Id === id));
  const ports: Native[] = activeIds.length ? JSON.parse(await checked(run,`docker inspect ${activeIds.map(quote).join(" ")}`)) : [];
  const seen = new Set<string>();
  for (const [service,s] of Object.entries(config.services) as [string,Native][]) {
    if (s.build) risks.builds.push(service);
    if (s.container_name && allNames.includes(s.container_name) && !rows.some(c=>c.Name === "/"+s.container_name)) fail("Container name already exists");
    for (const v of s.volumes || []) if (v.type === "bind") { await pathCheck(run,v.source,true); risks.foreignBinds.push(v.source); resourceIdentities.push([v.source,await checked(run,`stat -c '%d:%i:%F' ${quote(v.source)}`)]); }
    for (const p of s.ports || []) {
      if (p.published === undefined) continue;
      const n = Number(p.published), protocol = p.protocol || "tcp", key = `${n}/${protocol}`;
      if (!/^\d+$/.test(String(p.published)) || n < 1 || n > 65535 || !["tcp","udp"].includes(protocol) || seen.has(key)) fail("Unsupported or duplicate published port");
      seen.add(key);
      if (ports.some(c=>Object.entries(c.NetworkSettings.Ports || {}).some(([k,b])=>k.endsWith("/"+protocol) && Array.isArray(b) && b.some(v=>Number(v.HostPort)===n)))) fail("Port already allocated");
      const own = rows.some(c=>Object.entries(c.NetworkSettings.Ports || {}).some(([k,b])=>k.endsWith("/"+protocol) && Array.isArray(b) && b.some(v=>Number(v.HostPort)===n)));
      if (!own && await checked(run,`ss -${protocol === "udp" ? "lun" : "ltn"}H '( sport = :${n} )'`)) fail("Port already listening");
    }
  }
  for (const key of ["builds","foreignBinds","externalVolumes","externalNetworks"] as const) risks[key] = sorted([...new Set(risks[key])]);
  return {services:Object.keys(config.services),risks,revision:hash({body:{...body,composeRevision:undefined,composeConsent:undefined,composePlan:undefined},serverId,config,resourceIdentities,rows:identity(rows),saved:saved?.value || null,exists,risks})};
}
function consent(body: DockerInput, risks: Awaited<ReturnType<typeof composePreflight>>["risks"]) {
  for (const key of ["builds","foreignBinds","externalVolumes","externalNetworks"] as const) if (!same(sorted(body.composeConsent?.[key] || []),risks[key])) fail("Explicit reviewed build, bind and external resource consent is required",400);
  if (risks.directory && body.composeConsent?.directory !== risks.directory) fail("Explicit directory consent is required",400);
  if (risks.recreate && (body.composeConsent?.recreate !== true || lossConsent(body) !== true || !["unchanged","operator-confirmed"].includes(body.dataCompatibility || "") || !["unchanged","operator-confirmed"].includes(body.schemaCompatibility || ""))) fail("Recreation destroys original writable layers; explicit writableLayerLoss consent and data/schema acknowledgments are required",400);
}
async function writeFiles(run:DeployRunner,path:string,content:string,files:Record<string,string>) {
  for (const [name,value] of Object.entries({...files,"docker-compose.yml":content})) {
    const target = posix.join(path,name); await pathCheck(run,target);
    await checked(run,`umask 077; mkdir -p ${quote(posix.dirname(target))} && ${decode(value)} > ${quote(target)}`);
    const readback = await checked(run,`base64 -w0 ${quote(target)}`);
    if (Buffer.from(readback,"base64").toString() !== value) fail("Definition file write could not be verified");
  }
}
async function resources(run:DeployRunner,rows:Native[]) {
  const result:unknown[]=[];
  for (const c of rows) {
    createPayload(c,c.Config.Env);
    for (const [name,e] of Object.entries(c.NetworkSettings.Networks || {}) as [string,Native][]) {
      const r=JSON.parse(await checked(run,`docker network inspect ${quote(name)}`))[0];
      if(r.Id !== e.NetworkID) fail("Original network was replaced");
      result.push({kind:"network",name,id:r.Id,Driver:r.Driver,Internal:r.Internal,IPAM:r.IPAM,Options:r.Options,Labels:r.Labels});
    }
    for(const m of c.Mounts) {
      if(m.Type === "volume") {
        const r=JSON.parse(await checked(run,`docker volume inspect ${quote(m.Name)}`))[0];
        result.push({kind:"volume",name:m.Name,resource:r,identity:await checked(run,`stat -c '%d:%i:%F' ${quote(r.Mountpoint)}`)});
      } else if(m.Type === "bind") {
        await pathCheck(run,m.Source,true);
        result.push({kind:"bind",name:m.Source,identity:await checked(run,`stat -c '%d:%i:%F' ${quote(m.Source)}`)});
      }
    }
  }
  return result;
}
async function version(run:DeployRunner,d:Definition,rows:Native[]):Promise<ComposeVersion> {
  const images = [];
  for (const c of rows) {
    createPayload(c,c.Config.Env);
    const image = JSON.parse(await checked(run,`docker image inspect ${quote(c.Image)}`))[0];
    if (image.Id !== c.Image) fail("Image identity changed");
    images.push({id:image.Id,repoDigests:image.RepoDigests || []});
  }
  return {content:d.content,files:d.files,containers:rows,images,resources:await resources(run,rows)};
}
async function cas(saved:NonNullable<Awaited<ReturnType<typeof readDeploymentDefinition>>>,state:DeploymentState) {
  const value = sealDeployment(state);
  if ((await prisma.appSetting.updateMany({where:{key:saved.key,value:saved.value},data:{value}})).count !== 1) fail("Deployment state changed");
  saved.value=value; saved.state=state;
  const readback = await readDeploymentDefinition(state.deploymentId);
  if (!readback || readback.value !== value) fail("Deployment state readback failed");
}
export async function deployCompose(run:DeployRunner,body:DockerInput,serverId:string,deploymentId:string, suppliedApi?: Awaited<ReturnType<typeof engine>>) {
  await resourcePreflight(run,true);
  const plan=await composePreflight(run,body,serverId);
  if (body.composeRevision !== plan.revision) fail("Compose preview changed; review again");
  consent(body,plan.risks);
  const prior = body.composeMode === "update" ? await managed(body.composeDeploymentId!,serverId) : null;
  const rows=(await inventory(run,projectName(body))).filter(c=>prior?.state.runtime.containerIds.includes(c.Id));
  const definition:Definition={kind:"compose",project:projectName(body),path:body.projectPath!,owner:prior ? (prior.state.definition as Definition).owner : deploymentId,submittedContent:body.composeContent!,content:body.composeContent!,files:body.composeFiles || {}};
  if (prior) {
    const previous=await version(run,prior.state.definition as Definition,rows);
    definition.previous=previous; definition.original=(prior.state.definition as Definition).original || previous;
  }
  const operation=randomUUID(), lockKey="compose-operation:"+hash([serverId,definition.project]);
  try { await prisma.appSetting.create({data:{key:lockKey,value:operation}}); } catch { fail("Another Compose operation is pending"); }
  activeOperations.add(operation);
  let mutated=false;
  let saved:NonNullable<Awaited<ReturnType<typeof readDeploymentDefinition>>> | undefined;
  try {
    // Acquire the project lock, then repeat the exact preview immediately before target mutation.
    if ((await composePreflight(run,body,serverId)).revision !== body.composeRevision) fail("Compose preview changed after operation lock");
    await saveDeploymentDefinition(deploymentId,serverId,definition,{containerIds:rows.map(c=>c.Id)});
    saved=(await readDeploymentDefinition(deploymentId))!;
    await cas(saved,{...saved.state,pending:operation});
    if (prior) await cas(prior,{...prior.state,pending:operation});
    const server=serverId === "local" ? null : await prisma.server.findUnique({where:{id:serverId}});
    if (serverId !== "local" && !server && !suppliedApi) fail("Server unavailable");
    const api=suppliedApi || await engine(server);
    try {
      mutated=true;
      const retainedIds:string[]=[];
      for (const c of rows) {
        const payload=createPayload(c,c.Config.Env);
        payload.Labels=Object.fromEntries(Object.entries(payload.Labels || {}).filter(([k])=>!k.startsWith("com.docker.compose.")));
        // Engine merges image labels: explicitly override project labels inherited from a Compose-built image.
        payload.Labels["com.docker.compose.project"]="retained-"+deploymentId;
        payload.Labels["vps-panel.retained"]=deploymentId;
        const backup=await api.call("POST",`/containers/create?name=${encodeURIComponent(c.Name.slice(1)+"-deploy-retained-"+randomUUID())}`,payload);
        retainedIds.push(backup.Id);
        definition.retainedIds=retainedIds;
        await cas(saved,{...saved.state,definition});
      }
    } finally {if (!suppliedApi) await api.close();}
    if (!prior && !plan.risks.directory) await checked(run,`umask 077; mkdir ${quote(definition.path)}`);
    for(const name of Object.keys(definition.files)) {
      const target=posix.join(definition.path,name); await pathCheck(run,target);
      if (!prior || !Object.hasOwn((prior.state.definition as Definition).files,name)) await checked(run,`test ! -e ${quote(target)}`);
    }
    const doc=yaml.load(definition.content) as Native;
    for (const s of Object.values(doc.services) as Native[]) (s.labels ||= {})["vps-panel.deployment"]=definition.owner;
    // Image VOLUME declarations must reuse exact Engine-resolved anonymous names.
    for(const c of rows) {
      const service=doc.services[c.Config.Labels["com.docker.compose.service"]];
      for(const m of c.Mounts.filter((m:Native)=>m.Type === "volume")) {
        const declared=(service.volumes || []).some((v:Native|string)=>typeof v === "string" ? v.split(":")[1] === m.Destination : v.target === m.Destination);
        if(!declared) {
          const key="pinned_"+hash(m.Name).slice(0,16);
          (doc.volumes ||= {})[key]={external:true,name:m.Name};
          (service.volumes ||= []).push({type:"volume",source:key,target:m.Destination,read_only:!m.RW});
        }
      }
    }
    definition.content=yaml.dump(doc,{noRefs:true});
    await cas(saved,{...saved.state,definition});
    await writeFiles(run,definition.path,definition.content,definition.files);
    // Pin a separate native tag before Compose rebuilds its mutable service tag.
    // A retained container alone is not sufficient with every native builder.
    for (const c of rows) await checked(run,`docker image tag ${quote(c.Image)} ${quote(`vps-panel-retained/${hash([serverId,definition.project]).slice(0,24)}:${c.Image.slice(7)}`)}`);
    if (plan.risks.builds.length) await checked(run,`${compose(body,definition.content)} build`,300_000);
    await checked(run,`${compose(body,definition.content)} up -d --no-build ${prior ? "" : "--no-recreate"}`,180_000);
    const current=(await inventory(run,definition.project)).filter(c=>!(definition.retainedIds || []).includes(c.Id));
    if (current.length !== plan.services.length || current.some(c=>c.Config.Labels?.["vps-panel.deployment"] !== definition.owner)) fail("Compose runtime ownership/readback failed");
    const currentVersion=await version(run,definition,current);
    definition.original ||= currentVersion;
    const next={...saved.state,definition,runtime:{containerIds:current.map(c=>c.Id),composeVersion:currentVersion}}; delete next.pending;
    await finalize(saved,next,lockKey,operation,prior ? {saved:prior,state:{...prior.state,pending:"superseded:"+deploymentId}} : undefined);
    return {containerIds:next.runtime.containerIds,status:readiness(current,plan.services),revision:hash(next)};
  } catch (error) {
    if (!mutated) {
      await prisma.$transaction(async tx=> {
        if(prior?.state.pending === operation) {const state={...prior.state};delete state.pending;if((await tx.appSetting.updateMany({where:{key:prior.key,value:prior.value},data:{value:sealDeployment(state)}})).count!==1) fail("Cleanup state changed");}
        if(saved) await tx.appSetting.deleteMany({where:{key:saved.key,value:saved.value}});
        await tx.appSetting.deleteMany({where:{key:lockKey,value:operation}});
      });
      throw error;
    }
    fail("Compose operation is uncertain; operation-owned lock and encrypted originals remain. Use composeOperationPreview for read-only inspection; do not retry or unlock automatically",502);
  } finally {activeOperations.delete(operation);}
}
export async function composeRollbackPreview(run:DeployRunner,deploymentId:string,serverId:string) {
  const saved=await managed(deploymentId,serverId), d=saved.state.definition as Definition;
  if (!d.previous) fail("No earlier Compose definition is retained");
  for(const [name,value] of Object.entries(d.files)) {const target=posix.join(d.path,name);await pathCheck(run,target,true);if(Buffer.from(await checked(run,`base64 -w0 ${quote(target)}`),"base64").toString() !== value) fail("Managed build asset drift");}
  await pathCheck(run,d.path,true);
  await pathCheck(run,d.path+"/docker-compose.yml",true);
  if(Buffer.from(await checked(run,`base64 -w0 ${quote(d.path+"/docker-compose.yml")}`),"base64").toString() !== d.content) fail("Managed definition drift");
  const rows=await inventory(run,d.project);
  if (!same(sorted(rows.map(c=>c.Id)),sorted(saved.state.runtime.containerIds)) || rows.some(c=>c.Config.Labels?.["vps-panel.deployment"] !== d.owner)) fail("Compose target drift");
  if(saved.state.runtime.composeVersion && !same(identity((saved.state.runtime.composeVersion as ComposeVersion).containers),identity(rows))) fail("Runtime configuration drift");
  if(!d.previous.resources || !same(d.previous.resources,await resources(run,d.previous.containers))) fail("Original resource identity/configuration changed or unavailable");
  for(const c of d.previous.containers) {
    createPayload(c,c.Config.Env);
    const image=JSON.parse(await checked(run,`docker image inspect ${quote(c.Image)}`))[0];
    if(image.Id !== c.Image) fail("Original image unavailable");
  }
  return {revision:hash([saved.value,identity(rows),d.previous.resources]),confirmation:`ROLLBACK ${d.project}`,rollbackScope:scope};
}
export async function rollbackCompose(run:DeployRunner,api:API,deploymentId:string,serverId:string,input:{revision:string;confirmation:string;dataCompatibility:string;schemaCompatibility:string;writableLayerLoss?:boolean}) {
  const preview=await composeRollbackPreview(run,deploymentId,serverId);
  if (input.writableLayerLoss !== true || input.revision !== preview.revision || input.confirmation !== preview.confirmation || !["unchanged","operator-confirmed"].includes(input.dataCompatibility) || !["unchanged","operator-confirmed"].includes(input.schemaCompatibility)) fail("Rollback requires exact preview and compatibility acknowledgments",400);
  const saved=await managed(deploymentId,serverId),d=saved.state.definition as Definition,original=d.previous!;
  await pathCheck(run,d.path,true);
  const current=(await inventory(run,d.project)).filter(c=>saved.state.runtime.containerIds.includes(c.Id));
  // Validate all pinned images and original payloads before stopping anything.
  for (const c of original.containers) {createPayload(c,c.Config.Env); await api.call("GET",`/images/${encodeURIComponent(c.Image)}/json`);}
  const lockKey="compose-operation:"+hash([serverId,d.project]);
  const operation=randomUUID();
  try {await prisma.appSetting.create({data:{key:lockKey,value:operation}});} catch {fail("Another Compose operation is pending");}
  activeOperations.add(operation);
  let mutated=false;
  try {
  if ((await composeRollbackPreview(run,deploymentId,serverId)).revision !== input.revision) fail("Rollback preview changed");
  await cas(saved,{...saved.state,pending:operation});
  const ids:string[]=[];
  const retained:string[]=[];
  mutated=true;
  for (const c of current) {
    const payload=createPayload(c,c.Config.Env);
    payload.Labels["com.docker.compose.project"]="retained-"+deploymentId;
    payload.Labels["vps-panel.retained"]=deploymentId;
    const backup=await api.call("POST",`/containers/create?name=${encodeURIComponent(c.Name.slice(1)+"-rollback-retained-"+randomUUID())}`,payload);
    retained.push(backup.Id);
    d.retainedIds=[...(d.retainedIds || []),backup.Id];
    await cas(saved,{...saved.state,definition:d});
    if (c.State.Running) await api.call("POST",`/containers/${c.Id}/stop?t=10`);
    // Immutable active Compose labels cannot be quarantined by rename. Remove only after a pinned backup exists.
    await api.call("DELETE",`/containers/${c.Id}?v=false`);
  }
  for (const c of original.containers) {
    const created=await api.call("POST",`/containers/create?name=${encodeURIComponent(c.Name.slice(1))}`,createPayload(c,c.Config.Env));
    ids.push(created.Id);
    if(c.State.Running) await api.call("POST",`/containers/${created.Id}/start`);
    const actual=await api.call("GET",`/containers/${created.Id}/json`);
    if (!same(payloadFingerprint(c),payloadFingerprint(actual)) || actual.State.Running !== c.State.Running) fail("Rollback native configuration readback differs");
  }
  await writeFiles(run,d.path,original.content,original.files);
  const restored={...d,content:original.content,files:original.files,retainedIds:[...(d.retainedIds || []),...retained]}; delete restored.previous;
  // Only restored containers carry the active project labels.
  const restoredContainers=[]; for(const id of ids) restoredContainers.push(await api.call("GET",`/containers/${id}/json`));
  const next={...saved.state,definition:restored,runtime:{containerIds:ids,composeVersion:{...original,containers:restoredContainers}}};delete next.pending;
  await finalize(saved,next,lockKey,operation);
  return {rolledBack:true,containerIds:ids,rollbackScope:scope,revision:hash(next)};
  } catch(error) {
    if(!mutated) {
      await prisma.$transaction(async tx=> {
        if(saved.state.pending === operation) {const state={...saved.state};delete state.pending;if((await tx.appSetting.updateMany({where:{key:saved.key,value:saved.value},data:{value:sealDeployment(state)}})).count !== 1) fail("Cleanup state changed");}
        await tx.appSetting.deleteMany({where:{key:lockKey,value:operation}});
      });
      throw error;
    }
    fail("Rollback is uncertain; operation-owned lock retained. Inspect composeOperationPreview before manual recovery",502);
  } finally {activeOperations.delete(operation);}
}

async function finalize(saved:NonNullable<Awaited<ReturnType<typeof readDeploymentDefinition>>>,state:DeploymentState,key:string,operation:string,prior?:{saved:typeof saved;state:DeploymentState}) {
  const value=sealDeployment(state);
  await prisma.$transaction(async tx=> {
    if(prior && (await tx.appSetting.updateMany({where:{key:prior.saved.key,value:prior.saved.value},data:{value:sealDeployment(prior.state)}})).count !== 1) fail("Predecessor state changed");
    if((await tx.appSetting.updateMany({where:{key:saved.key,value:saved.value},data:{value}})).count !== 1) fail("Deployment state changed");
    if((await tx.appSetting.deleteMany({where:{key,value:operation}})).count !== 1) fail("Operation ownership changed");
  });
  const actual=await readDeploymentDefinition(state.deploymentId);
  if(actual?.value !== value || await prisma.appSetting.findUnique({where:{key}})) fail("Finalization readback failed");
}
// Read-only uncertain journal. Never unlock: manual recovery must reconcile both metadata and exact Engine assets.
export async function composeOperationPreview(run:DeployRunner,deploymentId:string,serverId:string) {
  const saved=await readDeploymentDefinition(deploymentId);
  if(!saved || saved.state.serverId !== serverId || saved.state.definition.kind !== "compose") fail("Compose target unavailable");
  const d=saved.state.definition as Definition;
  const lock=await prisma.appSetting.findUnique({where:{key:"compose-operation:"+hash([serverId,d.project])}});
  const rows=await inventory(run,d.project);
  return {deploymentId,pending:!!saved.state.pending,operation:lock?.value || null,workerActive:!!lock && activeOperations.has(lock.value),containerIds:rows.map(c=>c.Id),retainedContainerIds:d.retainedIds || [],revision:hash([saved.value,lock?.value || null,identity(rows)]),canAutomaticallyReconcile:false,requiredAction:"Inspect exact current/retained containers and encrypted definition; manual recovery required. No automatic unlock or retry.",rollbackScope:scope};
}

function payloadFingerprint(c:Native) {
  const p=createPayload(c,c.Config.Env);
  // Engine omits false ReadOnly on roundtrip; this is the same read-write mount, not relaxed config.
  for(const m of p.HostConfig.Mounts || []) if(m.ReadOnly === undefined) m.ReadOnly=false;
  return p;
}
