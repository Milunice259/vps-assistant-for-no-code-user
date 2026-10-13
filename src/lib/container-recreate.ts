import { request as httpRequest } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { decodeEnvBaseline, encodeEnvBaseline, decodeProfileVars, encodeProfileVars, decodeEncryptedVars } from "@/lib/env-profile";
import { isLocalServer } from "@/lib/local-server";
import { createSSHConnection, closeSSH } from "@/lib/ssh";

// Native Engine payloads, not a partial docker-run clone. No inspect or executor errors escape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- native Engine JSON boundary validated below
type Json = Record<string, any>;
export type StoredProfile = { id: string; name: string; vars: string; isActive: boolean; createdAt: string };
type State = { current?: string; baseline?: string; baselineSeal?: string; expected?: string; profiles?: StoredProfile[]; operation?: string; recovery?: string; lockedRuntime?: string; lockedRunning?: boolean; ownerPid?: number; configuration?: string };
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
export function configurationHash(value: unknown): string {
  // Engine map order is unstable; Docker Env/Cmd arrays are ordered and must not be sorted.
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,item]) => [k,canonical(item)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
}
const hash = configurationHash;
const pathId = (id: string) => encodeURIComponent(id);
const activeOperations = new Set<string>();

export function createPayload(inspect: Json, env: string[]): Json {
  const host = structuredClone(inspect.HostConfig);
  const config = structuredClone(inspect.Config);
  // Engine normalizes the default only after first start; null and false both mean OOM killing enabled.
  if (host && host.OomKillDisable == null) host.OomKillDisable = false;
  if (!host || !config || !inspect.Image || !Array.isArray(config.Env) || !Array.isArray(inspect.Mounts)) fail("Unsupported or incomplete runtime configuration", 422);
  if (host.AutoRemove || host.ContainerIDFile || host.VolumesFrom?.length || /^(container:|host$)/.test(host.NetworkMode || "") || host.PidMode || host.IpcMode === "host" || host.IpcMode?.startsWith("container:") || host.Privileged || inspect.Config.Labels?.["com.docker.swarm.service.id"]) fail("Unsupported runtime configuration; original container was not changed", 422);
  const allowed = new Set(["Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr", "ExposedPorts", "Tty", "OpenStdin", "StdinOnce", "Env", "Cmd", "Healthcheck", "ArgsEscaped", "Image", "Volumes", "WorkingDir", "Entrypoint", "NetworkDisabled", "MacAddress", "OnBuild", "Labels", "StopSignal", "StopTimeout", "Shell"]);
  if (Object.keys(config).some(k => !allowed.has(k) && config[k] != null) || config.OnBuild?.length || config.ArgsEscaped) fail("Unsupported runtime configuration; original container was not changed", 422);
  // Bind options and native mount options are kept verbatim. Resolve image-created anonymous volumes by name.
  for (const mount of inspect.Mounts) {
    if (!["volume", "bind", "tmpfs"].includes(mount.Type)) fail("Unsupported runtime mount", 422);
    const specified = (host.Mounts || []).some((m: Json) => m.Target === mount.Destination) || (host.Binds || []).some((b: string) => b.split(":")[1] === mount.Destination) || Object.hasOwn(host.Tmpfs || {}, mount.Destination);
    if (!specified) {
      if (mount.Type !== "volume" || !mount.Name) fail("Unsupported runtime mount", 422);
      (host.Mounts ||= []).push({ Type: "volume", Source: mount.Name, Target: mount.Destination, ReadOnly: !mount.RW });
    }
  }
  const endpoints: Json = {};
  for (const [name, endpoint] of Object.entries(inspect.NetworkSettings?.Networks || {}) as [string, Json][]) {
    endpoints[name] = { IPAMConfig: endpoint.IPAMConfig && Object.keys(endpoint.IPAMConfig).length ? endpoint.IPAMConfig : null, Aliases: endpoint.Aliases?.filter((a: string) => a !== inspect.Id.slice(0, 12) && a !== inspect.Id) || null, Links: endpoint.Links || null, DriverOpts: endpoint.DriverOpts || null };
  }
  if (config.Hostname === inspect.Id.slice(0, 12)) config.Hostname = "";
  return { ...config, Image: inspect.Image, Env: env, HostConfig: host, NetworkingConfig: { EndpointsConfig: endpoints } };
}

