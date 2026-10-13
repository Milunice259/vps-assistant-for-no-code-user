import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:http";
import { envTarget, type Target } from "@/lib/container-recreate";
import { inspectedRouting, routingInventory, validateDomain, validateRouting, verifyRoutingTls } from "@/lib/app-routing";
import { getLocalServerInfo, isLocalServer } from "@/lib/local-server";
import { prisma } from "@/lib/db";

type Status = "healthy" | "unhealthy" | "unknown";
type Backend = { status: "verified" | "failed" | "unavailable" | "unsupported"; reason: string; statusCode?: number };
export type AppReadiness = {
  status: Status; output: string; checkedAt: string; containerState: string;
  container: { status: Status; state: string; health: "healthy" | "unhealthy" | "starting" | "none" | "unknown" };
  backend: Backend;
  tls: Awaited<ReturnType<typeof verifyRoutingTls>>;
};
// Registered private unicast addresses are intentional; loopback, metadata/link-local,
// unspecified, multicast and mapped IPv6 addresses are never probe destinations.
function allowedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  return isIP(address) === 6 && !address.includes(".") && /^(?:[23][0-9a-f]{3}|f[cd][0-9a-f]{2}):/i.test(address);

}
async function registeredAddresses(target: Target): Promise<string[]> {
  const server = isLocalServer(target.serverId) ? getLocalServerInfo() : target.app?.server || await prisma.server.findUnique({ where: { id: target.serverId } });
  const host = server?.host;
  if (typeof host !== "string") throw new Error("unavailable");
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    validateDomain(host);
    const dns = new Resolver({ timeout: 1500, tries: 1 });
    const records = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    if (records.some(r => r.status === "rejected" && !["ENODATA", "ENOTFOUND"].includes(r.reason?.code))) throw new Error("incomplete DNS");
    addresses = records.flatMap(r => r.status === "fulfilled" ? r.value : []);
  }
  if (!addresses.length || addresses.some(a => !allowedAddress(a))) throw new Error("unsafe address");
  return [...new Set(addresses)].sort();
}
async function probeBackend(address: string, port: number): Promise<Backend> {
  return new Promise(resolve => {
    let done = false;
    const finish = (result: Backend) => { if (done) return; done = true; clearTimeout(timer); req.destroy(); resolve(result); };
    // Numeric host, fixed path, no credentials/caller headers, no agent, redirects or body consumption.
    const req = request({ host: address, port, path: "/", method: "GET", agent: false, maxHeaderSize: 8192 }, res => {
      const code = res.statusCode || 0;
      finish({ status: code >= 200 && code < 300 ? "verified" : "failed", reason: code >= 200 && code < 300 ? "Backend HTTP responded successfully" : "Backend HTTP did not return a successful status; redirects are not followed", statusCode: code });
      res.destroy();
    });
    const timer = setTimeout(() => finish({ status: "failed", reason: "Backend HTTP deadline exceeded" }), 3000);
    req.once("error", () => finish({ status: "failed", reason: "Backend HTTP connection failed" }));
    req.end();
  });
}
export async function readTargetReadiness(target: Target): Promise<AppReadiness> {
  const state = target.inspect.State || {};
  const containerState = ["running", "exited", "created", "paused", "restarting", "removing", "dead"].includes(state.Status) ? state.Status : "unknown";
  const rawHealth = state.Health?.Status;
  const health = ["healthy", "unhealthy", "starting"].includes(rawHealth) ? rawHealth as "healthy" | "unhealthy" | "starting" : rawHealth ? "unknown" : "none";
  const status: Status = state.Running === false || health === "unhealthy" ? "unhealthy" : state.Running === true && !state.Paused && !state.Restarting && health === "healthy" ? "healthy" : "unknown";
  let backend: Backend = { status: "unsupported", reason: "No unambiguous inspected published backend TCP binding; internal-only backends are not probed" };
  let tls: AppReadiness["tls"] = { tls: "not_requested" };
  const native = inspectedRouting(target);
  let tlsChecked = false;
  try {
    const addresses = await registeredAddresses(target);
    if (native.owned && native.domain && native.routing) {
      validateDomain(native.domain); validateRouting(native.routing);
      // Pin the registered server identity for the existing DNS/SNI/chain/SAN verifier.
      const pinned = { ...target, serverId: "readiness-pinned", app: { ...target.app, server: { host: addresses[0] } } } as Target;
      tls = await verifyRoutingTls(pinned, native.domain, native.routing);
      tlsChecked = true;
    } else if (native.owned) tls = { tls: "unavailable", reason: "Native route is incomplete" };
    if (state.Running !== true || state.Paused || state.Restarting) backend = { status: "unavailable", reason: "Container is not actively running" };
    else {
      const ports = Object.entries(target.inspect.NetworkSettings?.Ports || {}).filter(([key]) => /^\d+\/tcp$/.test(key) && (!native.owned || Number(key.split("/")[0]) === native.routing?.backendPort));
      const endpoints = ports.flatMap(([, bindings]) => Array.isArray(bindings) ? bindings.flatMap(b => addresses.filter(address => b.HostIp === address || b.HostIp === (isIP(address) === 6 ? "::" : "0.0.0.0")).map(address => ({ address, port: Number(b.HostPort) }))) : []);
      if (endpoints.length && endpoints.every(e => Number.isSafeInteger(e.port) && e.port > 0 && e.port <= 65535) && new Set(endpoints.map(e => e.port)).size === 1 && ports.length === 1) {
        // Never mistake a reverse-proxy HTTP response for a direct backend response.
        const { proxies } = await routingInventory(target);
        if (proxies.some(p => p.id === target.inspect.Id)) backend = { status: "unsupported", reason: "Reverse proxy endpoints are not backend readiness" };
        else backend = await probeBackend(endpoints[0].address, endpoints[0].port);
      }
    }
  } catch {
    backend = { status: "unavailable", reason: "Registered address or native inventory could not be safely verified" };
    if (native.owned && !tlsChecked) tls = { tls: "unavailable", reason: "Registered address or native route could not be safely verified" };
  }
  return { status, output: `Docker health: ${health}; backend HTTP: ${backend.status}; TLS: ${tls.tls}. Docker health alone does not verify application readiness.`, checkedAt: new Date().toISOString(), containerState, container: { status, state: containerState, health }, backend, tls };
}
export async function checkAppReadiness(appId: string): Promise<AppReadiness> {
  const target = await envTarget(appId);
  try { return await readTargetReadiness(target); } finally { await target.api.close(); }
}
