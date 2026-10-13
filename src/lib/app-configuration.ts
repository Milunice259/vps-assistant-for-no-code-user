import { isIP } from "node:net";
import { createPayload, configurationHash, envTarget, withEnvTarget, replaceTarget, listTargetProfiles, type Target } from "@/lib/container-recreate";
import { encodeProfileVars, decodeEncryptedVars } from "@/lib/env-profile";
import { prisma } from "@/lib/db";

import { inspectedRouting, routingView, checkRouting, transformRouting, routingReadback, verifyRoutingTls, validateDomain, validateRouting, type RoutingInput } from "@/lib/app-routing";

export type ConfigurationInput = {
  name: string;
  domain?: string | null; // Omitted preserves all routing; null removes only this panel's route.
  routing?: RoutingInput | null;
  cpuLimit: number | null;
  memoryLimit: number | null;
  restartPolicy: "no" | "always" | "unless-stopped" | "on-failure";
  maximumRetryCount: number;
  healthCheck?: string | null; // Omitted means preserve native exec/shell check and timing.
  logDriver: string;
  logMaxSize: string;
  logMaxFiles: number | null;
  ports: { hostIp: string; hostPort: number; containerPort: number; protocol: "tcp" | "udp" }[];
  networks: string[];
};
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export function validateConfiguration(value: unknown): ConfigurationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid configuration", 400);
  const v = value as ConfigurationInput;
  const keys = ["name", "domain", "routing", "cpuLimit", "memoryLimit", "restartPolicy", "maximumRetryCount", "healthCheck", "logDriver", "logMaxSize", "logMaxFiles", "ports", "networks"];
  if (Object.keys(v).some(k => !keys.includes(k)) || typeof v.name !== "string" || !v.name.trim() || v.name.length > 100 || /[\x00-\x1f]/.test(v.name)) fail("Invalid display name or configuration fields", 400);
  if (v.domain !== undefined) validateDomain(v.domain);
  if (v.domain) validateRouting(v.routing);
  else if (v.routing != null) fail("A domain is required for routing settings", 400);
  if (v.cpuLimit !== null && (typeof v.cpuLimit !== "number" || !Number.isFinite(v.cpuLimit) || v.cpuLimit < 0.001 || v.cpuLimit > 1024)) fail("CPU must be empty or between 0.001 and 1024 cores", 400);
  if (v.memoryLimit !== null && !integer(v.memoryLimit, 6, 16_777_216)) fail("Memory must be empty or a whole number of MiB (minimum 6)", 400);
  if (!["no", "always", "unless-stopped", "on-failure"].includes(v.restartPolicy) || !integer(v.maximumRetryCount, 0, 1000) || (v.restartPolicy !== "on-failure" && v.maximumRetryCount !== 0)) fail("Invalid restart policy or retry count", 400);
  if (v.healthCheck !== undefined && v.healthCheck !== null && (typeof v.healthCheck !== "string" || !v.healthCheck.trim() || v.healthCheck.length > 4096 || v.healthCheck.includes("\0"))) fail("Invalid health check command", 400);
  if (typeof v.logDriver !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(v.logDriver) || typeof v.logMaxSize !== "string" || (v.logMaxSize !== "" && !/^[1-9]\d{0,8}[kmg]$/.test(v.logMaxSize)) || (v.logMaxFiles !== null && !integer(v.logMaxFiles, 1, 1000))) fail("Invalid log driver or rotation limits", 400);
  if (!Array.isArray(v.ports) || v.ports.length > 100 || v.ports.some(p => !p || Object.keys(p).some(k => !["hostIp", "hostPort", "containerPort", "protocol"].includes(k)) || typeof p.hostIp !== "string" || (p.hostIp !== "" && !isIP(p.hostIp)) || !integer(p.hostPort, 1, 65535) || !integer(p.containerPort, 1, 65535) || !["tcp", "udp"].includes(p.protocol))) fail("Invalid published ports", 400);
  if (new Set(v.ports.map(p => `${p.hostIp}:${p.hostPort}/${p.protocol}`)).size !== v.ports.length) fail("Duplicate published port", 400);
  if (!Array.isArray(v.networks) || !v.networks.length || v.networks.length > 32 || v.networks.some(n => typeof n !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(n) || ["host", "none"].includes(n)) || new Set(v.networks).size !== v.networks.length) fail("Select distinct bridge networks; host/none mode is not supported by recoverable replacement", 400);
  return structuredClone(v);
}
function savedConfiguration(target: Target) {
  if (!target.state.configuration) return null;
  const settings = JSON.parse(decodeEncryptedVars(target.state.configuration).settings);
  // Commands are opaque secrets, not safely redactable text (including reversible encodings).
  return Object.fromEntries(["name", "domain", "routing", "cpuLimit", "memoryLimit", "restartPolicy", "maximumRetryCount", "logDriver", "logMaxSize", "logMaxFiles", "ports", "networks"].filter(k => Object.hasOwn(settings, k)).map(k => [k, settings[k]]));
}
export function inspectedConfiguration(target: Target): ConfigurationInput {
  const c = target.inspect;
  const ports: ConfigurationInput["ports"] = [];
  for (const [key, bindings] of Object.entries(c.HostConfig.PortBindings || {})) {
    const [port, protocol] = key.split("/");
    for (const b of (bindings || []) as { HostIp: string; HostPort: string }[]) ports.push({ hostIp: b.HostIp || "", hostPort: Number(b.HostPort), containerPort: Number(port), protocol: protocol as "tcp" | "udp" });
  }
  const saved = target.state.configuration ? JSON.parse(decodeEncryptedVars(target.state.configuration).settings) : null;
  const { domain, routing } = inspectedRouting(target);
  return { name: saved?.name || target.app?.name || c.Name.slice(1), domain, routing, cpuLimit: c.HostConfig.NanoCpus ? c.HostConfig.NanoCpus / 1e9 : c.HostConfig.CpuQuota > 0 ? c.HostConfig.CpuQuota / (c.HostConfig.CpuPeriod || 100000) : null, memoryLimit: c.HostConfig.Memory ? c.HostConfig.Memory / 1048576 : null, restartPolicy: c.HostConfig.RestartPolicy?.Name || "no", maximumRetryCount: c.HostConfig.RestartPolicy?.MaximumRetryCount || 0, logDriver: c.HostConfig.LogConfig?.Type || "json-file", logMaxSize: c.HostConfig.LogConfig?.Config?.["max-size"] || "", logMaxFiles: c.HostConfig.LogConfig?.Config?.["max-file"] ? Number(c.HostConfig.LogConfig.Config["max-file"]) : null, ports, networks: Object.keys(c.NetworkSettings?.Networks || {}) };
}
export async function configurationView(appId: string) {
  const target = await envTarget(appId);
  try {
    let replacementSupported = true;
    try { createPayload(target.inspect, target.inspect.Config.Env); } catch { replacementSupported = false; }
    const info = await target.api.call("GET", "/info");
    const networks = await target.api.call("GET", "/networks");
    const backing = (info.DriverStatus || []).find((r: string[]) => r[0] === "Backing Filesystem")?.[1] || "unknown";
    const settings = inspectedConfiguration(target);
    return { appId, containerId: target.inspect.Id, containerName: target.inspect.Name.slice(1), serverId: target.serverId, revision: target.revision, running: !!target.inspect.State.Running, pending: !!target.state.operation, adopted: !!target.state.configuration, replacementSupported,
      runtime: settings,
      routing: await routingView(target),
      health: { status: target.inspect.State.Health?.Status || "not configured", configured: !!target.inspect.Config.Healthcheck && target.inspect.Config.Healthcheck.Test?.[0] !== "NONE", type: ["CMD", "CMD-SHELL", "NONE"].includes(target.inspect.Config.Healthcheck?.Test?.[0]) ? target.inspect.Config.Healthcheck.Test[0] : "UNKNOWN", intervalNs: target.inspect.Config.Healthcheck?.Interval || null, timeoutNs: target.inspect.Config.Healthcheck?.Timeout || null, startPeriodNs: target.inspect.Config.Healthcheck?.StartPeriod || null, retries: target.inspect.Config.Healthcheck?.Retries || null },
      metadata: target.app ? { name: target.app.name, cpuLimit: target.app.cpuLimit, memoryLimit: target.app.memoryLimit, storageLimit: target.app.storageLimit, restartPolicy: target.app.restartPolicy, ports: target.app.ports } : null,
      saved: savedConfiguration(target),
      logDrivers: (info.Plugins?.Log || []) as string[], availableNetworks: networks.filter((n: { Name: string; Driver: string; Scope: string; Ingress?: boolean }) => n.Driver === "bridge" && n.Scope === "local" && !n.Ingress).map((n: { Name: string }) => n.Name) as string[],
      storage: { driver: info.Driver || "unknown", backingFilesystem: backing, configuredSize: target.inspect.HostConfig.StorageOpt?.size || null, capability: info.Driver === "overlay2" && backing === "xfs" ? "unverified" : "unsupported", reason: "Writable-layer quota requires verified driver and filesystem mount support; volumes and bind mounts are not covered. This editor does not claim or change a storage quota." } };
  } finally { await target.api.close(); }
}
export function transformConfiguration(target: Target, settings: ConfigurationInput, payload: ReturnType<typeof createPayload>) {
  const before = inspectedConfiguration(target);
  const host = payload.HostConfig;
  if (settings.cpuLimit !== before.cpuLimit) { host.NanoCpus = settings.cpuLimit === null ? 0 : Math.round(settings.cpuLimit * 1e9); host.CpuPeriod = 0; host.CpuQuota = 0; }
  if (settings.memoryLimit !== before.memoryLimit) {
    const memory = settings.memoryLimit === null ? 0 : settings.memoryLimit * 1048576;
    if (memory && (host.MemoryReservation > memory || (host.MemorySwap > 0 && host.MemorySwap < memory))) fail("Requested memory conflicts with preserved native swap/reservation limits", 422);
    host.Memory = memory;
    if (memory && !host.MemorySwap) host.MemorySwap = memory * 2;
    if (!memory) host.MemorySwap = 0;
  }
  host.RestartPolicy = { Name: settings.restartPolicy, MaximumRetryCount: settings.maximumRetryCount };
  if (settings.healthCheck !== undefined) payload.Healthcheck = settings.healthCheck === null ? { Test: ["NONE"] } : { ...payload.Healthcheck, Test: ["CMD-SHELL", settings.healthCheck] };
  if (settings.logDriver !== before.logDriver && !["json-file", "local", "none"].includes(settings.logDriver)) fail("Changing to a remote logging driver is not supported", 422);
  if (!["json-file", "local"].includes(settings.logDriver) && (settings.logMaxSize || settings.logMaxFiles !== null)) fail("Rotation controls require json-file or local logging", 400);
  const logOptions = settings.logDriver === before.logDriver ? { ...host.LogConfig?.Config } : {};
  delete logOptions["max-size"]; delete logOptions["max-file"];
  if (settings.logMaxSize) logOptions["max-size"] = settings.logMaxSize;
  if (settings.logMaxFiles !== null) logOptions["max-file"] = String(settings.logMaxFiles);
  host.LogConfig = { Type: settings.logDriver, Config: logOptions };
  if (configurationHash(settings.ports) !== configurationHash(before.ports)) {
    if (host.PublishAllPorts) fail("Disable implicit publish-all ports outside this editor before changing published ports", 422);
    host.PortBindings = {};
    for (const p of settings.ports) { const key = `${p.containerPort}/${p.protocol}`; (host.PortBindings[key] ||= []).push({ HostIp: p.hostIp, HostPort: String(p.hostPort) }); (payload.ExposedPorts ||= {})[key] = {}; }
  }
  const endpoints = payload.NetworkingConfig.EndpointsConfig;
  for (const name of Object.keys(endpoints)) if (!settings.networks.includes(name)) delete endpoints[name];
  for (const name of settings.networks) endpoints[name] ||= { IPAMConfig: null, Aliases: null, Links: null, DriverOpts: null };
  if (!settings.networks.includes(host.NetworkMode)) host.NetworkMode = settings.networks[0];
  transformRouting(target, settings.domain, settings.routing, payload);
}
async function checkSettings(target: Target, settings: ConfigurationInput) {
  const info = await target.api.call("GET", "/info");
  if (!info.Plugins?.Log?.includes(settings.logDriver)) fail("Logging driver is not installed on this server", 422);
  const networks = await target.api.call("GET", "/networks");
  if (settings.networks.some(name => !networks.some((n: { Name: string; Driver: string; Scope: string; Ingress?: boolean }) => n.Name === name && n.Driver === "bridge" && n.Scope === "local" && !n.Ingress))) fail("Network is unavailable or not a supported local bridge", 422);
  const payload = createPayload(target.inspect, target.inspect.Config.Env);
  transformConfiguration(target, settings, payload);
  return checkRouting(target, settings.domain, settings.routing, settings.networks);
}
export async function previewConfiguration(appId: string, revision: unknown, action: unknown, input: unknown) {
  if (action !== "apply" && action !== "adopt") fail("Invalid configuration action", 400);
  const validated = action === "apply" ? validateConfiguration(input) : null;
  const target = await envTarget(appId);
  try {
    if (revision !== target.revision || target.state.operation) fail("Configuration changed or an operation is pending; inspect again");
    const before = inspectedConfiguration(target);
    const settings = action === "adopt" ? before : validated!;
    if (action === "adopt" && configurationHash(input) !== configurationHash(before)) fail("Adoption records inspected runtime only; apply changes separately", 400);
    const routingCheck = action === "apply" ? await checkSettings(target, settings) : null;
    const binding = JSON.stringify({ appId, revision, action, settings, routingFingerprint: routingCheck?.fingerprint || null });
    return { routingCheck, token: encodeProfileVars({ binding }), confirmation: `${action === "adopt" ? "ADOPT" : "APPLY"} ${target.inspect.Id.slice(0,12)}`, revision, action, changes: Object.keys(settings).filter(k => configurationHash(settings[k as keyof ConfigurationInput]) !== configurationHash(before[k as keyof ConfigurationInput])), impact: action === "adopt" ? "Records this exact inspected runtime in panel settings. No Docker mutation." : `Replaces this exact container; ${target.inspect.State.Running ? "temporary downtime and readiness check" : "remains stopped"}. Environment, startup, mounts and security are preserved. The stopped original is retained for recovery. Published ports can expose the app; no firewall or external reachability claim.` };
  } finally { await target.api.close(); }
}
export async function applyConfiguration(appId: string, token: unknown, confirmation: unknown) {
  if (typeof token !== "string" || token.length > 100_000) fail("Invalid configuration preview", 400);
  let bound: { appId: string; revision: string; action: string; settings: ConfigurationInput; routingFingerprint?: string | null };
  try { bound = JSON.parse(decodeEncryptedVars(token).binding); } catch { fail("Invalid configuration preview", 400); }
  if (bound.appId !== appId || !["apply", "adopt"].includes(bound.action)) fail("Preview belongs to another target", 400);
  const validated = bound.action === "apply" ? validateConfiguration(bound.settings) : null;
  const applied = await withEnvTarget(appId, async target => {
    if (bound.revision !== target.revision || confirmation !== `${bound.action === "adopt" ? "ADOPT" : "APPLY"} ${target.inspect.Id.slice(0,12)}`) fail("Preview is stale or typed confirmation does not match");
    if (bound.action === "adopt") {
      if (configurationHash(bound.settings) !== configurationHash(inspectedConfiguration(target))) fail("Runtime changed; inspect before adoption");
      const configuration = encodeProfileVars({ settings: JSON.stringify(bound.settings), runtime: target.revision });
      const state = { ...target.state, configuration }; delete state.operation; delete state.lockedRuntime; delete state.lockedRunning;
      const saved = await prisma.appSetting.updateMany({ where: { key: target.key, value: target.row!.value }, data: { value: JSON.stringify(state) } });
      if (saved.count !== 1) fail("Adoption metadata changed");
      target.state = state;
      const readback = await prisma.appSetting.findUnique({ where: { key: target.key } });
      if (readback?.value !== JSON.stringify(state)) fail("Adoption readback is unavailable", 503);
      return { adopted: true, verified: true, newAppId: appId, newContainerId: target.inspect.Id };
    }
    const settings = validated!;
    const routingCheck = await checkSettings(target, settings);
    if ((routingCheck?.fingerprint || null) !== (bound.routingFingerprint || null)) fail("Proxy configuration changed; preview again");
    const desired = createPayload(target.inspect, target.inspect.Config.Env);
    transformConfiguration(target, settings, desired);
    const preservedRoute = inspectedRouting(target);
    const storedSettings = settings.domain === undefined ? { ...settings, domain: preservedRoute.domain, routing: preservedRoute.routing } : settings;
    const configuration = encodeProfileVars({ settings: JSON.stringify(storedSettings), runtime: configurationHash(desired) });
    const result = await replaceTarget(target, target.inspect.Config.Env, await listTargetProfiles(target), target.state.baseline, null, false, { transform: payload => transformConfiguration(target, settings, payload), configuration });
    const routing = storedSettings.domain && storedSettings.routing && result.newContainerId ? await routingReadback(target, result.newContainerId, storedSettings.domain, storedSettings.routing, false) : { nativeConfigurationVerified: true, activeProxy: "unverified", tls: "not_requested" };
    return { ...result, routing, settings: { name: settings.name, domain: storedSettings.domain, cpuLimit: settings.cpuLimit, memoryLimit: settings.memoryLimit, restartPolicy: settings.restartPolicy, logDriver: settings.logDriver, logMaxSize: settings.logMaxSize, logMaxFiles: settings.logMaxFiles, ports: settings.ports, networks: settings.networks } };
  });
  // The replacement and native readback have completed. TLS failure must never roll back or turn an applied configuration into a retryable mutation error.
  if ("settings" in applied && applied.settings.domain && applied.newAppId) {
    try {
      const target = await envTarget(applied.newAppId);
      try {
        const native = inspectedRouting(target);
        if (target.inspect.Id !== applied.newContainerId || native.domain !== applied.settings.domain || !native.routing) throw new Error("Routing changed after apply");
        return { ...applied, routing: { ...applied.routing, ...await verifyRoutingTls(target, native.domain, native.routing) } };
      } finally { await target.api.close(); }
    } catch { return { ...applied, routing: { ...applied.routing, tls: "unavailable", reason: "Configuration applied; repeat read-only inspection to verify TLS" } }; }
  }
  return applied;
}