export async function engine(server: Json | null) {
  const ssh = server ? await createSSHConnection({ serverId: server.id, host: server.host, port: server.port, username: server.username, password: server.encryptedPass ? decrypt(server.encryptedPass) : undefined, privateKey: server.encryptedKey ? decrypt(server.encryptedKey) : undefined }) : null;
  return {
    close: async () => { if (ssh) await closeSSH(ssh); },
    call: async (method: string, path: string, body?: unknown): Promise<Json> => {
      const serialized = body === undefined ? "" : JSON.stringify(body);
      let status: number, text: string;
      if (!ssh) {
        [status, text] = await new Promise<[number, string]>((resolve, reject) => {
          const req = httpRequest({ socketPath: "/var/run/docker.sock", path, method, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(serialized) } }, res => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", chunk => { data += chunk; if (data.length > 10_000_000) req.destroy(new Error("Engine response too large")); });
            res.on("end", () => resolve([res.statusCode || 0, data]));
            res.on("error", reject);
          });
          req.setTimeout(60_000, () => req.destroy(new Error("Engine timeout")));
          req.on("error", reject); req.end(serialized);
        });
      } else {
        // stdin keeps the config/env out of shell command arguments and logs. curl HTTP status is explicit.
        const stream = await ssh.spawn(`curl --silent --max-time 55 --unix-socket /var/run/docker.sock -X ${method} -H 'Content-Type: application/json' ${body === undefined ? "" : "--data-binary @-"} --write-out '\\n%{http_code}' 'http://localhost${path}'`);
        [status, text] = await new Promise<[number, string]>((resolve, reject) => {
          let data = "", exit: number | undefined;
          const timer = setTimeout(() => { stream.close(); reject(new Error("Engine timeout")); }, 60_000);
          stream.on("data", (chunk: Buffer) => { data += chunk.toString(); if (data.length > 10_000_000) { stream.close(); reject(new Error("Engine response too large")); } });
          stream.stderr.on("data", () => {});
          stream.on("exit", (code: number) => { exit = code; });
          stream.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
          stream.on("close", () => { clearTimeout(timer); const i = data.lastIndexOf("\n"); if (exit !== 0 || !/^\d{3}$/.test(data.slice(i + 1))) return reject(new Error("Engine command failed")); resolve([Number(data.slice(i + 1)), data.slice(0, i)]); });
          stream.end(serialized);
        });
      }
      if (status < 200 || status >= 300) fail("Docker operation failed; no secret configuration is included", 502);
      if (path.startsWith("/images/create?")) {
        const events = text.split("\n").filter(Boolean).map(line => JSON.parse(line));
        if (!events.length || events.some(event => event.error || event.errorDetail)) fail("Image pull failed", 502);
        return {};
      }
      return text ? JSON.parse(text) : {};
    },
  };
}

export async function envTarget(appId: string, recoveryRead = false) {
  const parts = appId.split("::");
  const virtual = parts[0] === "local" || parts[0] === "discovered";
  if (virtual && (parts.length !== (parts[0] === "local" ? 2 : 3) || !/^[a-zA-Z0-9_.-]+$/.test(parts.at(-1) || ""))) fail("Invalid application ID", 400);
  const app = virtual ? null : await prisma.app.findUnique({ where: { id: appId }, include: { server: true } });
  if (!virtual && !app?.containerId) fail("Application container not found", 404);
  const serverId = virtual ? (parts[0] === "local" ? "local" : parts[1]) : app!.serverId;
  const server = isLocalServer(serverId) ? null : (app?.server || await prisma.server.findUnique({ where: { id: serverId } }));
  if (!isLocalServer(serverId) && !server) fail("Server not found", 404);
  const api = await engine(server);
  try {
    const inspect = await api.call("GET", `/containers/${pathId(virtual ? parts.at(-1)! : app!.containerId!)}/json`);
    if (!/^[a-f0-9]{64}$/.test(inspect.Id) || !/^\/[a-zA-Z0-9_.-]+$/.test(inspect.Name)) fail("Invalid runtime identity", 422);
    if (!recoveryRead && /-safe-(?:old|new)-[a-f0-9-]{36}$/.test(inspect.Name)) fail("Retained recovery container is read-only; inspect recovery to open the current application");
    // Stable server/name ownership for discovery profiles; an exact full ID guards name reuse.
    const originalName = recoveryRead ? inspect.Name.replace(/-safe-(?:old|new)-[a-f0-9-]{36}$/, "") : inspect.Name;
    const key = "safe-env:" + hash([serverId, originalName]);
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state: State = row ? JSON.parse(row.value) : {};
    if (!recoveryRead && state.current && state.current !== inspect.Id) fail("Container identity drift; reconcile the saved baseline before retrying");
    const revision = hash([inspect.Id, inspect.Image, inspect.Name, inspect.Config, inspect.HostConfig, [...inspect.Mounts].sort((a: Json, b: Json) => a.Destination.localeCompare(b.Destination)), inspect.NetworkSettings?.Networks && Object.fromEntries(Object.entries(inspect.NetworkSettings.Networks).map(([name, endpoint]) => { const e = endpoint as Json; return [name, [e.NetworkID, e.IPAMConfig, e.Aliases, e.Links, e.DriverOpts]]; })), inspect.State.Running, row?.value || null, app?.updatedAt || null]);
    return { appId, app, serverId, virtual, inspect, key, state, row, api, revision };
  } catch (error) { await api.close(); throw error; }
}

