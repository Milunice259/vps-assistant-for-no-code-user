import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { validImageReference } from "@/lib/image-deployment";
import { configurationHash, createPayload, envTarget, listTargetProfiles, replaceTarget, withEnvTarget } from "@/lib/container-recreate";
import { deploymentDTO, deploymentFail as fail, readDeploymentDefinition, sealDeployment, snapshot, type Native } from "@/lib/deployment-state";

export type LifecycleInput = { mode?: string; action?: string; image?: string; revision?: string; confirmation?: string; dataCompatibility?: string; schemaCompatibility?: string };
async function saved(id: string) {
  const row = await readDeploymentDefinition(id);
  if (!row?.state.current || !row.state.original || row.state.definition.kind !== "image") fail("An immutable image deployment definition is required; legacy deployments must be adopted explicitly", 422);
  return row!;
}
const appId = (state: Awaited<ReturnType<typeof saved>>["state"]) => state.runtime.appId || `discovered::${state.serverId}::${state.current!.inspect.Id}`;
function assertTarget(state: Awaited<ReturnType<typeof saved>>["state"], inspect: Native, serverId: string) {
  if (serverId !== state.serverId || inspect.Id !== state.current!.inspect.Id || inspect.Name !== state.current!.inspect.Name || snapshot(inspect).fingerprint !== state.current!.fingerprint || inspect.State.Running !== state.current!.inspect.State.Running) fail("Deployment runtime drift; inspect and reconcile before changing this exact target");
}
export async function deploymentView(id: string) {
  const row = await readDeploymentDefinition(id);
  if (!row) return { originalDefinitionAvailable: false, capability: "legacy_definition_missing" };
  if (row.state.definition.kind !== "image") return { ...deploymentDTO(row.state), revision: configurationHash(row.value) };
  if (!row.state.current) return {...deploymentDTO(row.state),revision:configurationHash(row.value),capability:"initial_deployment_incomplete",recovery:{containerIds:row.state.runtime.containerIds,name:(row.state.runtime.operation as Native | undefined)?.name || null,phase:(row.state.runtime.operation as Native | undefined)?.phase || "unknown"}};
  const target = await envTarget(appId(row.state));
  try {
    let drift = false;
    try { assertTarget(row.state, target.inspect, target.serverId); } catch { drift = true; }
    return { ...deploymentDTO(row.state), rollbackScope:"Container configuration and image only; writable-layer changes, database, schema and external data are not restored", revision: configurationHash([row.value,target.revision]), drift, running: !!target.inspect.State.Running, readiness: target.inspect.State.Health?.Status || "unverified" };
  } finally { await target.api.close(); }
}
export async function imageLifecycle(id: string, input: LifecycleInput) {
  if (!["preview","apply"].includes(input.mode || "") || !["update","recreate","rollback"].includes(input.action || "")) fail("Invalid lifecycle mode or action",400);
  if (input.action === "update" && !validImageReference(input.image)) fail("A valid update image is required",400);
  if (input.action !== "update" && input.image !== undefined) fail("Image is only accepted for update",400);
  const row = await saved(id), state = row.state;
  if (state.pending) fail("Deployment operation is pending; inspect retained recovery before retrying");
  const target = await envTarget(appId(state));
  let revision: string;
  try { assertTarget(state,target.inspect,target.serverId); revision = configurationHash([row.value,target.revision,input.action,input.image || null]); }
  finally { await target.api.close(); }
  const confirmation = `${input.action!.toUpperCase()} ${state.current!.inspect.Id.slice(0,12)}`;
  const preview = { ...deploymentDTO(state), rollbackScope:"Container configuration and image only; writable-layer changes, database, schema and external data are not restored", revision, confirmation, action: input.action, compatibilityRequired: true, writableLayerPreserved: false, recoveryScope: "Fresh container from pinned image and native configuration; previous container retained. Writable-layer changes, database, schema and external data are not restored.", dataRestored: false, schemaRestored: false };
  if (input.mode === "preview") return preview;
  if (input.revision !== revision || input.confirmation !== confirmation) fail("Preview changed or exact confirmation is missing");
  // Operator attestation is explicit for stateful AND stateless workloads. No schema safety is inferred from mounts.
  if (!["unchanged","operator-confirmed"].includes(input.dataCompatibility || "") || !["unchanged","operator-confirmed"].includes(input.schemaCompatibility || "")) fail("Confirm database/schema and external-data compatibility; fresh containers do not preserve writable-layer changes or restore external data/schema",400);
  const pending = sealDeployment({...state,pending:randomUUID()});
  if ((await prisma.appSetting.updateMany({where:{key:row.key,value:row.value},data:{value:pending}})).count !== 1) fail("Concurrent deployment operation");
  let committed = false;
  try {
    const result = await withEnvTarget(appId(state), async locked => {
      assertTarget(state,locked.inspect,locked.serverId);
      if (configurationHash([row.value,locked.revision,input.action,input.image || null]) !== revision) fail("Target metadata changed after preview");
      // Lock changes only metadata; bind the originally observed runtime and pre-operation metadata revision.
      let image = state.current!.imageDigest;
      let digests = state.current!.repoDigests;
      if (input.action === "update") {
        await locked.api.call("POST",`/images/create?fromImage=${encodeURIComponent(input.image!)}`);
        const inspected = await locked.api.call("GET",`/images/${encodeURIComponent(input.image!)}/json`);
        if (!/^sha256:[a-f0-9]{64}$/.test(inspected.Id)) fail("Image digest could not be verified",502);
        image = inspected.Id; digests = inspected.RepoDigests || [];
      } else if (input.action === "rollback") { image = state.original!.imageDigest; digests = state.original!.repoDigests; }
      await locked.api.call("GET",`/images/${encodeURIComponent(image)}/json`);
      const profiles = (await listTargetProfiles(locked)).map(p => input.action === "rollback" ? {...p,isActive:false} : p);
      return replaceTarget(locked, input.action === "rollback" ? state.original!.inspect.Config.Env : locked.inspect.Config.Env, profiles, locked.state.baseline, null, false, {
        transform: payload => {
          if (input.action === "rollback") {
            const original = createPayload(state.original!.inspect,state.original!.inspect.Config.Env);
            for (const key of Object.keys(payload)) delete payload[key];
            Object.assign(payload,original);
          }
          payload.Image = image;
        },
        commit: async (tx, verified) => {
          const current = snapshot(verified,digests);
          const next = {...state,current,runtime:{...state.runtime,containerIds:[verified.Id],imageDigest:image,repoDigests:digests},retained:[...(state.retained || []),state.current!]};
          if ((await tx.appSetting.updateMany({where:{key:row.key,value:pending},data:{value:sealDeployment(next)}})).count !== 1) fail("Deployment metadata drift");
          await tx.deploymentLog.update({where:{id},data:{status:verified.State.Health?.Status === "healthy" ? "RUNNING" : "UNVERIFIED",logs:`${input.action} native configuration verified. External data and schema were not restored. Readiness: ${verified.State.Health?.Status || "unverified"}.`}});
        },
      });
    });
    committed = true;
    return {...result,deployment:await deploymentView(id),writableLayerPreserved:false,dataRestored:false,schemaRestored:false};
  } finally {
    // Keep an uncertain lock if native recovery is pending; never unlock unknown outcomes.
    if (!committed) {
      try { const check = await envTarget(appId(state)); try { assertTarget(state,check.inspect,check.serverId); if (!check.state.operation) await prisma.appSetting.updateMany({where:{key:row.key,value:pending},data:{value:row.value}}); } finally { await check.api.close(); } } catch { /* encrypted pending/recovery stays retained */ }
    }
  }
}
