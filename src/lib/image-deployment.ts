import { randomUUID } from "node:crypto";
import { configurationHash, engine, type Target } from "@/lib/container-recreate";
import { prisma } from "@/lib/db";
import { checkRouting, transformRouting, validateDomain, validateRouting, routingReadback, type RoutingInput } from "@/lib/app-routing";
import { deploymentFail as fail, saveDeploymentDefinition, readDeploymentDefinition, sealDeployment, snapshot, type DeploymentState, type Native } from "@/lib/deployment-state";
import { checked, quote, validateDockerDeploy, type DeployRunner, type DockerInput } from "@/lib/deploy-preflight";
import { isLocalServer } from "@/lib/local-server";

export type ImageInput = DockerInput & { mounts?: {type:"volume"|"bind";source:string;target:string;readOnly?:boolean;consent:boolean}[]; networks?:string[]; healthcheck?:{test:string[];intervalSeconds?:number;timeoutSeconds?:number;retries?:number;startPeriodSeconds?:number}; domain?:string|null; routing?:RoutingInput };
export function validImageReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[1-9][0-9]{0,4})?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})?$/.test(value) && (!/^([^/]+):([0-9]+)\//.test(value) || Number(value.match(/^([^/]+):([0-9]+)\//)![2]) <= 65535);
}
export function validateImageInput(body: ImageInput) {
  if (!validImageReference(body.image)) fail("Invalid native image reference",400);
  const invalid = validateDockerDeploy({...body,image:"validated:latest"}); if (invalid) fail(invalid,400);
  if (body.type !== "image") fail("Expected image deployment",400);
  if (body.mounts !== undefined) {
    if (!Array.isArray(body.mounts) || body.mounts.length > 32) fail("Invalid mounts",400);
    const destinations = new Set();
    for (const m of body.mounts) {
      if (!m || !["volume","bind"].includes(m.type) || m.consent !== true || typeof m.source !== "string" || typeof m.target !== "string" || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(m.target) || m.target.split("/").includes("..") || destinations.has(m.target) || m.readOnly !== undefined && typeof m.readOnly !== "boolean") fail("Mounts require exact paths, unique targets and explicit consent",400);
      destinations.add(m.target);
      if (m.type === "volume" ? !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(m.source) : !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(m.source) || m.source.split("/").includes("..") || /^\/(?:proc|sys|dev|etc|root|run|usr|bin|sbin|lib|lib64|boot|var\/run|var\/lib\/docker|var\/lib\/containerd|opt\/vps-panel)(?:\/|$)/.test(m.source) || ["/var","/var/lib","/opt"].includes(m.source) || /docker\.sock$/.test(m.source)) fail("Bind source must be an explicit non-system data directory; volume source must be a native name",400);
    }
  }
  if (body.networks !== undefined && (!Array.isArray(body.networks) || body.networks.length > 8 || new Set(body.networks).size !== body.networks.length || body.networks.some(n => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(n) || ["host","none"].includes(n)))) fail("Invalid bridge networks",400);
  if (body.healthcheck !== undefined) {
    const h = body.healthcheck;
    if (!h || !Array.isArray(h.test) || !["CMD","CMD-SHELL","NONE"].includes(h.test[0]) || h.test.length > 32 || h.test.some(s => typeof s !== "string" || s.length > 8192 || s.includes("\0")) || h.test[0] === "NONE" && h.test.length !== 1 || h.test[0] === "CMD-SHELL" && h.test.length !== 2 || h.test[0] === "CMD" && h.test.length < 2) fail("Invalid health command",400);
    for (const k of ["intervalSeconds","timeoutSeconds","startPeriodSeconds","retries"] as const) if (h[k] !== undefined && (!Number.isSafeInteger(h[k]) || h[k]! < (k === "startPeriodSeconds" ? 0 : 1) || h[k]! > (k === "retries" ? 100 : 3600))) fail("Invalid health timing",400);
  }
  if (body.domain !== undefined) { validateDomain(body.domain); if (body.domain !== null) validateRouting(body.routing); }
  if (body.routing && !body.domain) fail("Domain is required for routing",400);
}
export async function deployImage(body: ImageInput, serverId: string, deploymentId: string, run?: DeployRunner) {
  validateImageInput(body);
  for (const m of body.mounts || []) if (m.type === "bind") {
    if (!run) fail("Bind mounts require canonical target-host path verification",422);
    const canonical = await checked(run!, `test -d ${quote(m.source)} && readlink -f -- ${quote(m.source)}`);
    if (canonical !== m.source) fail("Bind source must be an existing canonical directory without symlink redirection",400);
  }
  const server = isLocalServer(serverId) ? null : await prisma.server.findUnique({where:{id:serverId}});
  if (!isLocalServer(serverId) && !server) fail("Server not found",404);
  const operation = randomUUID();
  const name = `${body.name || `panel-${deploymentId}`}-${operation.slice(0,8)}`;
  // Save the submitted secret-bearing definition before any Engine mutation.
  await saveDeploymentDefinition(deploymentId,serverId,{...body,kind:"image"},{containerIds:[],operation:{id:operation,name,phase:"prepared"}});
  const saved = (await readDeploymentDefinition(deploymentId))!;
  let state: DeploymentState = {...saved.state,pending:operation};
  let value = saved.value;
  const journal = async (changes: Native) => {
    const next = {...state,runtime:{...state.runtime,...changes}};
    const sealed = sealDeployment(next);
    if ((await prisma.appSetting.updateMany({where:{key:saved.key,value},data:{value:sealed}})).count !== 1) fail("Deployment metadata drift");
    state=next; value=sealed;
  };
  await journal({});
  let containerId: string | undefined;
  let mutationAttempted = false;
  let api: Awaited<ReturnType<typeof engine>> | undefined;
  try {
    api = await engine(server);
    await journal({operation:{id:operation,name,phase:"pull_attempted"}});
    mutationAttempted = true;
    await api.call("POST",`/images/create?fromImage=${encodeURIComponent(body.image!)}`);
    const image = await api.call("GET",`/images/${encodeURIComponent(body.image!)}/json`);
    if (!/^sha256:[a-f0-9]{64}$/.test(image.Id)) fail("Image digest could not be verified",502);
    await journal({imageDigest:image.Id,repoDigests:image.RepoDigests || [],operation:{id:operation,name,phase:"image_pinned"}});
    const endpoints: Native = {};
    for (const network of body.networks || []) {
      const inspected = await api.call("GET",`/networks/${encodeURIComponent(network)}`);
      if (inspected.Driver !== "bridge" || inspected.Scope !== "local") fail("Only existing local bridge networks are supported",422);
      endpoints[network] = {};
    }
    // Native Mounts refuses missing bind paths and preserves options; existing volumes are explicit assets.
    for (const m of body.mounts || []) if (m.type === "volume") await api.call("GET",`/volumes/${encodeURIComponent(m.source)}`);
    const config = structuredClone(image.Config || {});
    const overrides = body.env || {};
    config.Env = [...(config.Env || []).filter((v:string) => !Object.hasOwn(overrides,v.slice(0,v.indexOf("=")))),...Object.entries(overrides).map(([k,v])=>`${k}=${v}`)];
    const payload: Native = {...config,Image:image.Id,Labels:{...(config.Labels || {}),"vps-panel.deployment":deploymentId,"vps-panel.operation":operation},HostConfig:{RestartPolicy:{Name:body.restartPolicy || "no",MaximumRetryCount:0},NanoCpus:Math.round((body.cpuLimit || 0)*1e9),Memory:(body.memoryLimit || 0)*1024*1024,Mounts:(body.mounts || []).map(m=>({Type:m.type,Source:m.source,Target:m.target,ReadOnly:!!m.readOnly})),PortBindings:{}},NetworkingConfig:{EndpointsConfig:endpoints}};
    for (const port of body.ports || []) { const [host,container] = port.split(":"); const key = container.includes("/") ? container : container+"/tcp"; (payload.ExposedPorts ||= {})[key] = {}; (payload.HostConfig.PortBindings[key] ||= []).push({HostIp:"",HostPort:host}); }
    if (body.healthcheck) { const h=body.healthcheck; payload.Healthcheck={Test:h.test,...(h.intervalSeconds!==undefined?{Interval:h.intervalSeconds*1e9}:{}),...(h.timeoutSeconds!==undefined?{Timeout:h.timeoutSeconds*1e9}:{}),...(h.startPeriodSeconds!==undefined?{StartPeriod:h.startPeriodSeconds*1e9}:{}),...(h.retries!==undefined?{Retries:h.retries}:{})}; }
    const target = {api,serverId,app:server?{server}:null,key:"safe-env:"+configurationHash([serverId,"/"+name]),inspect:{Id:"",Config:{Labels:payload.Labels},State:{Running:false}}} as unknown as Target;
    if (body.domain) { await checkRouting(target,body.domain,body.routing,Object.keys(endpoints)); transformRouting(target,body.domain,body.routing,payload); }
    await journal({operation:{id:operation,name,phase:"create_attempted"}});
    const created = await api.call("POST",`/containers/create?name=${encodeURIComponent(name)}`,payload);
    if (!/^[a-f0-9]{64}$/.test(created.Id)) fail("Container identity could not be verified",502);
    containerId=created.Id;
    await journal({containerIds:[containerId],operation:{id:operation,name,phase:"start_attempted"}});
    await api.call("POST",`/containers/${containerId}/start`);
    let inspect = await api.call("GET",`/containers/${containerId}/json`);
    const deadline=Date.now()+30_000;
    while (inspect.State.Running && inspect.State.Health?.Status === "starting" && Date.now()<deadline) { await new Promise(r=>setTimeout(r,500)); inspect=await api.call("GET",`/containers/${containerId}/json`); }
    if (inspect.Id !== containerId || inspect.Image !== image.Id || inspect.Name !== "/"+name) fail("Created runtime identity readback failed",502);
    await journal({inspect,operation:{id:operation,name,phase:"runtime_verified"}});
    const routing = body.domain ? await routingReadback({...target,inspect},containerId!,body.domain,body.routing!,false) : null;
    await prisma.$transaction(async tx => {
      const record = await tx.deploymentLog.findUnique({where:{id:deploymentId},select:{serverId:true}});
      if (!record || (record.serverId || "local") !== serverId) fail("Deployment target binding changed");
      let appId: string | undefined;
      if (server) { const app = await tx.app.create({data:{name,containerId:containerId!,containerName:name,image:body.image!,serverId,status:inspect.State.Running?"RUNNING":"STOPPED"}}); appId=app.id; }
      const original=snapshot(inspect,image.RepoDigests || []);
      const next: DeploymentState={...state,runtime:{...state.runtime,...(appId?{appId}:{}),operation:{id:operation,name,phase:"completed"}},original,current:original,retained:[]};
      delete next.pending;
      if ((await tx.appSetting.updateMany({where:{key:saved.key,value},data:{value:sealDeployment(next)}})).count !== 1) fail("Deployment metadata drift");
    });
    return {containerId,status:!inspect.State.Running || inspect.State.Health?.Status === "unhealthy" ? "FAILED" : inspect.State.Health?.Status === "healthy" ? "RUNNING" : "UNVERIFIED",readiness:inspect.State.Health?.Status || "unverified",routing};
  } catch {
    if (containerId && !state.runtime.containerIds.includes(containerId)) {
      try { await journal({containerIds:[containerId],operation:{id:operation,name,phase:"runtime_uncertain"}}); } catch { /* Name and operation identity remain available when persistence is unavailable. */ }
    }
    if (!mutationAttempted) {
      const next={...state}; delete next.pending;
      next.runtime={...next.runtime,operation:{id:operation,name,phase:"failed_before_mutation"}};
      await prisma.appSetting.updateMany({where:{key:saved.key,value},data:{value:sealDeployment(next)}}).catch(()=>{});
    } else if (!containerId && api && state.runtime.imageDigest) {
      // A lost create response is not permission to retry or delete by name.
      try {
        const found=await api.call("GET",`/containers/${encodeURIComponent(name)}/json`);
        if (/^[a-f0-9]{64}$/.test(found.Id) && found.Name === "/"+name && found.Image === state.runtime.imageDigest && found.Config?.Labels?.["vps-panel.operation"] === operation && found.Config?.Labels?.["vps-panel.deployment"] === deploymentId) {
          containerId=found.Id;
          await journal({containerIds:[containerId],inspect:found,operation:{id:operation,name,phase:"create_response_reconciled"}});
        }
      } catch { /* Original encrypted journal remains authoritative and blocked. */ }
    }
    fail(containerId ? `Image deployment or readback failed; exact container ${containerId} is retained. Inspect history and target before retrying.` : "Image deployment failed; encrypted definition and operation journal are retained. Inspect history and target before retrying. No automatic deletion was attempted.",502);
  }
  finally { await api?.close(); }
}