export type Target = Awaited<ReturnType<typeof envTarget>>;

// Read-only Engine reconciliation. A stopped original is accepted explicitly, never restarted here.
export async function recoveryPreview(appId: string) {
  const target = await envTarget(appId, true);
  try {
    const profiles = await listTargetProfiles(target);
    const state = target.state;
    if (!state.operation && state.current && state.current !== target.inspect.Id) {
      const current = await target.api.call("GET", `/containers/${pathId(state.current)}/json`);
      if (current.Name !== target.inspect.Name.replace(/-safe-(?:old|new)-[a-f0-9-]{36}$/, "")) fail("Current application identity unavailable");
      target.inspect = current;
    }
    let canReconcile = false;
    if (state.operation) {
      const saved = state.recovery ? JSON.parse(decodeEncryptedVars(state.recovery).inspect) : null;
      const original = saved ? await target.api.call("GET", `/containers/${pathId(saved.Id)}/json`) : target.inspect;
      const inventory = await target.api.call("GET", "/containers/json?all=true");
      const recovery = state.recovery ? decodeEncryptedVars(state.recovery) : null;
      const candidatePresent = recovery && inventory.some((c: Json) => c.Id !== original.Id && c.Names?.some((n: string) => [saved.Name, "/" + recovery.candidateName].includes(n)));
      let ownerAlive = activeOperations.has(state.operation);
      if (state.ownerPid && state.ownerPid !== process.pid) { try { process.kill(state.ownerPid, 0); ownerAlive = true; } catch (error) { ownerAlive = (error as NodeJS.ErrnoException).code !== "ESRCH"; } }
      canReconcile = !ownerAlive && !candidatePresent && original.Id === state.current && original.Name === (saved?.Name || target.inspect.Name) && hash(createPayload(original, original.Config.Env)) === (saved ? hash(createPayload(saved, saved.Config.Env)) : state.lockedRuntime);
      target.inspect = original;
    }
    const binding = { appId, key: target.key, row: target.row?.value, runtime: hash(createPayload(target.inspect, target.inspect.Config.Env)), running: target.inspect.State.Running };
    const token = encodeProfileVars({ binding: JSON.stringify(binding) });
    return { newAppId:target.virtual?`discovered::${target.serverId}::${target.inspect.Id.slice(0,12)}`:appId, activeProfileNames:profiles.filter(p=>p.isActive).map(p=>p.name), pending: !!state.operation, canReconcile, baselineMissing: profiles.some(p => p.isActive) && !state.baseline, containerId: target.inspect.Id, running: !!target.inspect.State.Running, token, confirmation: `RECONCILE ${target.inspect.Id.slice(0,12)} ${target.inspect.State.Running ? "RUNNING" : "STOPPED"}` };
  } finally { await target.api.close(); }
}

export async function reconcileRecovery(appId: string, token: unknown, confirmation: unknown) {
  if (typeof token !== "string" || token.length > 2_000_000) fail("Invalid recovery preview", 400);
  const preview = await recoveryPreview(appId);
  if (!preview.pending || !preview.canReconcile || confirmation !== preview.confirmation) fail("Recovery state is not ready for reconciliation");
  const supplied = decodeEncryptedVars(token).binding;
  if (supplied !== decodeEncryptedVars(preview.token).binding) fail("Recovery preview changed; inspect again");
  const binding = JSON.parse(supplied);
  const state: State = JSON.parse(binding.row);
  delete state.operation; delete state.recovery; delete state.lockedRuntime; delete state.lockedRunning;
  await prisma.$transaction(async tx => {
    const result = await tx.appSetting.updateMany({ where: { key: binding.key, value: binding.row }, data: { value: JSON.stringify(state) } });
    if (result.count !== 1) fail("Recovery state changed");
    if (!appId.startsWith("local::") && !appId.startsWith("discovered::")) await tx.app.update({where:{id:appId},data:{status:preview.running?"RUNNING":"STOPPED"}});
  });
  return { reconciled: true, running: preview.running, containerId: preview.containerId };
}

export async function importBaseline(appId: string, input: unknown, token?: unknown, confirmation?: unknown) {
  // An operator supplies the authoritative original array; current overwritten runtime is never a source.
  if (!Array.isArray(input) || input.length > 10_000 || !input.every(v => typeof v === "string" && v.includes("=") && !v.includes("\0")) || JSON.stringify(input).length > 1_000_000) fail("Supply the original Docker Env JSON array", 400);
  const baseline = encodeEnvBaseline(input);
  const target = await envTarget(appId);
  try {
    if (target.state.operation || (target.state.baseline && target.state.baselineSeal) || !(await listTargetProfiles(target)).some(p => p.isActive)) fail("Baseline import requires an idle legacy active profile with no saved baseline");
    const binding = JSON.stringify({appId,key:target.key,row:target.row?.value || null,id:target.inspect.Id,runtime:hash(createPayload(target.inspect,target.inspect.Config.Env)),env:input});
    const typed = `IMPORT ORIGINAL ${target.inspect.Id.slice(0,12)}`;
    if (token === undefined) return {token:encodeProfileVars({binding}),confirmation:typed,count:input.length,keys:input.map(v=>v.slice(0,v.indexOf("=")))};
    if (typeof token !== "string" || token.length > 2_000_000 || decodeEncryptedVars(token).binding !== binding || confirmation !== typed) fail("Baseline preview changed or confirmation does not match");
    const value = JSON.stringify({...target.state,current:target.inspect.Id,baseline,baselineSeal:encodeProfileVars({key:target.key,digest:hash(baseline)})});
    if (target.row) {
      const saved = await prisma.appSetting.updateMany({where:{key:target.key,value:target.row.value},data:{value}});
      if (saved.count !== 1) fail("Baseline target changed");
    } else { try { await prisma.appSetting.create({data:{key:target.key,value}}); } catch { fail("Baseline target changed"); } }
    return {imported:true,count:input.length};
  } finally { await target.api.close(); }
}
export async function listTargetProfiles(target: Target): Promise<StoredProfile[]> {
  if (target.virtual) return target.state.profiles || [];
  return (await prisma.envProfile.findMany({ where: { appId: target.appId }, orderBy: { createdAt: "desc" } })).map(p => ({...p, createdAt:p.createdAt.toISOString()}));
}

export async function withEnvTarget<T>(appId: string, mutate: (target: Target) => Promise<T>): Promise<T> {
  const target = await envTarget(appId);
  const operation = randomUUID();
  activeOperations.add(operation);
  try {
    if (target.state.operation) fail("An operation is pending; inspect its retained recovery container before retrying");
    const locked = JSON.stringify({ ...target.state, current: target.inspect.Id, operation, ownerPid:process.pid, lockedRuntime: hash(createPayload(target.inspect, target.inspect.Config.Env)), lockedRunning: target.inspect.State.Running });
    if (target.row) {
      const result = await prisma.appSetting.updateMany({ where: { key: target.key, value: target.row.value }, data: { value: locked } });
      if (result.count !== 1) fail("Another operation changed this target");
    } else {
      try { await prisma.appSetting.create({ data: { key: target.key, value: locked } }); } catch { fail("Another operation changed this target"); }
    }
    target.row = { key: target.key, value: locked, updatedAt: new Date() };
    target.state = JSON.parse(locked);
    return await mutate(target);
  } finally {
    activeOperations.delete(operation);
    if (target.state.operation === operation && !target.state.recovery && target.row) {
      const state = { ...target.state }; delete state.operation; delete state.lockedRuntime; delete state.lockedRunning;
      await prisma.appSetting.updateMany({ where: { key: target.key, value: target.row.value }, data: { value: JSON.stringify(state) } });
    }
    await target.api.close();
  }
}

export async function saveProfiles(target: Target, profiles: StoredProfile[]) {
  const state = { ...target.state, current: target.inspect.Id, profiles: target.virtual ? profiles : undefined }; delete state.operation;
  await prisma.$transaction(async tx => {
    if (!target.virtual) {
      for (const p of profiles) await tx.envProfile.upsert({where:{id:p.id},create:{...p,appId:target.appId},update:{name:p.name,vars:p.vars,isActive:p.isActive}});
      await tx.envProfile.deleteMany({where:{appId:target.appId,id:{notIn:profiles.map(p=>p.id)}}});
    }
    const saved = await tx.appSetting.updateMany({ where: {key:target.key,value:target.row!.value}, data:{value:JSON.stringify(state)} });
    if (saved.count !== 1) fail("Profile state changed");
  });
  target.state = state;
}

function targetBaseline(target: Target): string[] {
  if (!target.state.baselineSeal) fail("Baseline target binding is unavailable; authoritative reconciliation required");
  if (target.state.baselineSeal) {
    const seal = decodeEncryptedVars(target.state.baselineSeal);
    if (seal.key !== target.key || seal.digest !== hash(target.state.baseline)) fail("Baseline target or integrity mismatch");
  }
  return decodeEnvBaseline(target.state.baseline!);
}

export async function updateTargetProfiles(target: Target, profiles: StoredProfile[]) {
  const active = profiles.find(p => p.isActive);
  const existing = await listTargetProfiles(target);
  if (!active || existing.some(p => p.id === active.id && p.vars === active.vars)) return saveProfiles(target, profiles);
  if (!target.state.baseline) fail("Original environment baseline is unavailable; reconcile the legacy active profile first", 422);
  const baseline = targetBaseline(target);
  const overrides = decodeProfileVars(active.vars);
  const keys = new Set(Object.keys(overrides));
  const env = [...baseline.filter(v => !keys.has(v.slice(0,v.indexOf("=")))), ...Object.entries(overrides).map(([k,v])=>`${k}=${v}`)];
  return replaceTarget(target,env,profiles,target.state.baseline,active.name,false);
}

export async function changeProfile(appId: string, profileId: string | null, remove = false) {
  return withEnvTarget(appId, async target => {
    const profiles = await listTargetProfiles(target);
    const profile = profileId === null ? null : profiles.find(p => p.id === profileId);
    if (profileId !== null && !profile) fail("Profile not found", 404);
    if (remove && !profile!.isActive) {
      if (target.virtual) await saveProfiles(target, profiles.filter(p => p.id !== profileId));
      else await prisma.envProfile.delete({where:{id:profileId!,appId}});
      return { applied: true, reverted: false, profileName: null, newContainerId: target.inspect.Id, mergedCount: 0 };
    }
    if (profiles.some(p => p.isActive) && !target.state.baseline) fail("Original environment baseline is unavailable; reconcile the legacy active profile first", 422);
    const baseline = target.state.baseline ? targetBaseline(target) : target.inspect.Config.Env;
    const overrides = profile && !remove ? decodeProfileVars(profile.vars) : {};
    const keys = new Set(Object.keys(overrides));
    const env = [...baseline.filter((v: string) => !keys.has(v.slice(0,v.indexOf("=")))), ...Object.entries(overrides).map(([k,v]) => `${k}=${v}`)];
    return replaceTarget(target, env, profiles.map(p => ({...p,isActive:!remove && p.id === profileId})).filter(p => !(remove && p.id === profileId)), encodeEnvBaseline(baseline), profile && !remove ? profile.name : null, remove);
  });
}

export async function recreateContainer(appId: string) {
  return withEnvTarget(appId, async target => replaceTarget(target, target.inspect.Config.Env, await listTargetProfiles(target), target.state.baseline, null, false));
}

// Configuration/domain owners can patch only the native payload; recovery and identity CAS stay here.
export type ReplacementOptions = { transform?: (payload: Json) => void; configuration?: string; commit?: (tx: import("@prisma/client").Prisma.TransactionClient, inspect: Json) => Promise<void> };
export async function replaceTarget(target: Target, env: string[], profiles: StoredProfile[], baseline: string | undefined, profileName: string | null, remove: boolean, options: ReplacementOptions = {}) {
  const old = target.inspect;
  const payload = createPayload(old, env);
  const originalNets = structuredClone(payload.NetworkingConfig.EndpointsConfig);
  options.transform?.(payload);
  payload.Labels = {...payload.Labels, "vps-assistant.safe-operation":target.state.operation};
  const fingerprint = hash(createPayload(old, old.Config.Env));
  if (target.state.expected && target.state.expected !== fingerprint) fail("Runtime configuration drift; original container was not changed");
  const name = old.Name.slice(1);
  const backupName = `${name}-safe-old-${target.state.operation}`;
  const candidateName = `${name}-safe-new-${target.state.operation}`;
  const recovery = encodeProfileVars({ inspect: JSON.stringify(old), backupName, candidateName });
  const recoveryState = {...target.state,recovery};
  const recoveryValue = JSON.stringify(recoveryState);
  const persisted = await prisma.appSetting.updateMany({where:{key:target.key,value:target.row!.value},data:{value:recoveryValue}});
  if (persisted.count !== 1) fail("Target metadata changed");
  target.row!.value = recoveryValue; target.state = recoveryState;
  const api = target.api;

  let replacement: string | undefined;
  let touched = false;
  try {
    const fresh = await api.call("GET", `/containers/${old.Id}/json`);
    if (fresh.Id !== old.Id || fresh.Name !== old.Name || hash(createPayload(fresh,fresh.Config.Env)) !== fingerprint || fresh.State.Running !== old.State.Running) fail("Runtime configuration changed before execution");
    touched = true;
    await api.call("POST", `/containers/${old.Id}/update`, {RestartPolicy:{Name:"no",MaximumRetryCount:0}});
    if (old.State.Running) await api.call("POST", `/containers/${old.Id}/stop?t=30`);
    await api.call("POST", `/containers/${old.Id}/rename?name=${pathId(backupName)}`);
    for (const network of Object.keys(originalNets)) await api.call("POST", `/networks/${pathId(network)}/disconnect`, {Container:old.Id,Force:false});
    const created = await api.call("POST", `/containers/create?name=${pathId(candidateName)}`, payload);
    if (!/^[a-f0-9]{64}$/.test(created.Id)) fail("Replacement identity was not verified", 502);
    replacement = created.Id;
    await api.call("POST", `/containers/${replacement}/rename?name=${pathId(name)}`);
    if (old.State.Running) await api.call("POST", `/containers/${replacement}/start`);
    let verified = await api.call("GET", `/containers/${replacement}/json`);
    if (old.State.Running && payload.Healthcheck && payload.Healthcheck.Test?.[0] !== "NONE") {
      const deadline = Date.now() + 30_000;
      while (verified.State.Running && verified.State.Health?.Status === "starting" && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        verified = await api.call("GET", `/containers/${replacement}/json`);
      }
    }
    if (verified.Id !== replacement || verified.Name !== old.Name || verified.State.Running !== old.State.Running || hash(createPayload(verified,verified.Config.Env)) !== hash(payload)) fail("Replacement runtime configuration was not verified", 502);
    if (old.State.Running && payload.Healthcheck && payload.Healthcheck.Test?.[0] !== "NONE" && verified.State.Health?.Status !== "healthy") fail(verified.State.Health?.Status === "starting" ? "Replacement readiness timed out" : verified.State.Health?.Status === "unhealthy" ? "Replacement is unhealthy" : "Replacement readiness is unknown", 502);
    const state: State = {current:replacement,baseline,baselineSeal:baseline?encodeProfileVars({key:target.key,digest:hash(baseline)}):undefined,expected:hash(payload),profiles:target.virtual?profiles:undefined,configuration:options.configuration ?? target.state.configuration};
    await prisma.$transaction(async tx => {
      if (target.app) {
        const result = await tx.app.updateMany({where:{id:target.appId,containerId:target.app.containerId,updatedAt:target.app.updatedAt},data:{containerId:replacement,status:old.State.Running?"RUNNING":"STOPPED"}});
        if (result.count !== 1) fail("App metadata drift");
        await tx.envProfile.updateMany({where:{appId:target.appId},data:{isActive:false}});
        for (const p of profiles.filter(p=>p.isActive)) await tx.envProfile.update({where:{id:p.id,appId:target.appId},data:{isActive:true}});
        if (remove) await tx.envProfile.deleteMany({where:{appId:target.appId,id:{notIn:profiles.map(p=>p.id)}}});
      }
      if (target.app && !remove) for (const p of profiles) await tx.envProfile.update({where:{id:p.id,appId:target.appId},data:{name:p.name,vars:p.vars}});
      const saved = await tx.appSetting.updateMany({where:{key:target.key,value:recoveryValue},data:{value:JSON.stringify(state)}});
      if (saved.count !== 1) fail("Environment metadata drift");
      await options.commit?.(tx, verified);
    });
    target.state = state;
    // Retain the stopped old container with restart disabled, never delete recovery data/volumes.
    return {applied:true,reverted:remove,profileName,newContainerId:replacement,newAppId:target.virtual?`discovered::${target.serverId}::${replacement!.slice(0,12)}`:target.appId,mergedCount:env.length,verified:true,readiness:verified.State.Health?.Status || "unverified",recoveryContainerId:old.Id};
  } catch (error) {
    const readinessError = error instanceof Error && ["Replacement readiness timed out", "Replacement is unhealthy", "Replacement readiness is unknown"].includes(error.message) ? error.message : null;
    try {
      if (touched) {
        // Resolve by operation-owned name too: create may have succeeded with its response lost.
        if (!replacement) {
          let candidate: Json | undefined;
          const inventory = await api.call("GET", "/containers/json?all=true");
          if (inventory.some((c: Json) => c.Names?.includes("/" + candidateName))) candidate = await api.call("GET", `/containers/${pathId(candidateName)}/json`);
          if (candidate) {
            if (!/^[a-f0-9]{64}$/.test(candidate.Id) || candidate.Config.Labels?.["vps-assistant.safe-operation"] !== target.state.operation || hash(createPayload(candidate,candidate.Config.Env)) !== hash(payload)) throw new Error("Candidate ownership unavailable");
            replacement = candidate.Id;
          }
        }
        if (replacement) {
          const candidate = await api.call("GET", `/containers/${replacement}/json`);
          if (candidate.Id !== replacement || candidate.Config.Labels?.["vps-assistant.safe-operation"] !== target.state.operation || hash(createPayload(candidate,candidate.Config.Env)) !== hash(payload)) throw new Error("Candidate ownership unavailable");
          await api.call("DELETE", `/containers/${replacement}?force=true`);
        }
        const restored = await api.call("GET", `/containers/${old.Id}/json`);
        if (restored.Name !== old.Name) await api.call("POST", `/containers/${old.Id}/rename?name=${pathId(name)}`);
        for (const [network, endpoint] of Object.entries(originalNets)) if (!restored.NetworkSettings.Networks[network]) await api.call("POST", `/networks/${pathId(network)}/connect`, {Container:old.Id,EndpointConfig:endpoint});
        await api.call("POST", `/containers/${old.Id}/update`, {RestartPolicy:old.HostConfig.RestartPolicy});
        if (old.State.Running && !restored.State.Running) await api.call("POST", `/containers/${old.Id}/start`);
        const check = await api.call("GET", `/containers/${old.Id}/json`);
        if (check.Id !== old.Id || check.Name !== old.Name || check.State.Running !== old.State.Running || hash(createPayload(check,check.Config.Env)) !== fingerprint) throw new Error("Recovery readback failed");
      }
      const restoredState = {...target.state}; delete restoredState.operation; delete restoredState.recovery; delete restoredState.lockedRuntime; delete restoredState.lockedRunning;
      const restored = await prisma.appSetting.updateMany({where:{key:target.key,value:recoveryValue},data:{value:JSON.stringify(restoredState)}});
      if (restored.count !== 1) throw new Error("Recovery metadata unavailable");
      target.state = restoredState;
    } catch { fail("Operation failed; recovery is pending. Original container and encrypted recovery configuration are retained", 503); }
    fail(readinessError ? `${readinessError}; original runtime and profile metadata were restored` : "Operation failed; original runtime and profile metadata were restored", 502);
  }
}


