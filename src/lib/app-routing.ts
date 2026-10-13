import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { connect, checkServerIdentity } from "node:tls";
import { configurationHash, type Target } from "@/lib/container-recreate";
import { getLocalServerInfo, isLocalServer } from "@/lib/local-server";
import { prisma } from "@/lib/db";

export type RoutingInput = { proxyId: string; backendPort: number; entrypoint: string; resolver: string | null; network: string };
// Native Docker JSON, constrained at the Engine boundary; never returned wholesale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type Native = Record<string, any>;
const ownerLabel = "vps-assistant.routing-owner";
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
function fail(message: string, statusCode = 422): never { throw Object.assign(new Error(message), { statusCode }); }
export function validateDomain(domain: unknown): asserts domain is string | null {
  if (domain === null) return;
  if (typeof domain !== "string" || domain.length > 253 || domain !== domain.toLowerCase() || isIP(domain) || !domain.includes(".") || domain.split(".").some(p => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) fail("Use an exact lowercase DNS hostname (no URL, IP, wildcard or trailing dot)", 400);
}
export function validateRouting(value: unknown): asserts value is RoutingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Routing settings are required for a domain", 400);
  const r = value as RoutingInput;
  if (Object.keys(r).some(k => !["proxyId", "backendPort", "entrypoint", "resolver", "network"].includes(k)) || typeof r.proxyId !== "string" || !/^[a-f0-9]{64}$/.test(r.proxyId) || !Number.isSafeInteger(r.backendPort) || r.backendPort < 1 || r.backendPort > 65535 || typeof r.entrypoint !== "string" || !safeName.test(r.entrypoint) || (r.resolver !== null && (typeof r.resolver !== "string" || !safeName.test(r.resolver))) || typeof r.network !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(r.network)) fail("Invalid proxy, backend port, entrypoint, resolver or network", 400);
}
const owner = (target: Target) => "vps-" + configurationHash(target.key).slice(0, 20);
function routeLabels(id: string, domain: string, r: RoutingInput) {
  const labels: Record<string, string> = {
    [ownerLabel]: id, "traefik.enable": "true", "traefik.docker.network": r.network,
    [`traefik.http.routers.${id}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${id}.entrypoints`]: r.entrypoint,
    [`traefik.http.routers.${id}.service`]: id,
    [`traefik.http.services.${id}.loadbalancer.server.port`]: String(r.backendPort),
  };
  if (r.resolver) { labels[`traefik.http.routers.${id}.tls`] = "true"; labels[`traefik.http.routers.${id}.tls.certresolver`] = r.resolver; }
  return labels;
}
export function inspectedRouting(target: Target): { domain: string | null; routing: RoutingInput | null; owned: boolean } {
  const id = owner(target), labels = target.inspect.Config.Labels || {};
  if (labels[ownerLabel] !== id) return { domain: null, routing: null, owned: false };
  const domain = labels[`traefik.http.routers.${id}.rule`]?.match(/^Host\(`([^`]+)`\)$/)?.[1] || null;
  const routing = { proxyId: labels["vps-assistant.routing-proxy"] || "", backendPort: Number(labels[`traefik.http.services.${id}.loadbalancer.server.port`]), entrypoint: labels[`traefik.http.routers.${id}.entrypoints`] || "", resolver: labels[`traefik.http.routers.${id}.tls.certresolver`] || null, network: labels["traefik.docker.network"] || "" };
  return { domain, routing, owned: true };
}
function staticOptions(inspect: Native) {
  const options: Record<string, string> = {};
  const args = [...(inspect.Config.Entrypoint || []), ...(inspect.Config.Cmd || [])];
  for (let i = 0; i < args.length; i++) if (args[i].startsWith("--")) {
    const [key, ...parts] = args[i].slice(2).split("=");
    options[key.toLowerCase()] = parts.length ? parts.join("=") : args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
  for (const env of inspect.Config.Env || []) if (env.startsWith("TRAEFIK_")) {
    const at = env.indexOf("="); if (at > 0) options[env.slice(8, at).toLowerCase().replaceAll("_", ".")] = env.slice(at + 1);
  }
  return options;
}
export async function routingInventory(target: Target) {
  const list = await target.api.call("GET", "/containers/json?all=true") as unknown as Native[];
  if (!Array.isArray(list) || list.length > 1000 || list.some(c => !/^[a-f0-9]{64}$/.test(c.Id))) fail("Proxy inventory is unavailable", 503);
  const proxies = [];
  for (const c of list.filter(c => c.State === "running" && /(?:^|\/)traefik(?::|@|$)/i.test(c.Image || ""))) {
    const inspect = await target.api.call("GET", `/containers/${c.Id}/json`);
    const opts = staticOptions(inspect);
    const mountedStaticConfig = (inspect.Mounts || []).some((m: Native) => /^\/etc\/traefik(?:\/|$)/.test(m.Destination || "") || /(?:^|\/)traefik\.(?:ya?ml|toml)$/.test(m.Destination || ""));
    const unsupported = mountedStaticConfig || opts["providers.docker"] !== "true" || opts["providers.docker.exposedbydefault"] !== "false" || opts["providers.docker.usebindportip"] === "true" || opts["providers.swarm"] === "true" || (opts["providers.docker.endpoint"] && opts["providers.docker.endpoint"] !== "unix:///var/run/docker.sock") || !!opts["providers.docker.constraints"] || Object.keys(opts).some(k => (k.startsWith("providers.") && k !== "providers.docker" && !k.startsWith("providers.docker.")) || k === "configfile");
    const entrypoints = Object.entries(opts).filter(([k, v]) => /^entrypoints\.[^.]+\.address$/.test(k) && /^:[0-9]+(?:\/tcp)?$/.test(v)).map(([k, v]) => ({ name: k.split(".")[1], port: Number(v.slice(1).split("/")[0]), tls: opts[`entrypoints.${k.split(".")[1]}.http.tls`] === "true", published: (inspect.NetworkSettings?.Ports?.[`${Number(v.slice(1).split("/")[0])}/tcp`] || []) as { HostIp: string; HostPort: string }[] }));
    const resolvers = [...new Set(Object.keys(opts).filter(k => /^certificatesresolvers\.[^.]+\.acme\./.test(k)).map(k => k.split(".")[1]))];
    const networks = Object.keys(inspect.NetworkSettings?.Networks || {}).filter(n => !["host", "none", "bridge"].includes(n));
    proxies.push({ id: c.Id as string, name: String(inspect.Name).slice(1), entrypoints, resolvers, networks, supported: !unsupported && entrypoints.length > 0 && networks.length > 0, reason: unsupported ? "Requires explicit Docker provider with exposedByDefault=false and CLI/environment entrypoints; implicit, file, external or other providers cannot be collision-checked safely" : "CLI/environment configuration inspected; certificate issuance and active proxy readiness are not inferred", fingerprint: configurationHash([inspect.Config, inspect.NetworkSettings?.Networks, inspect.NetworkSettings?.Ports, inspect.State.Running]) });
  }
  return { proxies, list };
}
export async function routingView(target: Target) {
  const native = inspectedRouting(target);
  try {
    const { proxies } = await routingInventory(target);
    const readiness = native.owned && native.domain && native.routing ? await verifyRoutingTls(target, native.domain, native.routing) : { tls: "not_requested" as const };
    return { ...native, capability: proxies.some(p => p.supported) ? "supported" : "unsupported", proxies, dns: "Not changed; preview and apply verify the hostname resolves only to this server", routeStatus: native.owned ? "native_labels_present; active_proxy_unverified" : "No panel-owned route; foreign routes are preserved", ...readiness };
  } catch { return { ...native, capability: "unavailable", proxies: [], dns: "DNS not changed", routeStatus: "Proxy inventory unavailable; routing edits fail closed", tls: "unverified" }; }
}
async function addresses(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const dns = new Resolver({ timeout: 2000, tries: 1 });
  const records = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  if (records.some(r => r.status === "rejected" && !["ENODATA", "ENOTFOUND"].includes(r.reason?.code))) fail("DNS lookup incomplete or timed out; no routing change is allowed", 503);
  return records.flatMap(r => r.status === "fulfilled" ? r.value : []);
}
export async function verifyRoutingDns(target: Target, domain: string) {
  validateDomain(domain);
  const server = isLocalServer(target.serverId) ? getLocalServerInfo() : target.app?.server || await prisma.server.findUnique({ where: { id: target.serverId } });
  if (!server?.host) fail("Server address is unavailable; DNS cannot be verified");
  const expected = await addresses(server.host);
  const actual = await addresses(domain);
  if (!actual.length || !expected.length || actual.some(ip => !expected.includes(ip))) fail("DNS must resolve only to this server's registered address before applying. DNS is not changed; NAT/CDN targets cannot be verified by this editor");
  return { verified: true, domain, addresses: actual.sort() };
}
export async function checkRouting(target: Target, domain: string | null | undefined, routing: RoutingInput | null | undefined, networks: string[]) {
  const native = inspectedRouting(target);
  const existingNetwork = target.inspect.Config.Labels?.["traefik.docker.network"];
  if (existingNetwork && !networks.includes(existingNetwork) && Object.keys(target.inspect.Config.Labels || {}).some(k => /^traefik\.(http|tcp|udp)\.routers\./.test(k) && !k.startsWith(`traefik.http.routers.${owner(target)}.`))) fail("Keep the network used by foreign proxy routes");
  if (domain === undefined) {
    if (native.routing && !networks.includes(native.routing.network)) fail("Keep the panel-owned route's network or explicitly remove its domain");
    return null;
  }
  validateDomain(domain);
  const id = owner(target), labels = target.inspect.Config.Labels || {};
  if (labels[ownerLabel] && labels[ownerLabel] !== id) fail("Routing ownership does not match this target");
  const ownedKeys = Object.keys(labels).filter(k => k.startsWith(`traefik.http.routers.${id}.`) || k.startsWith(`traefik.http.services.${id}.`));
  if (!native.owned && ownedKeys.length) fail("Reserved route names already belong to a foreign configuration");
  if (domain === null) {
    if (native.owned && labels["vps-assistant.routing-originals"]) {
      const originals = JSON.parse(labels["vps-assistant.routing-originals"]);
      if (Object.keys(labels).some(k => /^traefik\.(http|tcp|udp)\.routers\./.test(k) && !ownedKeys.includes(k)) && (originals.enable !== labels["traefik.enable"] || originals.network !== labels["traefik.docker.network"])) fail("Removing this route would change shared foreign proxy defaults; original routing is preserved");
    }
    return { fingerprint: null, dns: null };
  }
  validateRouting(routing);
  if (!networks.includes(routing.network)) fail("Select the proxy network in this app's bridge networks");
  const inventory = await routingInventory(target);
  const proxy = inventory.proxies.find(p => p.id === routing.proxyId);
  if (!proxy?.supported || !proxy.networks.includes(routing.network) || !proxy.entrypoints.some(e => e.name === routing.entrypoint) || (routing.resolver && !proxy.resolvers.includes(routing.resolver))) fail("Selected proxy, network, entrypoint or resolver is unsupported or changed");
  if (target.inspect.Id === proxy.id) fail("Cannot configure routing on the reverse proxy itself");
  for (const k of Object.keys(labels)) {
    const match = k.match(/^traefik\.(http|tcp|udp)\.routers\.([^.]+)\.rule$/);
    if (match && !(native.owned && match[1] === "http" && match[2] === id) && !labels[`traefik.${match[1]}.routers.${match[2]}.service`]) fail("Foreign routers with implicit service selection cannot be preserved when adding a service; set their explicit native service first");
  }
  if (native.owned && (native.routing?.network !== routing.network) && Object.keys(labels).some(k => /^traefik\.(http|tcp|udp)\.(routers|services)\./.test(k) && !ownedKeys.includes(k))) fail("A shared Docker network label serves foreign routes; preserve its network");
  if (!native.owned && ((labels["traefik.enable"] && labels["traefik.enable"] !== "true") || (labels["traefik.docker.network"] && labels["traefik.docker.network"] !== routing.network) || (labels["traefik.enable"] !== "true" && Object.keys(labels).some(k => /^traefik\.(http|tcp|udp)\.routers\./.test(k))))) fail("Foreign proxy enable/network labels conflict; original routing is preserved");
  for (const c of inventory.list) {
    const l = c.Labels || {};
    // The exact owner's retained, disconnected original is recovery data, not a routable competitor.
    if (c.State !== "running" && l[ownerLabel] === id && c.Names?.some((n: string) => /-safe-old-[a-f0-9-]{36}$/.test(n))) {
      const retained = await target.api.call("GET", `/containers/${c.Id}/json`);
      if (!Object.keys(retained.NetworkSettings?.Networks || {}).length) continue;
    }
    if (c.Id !== target.inspect.Id && Object.keys(l).some(k => k.startsWith(`traefik.http.routers.${id}.`) || k.startsWith(`traefik.http.services.${id}.`))) fail("Proxy router/service name collides on this server");
    if (l["traefik.enable"] === "false") continue;
    for (const [k, rule] of Object.entries(l)) if (/^traefik\.(http|tcp)\.routers\.[^.]+\.rule$/.test(k)) {
      if (c.Id === target.inspect.Id && native.owned && k.startsWith(`traefik.http.routers.${id}.`)) continue;
      const eps = l[k.replace(/rule$/, "entrypoints")];
      if (eps && !eps.split(",").includes(routing.entrypoint)) continue;
      if (typeof rule !== "string" || !/Host(?:SNI)?\(/.test(rule) || /HostRegexp|HostSNIRegexp|HostSNI\([`'"]\*/.test(rule) || rule.toLowerCase().includes(domain)) fail("Domain conflicts with an existing or wildcard proxy route on this server");
    }
  }
  return { fingerprint: proxy.fingerprint, dns: await verifyRoutingDns(target, domain) };
}
export function transformRouting(target: Target, domain: string | null | undefined, routing: RoutingInput | null | undefined, payload: Native) {
  if (domain === undefined) return;
  const id = owner(target), labels = payload.Labels ||= {};
  const previouslyOwned = labels[ownerLabel] === id;
  const originals = previouslyOwned ? JSON.parse(labels["vps-assistant.routing-originals"] || "{}") : { enable: labels["traefik.enable"] ?? null, network: labels["traefik.docker.network"] ?? null };
  // Only exact panel-owned route/service keys are edited; middleware, foreign routers and assets survive.
  for (const k of Object.keys(labels)) if (k.startsWith(`traefik.http.routers.${id}.`) || k.startsWith(`traefik.http.services.${id}.`)) delete labels[k];
  delete labels[ownerLabel]; delete labels["vps-assistant.routing-proxy"];
  delete labels["vps-assistant.routing-originals"];
  if (domain !== null) Object.assign(labels, routeLabels(id, domain, routing!), { "vps-assistant.routing-proxy": routing!.proxyId, "vps-assistant.routing-originals": JSON.stringify(originals) });
  else if (previouslyOwned) for (const [field, key] of [["enable", "traefik.enable"], ["network", "traefik.docker.network"]]) {
    if (originals[field] === null) delete labels[key]; else if (typeof originals[field] === "string") labels[key] = originals[field];
  }
}
type TlsReadiness = { tls: "verified" | "pending" | "failed" | "unavailable" | "not_requested" | "certificate_pending_or_unverified"; reason?: string; checkedAt?: string; certificate?: { hostnameVerified: true; chainTrusted: true; validFrom: string; validTo: string; fingerprint256: string } };
export async function verifyRoutingTls(target: Target, domain: string, routing: RoutingInput): Promise<TlsReadiness> {
  // ponytail: certificate readiness only; no HTTP, redirects, issuance, provider installation or backend claim.
  try {
    validateDomain(domain); validateRouting(routing);
    const { proxies } = await routingInventory(target);
    const proxy = proxies.find(p => p.id === routing.proxyId);
    const entrypoint = proxy?.entrypoints.find(e => e.name === routing.entrypoint);
    if (!routing.resolver && !entrypoint?.tls) return { tls: "not_requested" };
    if (!proxy?.supported || !entrypoint || !proxy.networks.includes(routing.network) || (routing.resolver && !proxy.resolvers.includes(routing.resolver))) return { tls: "unavailable", reason: "Selected native proxy configuration is unavailable or unsupported" };
    if (!target.inspect.State.Running || !target.inspect.NetworkSettings?.Networks?.[routing.network]) return { tls: "unavailable", reason: "Application is stopped or its proxy network is unavailable" };
    const dns = await verifyRoutingDns(target, domain);
    // Choose only a currently published TCP binding on this exact proxy and registered server.
    const endpoints = dns.addresses.flatMap(address => entrypoint.published.filter(b => b.HostIp === address || b.HostIp === (isIP(address) === 6 ? "::" : "0.0.0.0")).map(b => ({ address, port: Number(b.HostPort) })));
    if (!endpoints.length || endpoints.some(e => !Number.isSafeInteger(e.port) || e.port < 1 || e.port > 65535) || new Set(endpoints.map(e => e.port)).size !== 1) return { tls: "unavailable", reason: "Exact entrypoint published TCP binding cannot be verified" };
    const { address, port } = endpoints[0];
    return await new Promise<TlsReadiness>(resolve => {
      let done = false;
      const finish = (result: TlsReadiness) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve({ ...result, checkedAt: new Date().toISOString() }); };
      const socket = connect({ host: address, port, servername: domain, rejectUnauthorized: true, checkServerIdentity: (hostname, certificate) => /(?:^|,\s*)DNS:/.test(certificate.subjectaltname || "") ? checkServerIdentity(hostname, certificate) : new Error("Certificate SAN is required") });
      const timer = setTimeout(() => finish({ tls: "pending", reason: "TLS handshake timed out; repeat read-only inspection after issuance" }), 4000);
      socket.once("secureConnect", () => {
        const certificate = socket.getPeerCertificate();
        const from = Date.parse(certificate.valid_from), to = Date.parse(certificate.valid_to), now = Date.now();
        if (!socket.authorized || !certificate.subjectaltname || checkServerIdentity(domain, certificate) || !Number.isFinite(from) || !Number.isFinite(to) || from > now || to <= now) return finish({ tls: "failed", reason: "Certificate chain, DNS SAN or validity period is invalid" });
        finish({ tls: "verified", certificate: { hostnameVerified: true, chainTrusted: true, validFrom: new Date(from).toISOString(), validTo: new Date(to).toISOString(), fingerprint256: certificate.fingerprint256 } });
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        const invalid = /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(error.code || "");
        finish({ tls: invalid ? "failed" : "pending", reason: invalid ? "Certificate chain, DNS SAN or validity period is invalid; issuance may still be pending" : "TLS endpoint not ready; repeat read-only inspection after issuance" });
      });
      socket.once("close", () => finish({ tls: "pending", reason: "TLS endpoint closed before verification" }));
    });
  } catch { return { tls: "unavailable", reason: "Read-only proxy, server or complete DNS verification is unavailable" }; }
}
export async function routingReadback(target: Target, containerId: string, domain: string, routing: RoutingInput, probeTls = true) {
  const inspect = await target.api.call("GET", `/containers/${containerId}/json`);
  const wanted = { ...routeLabels(owner(target), domain, routing), "vps-assistant.routing-proxy": routing.proxyId };
  if (inspect.Id !== containerId || Object.entries(wanted).some(([k, v]) => inspect.Config.Labels?.[k] !== v) || !inspect.NetworkSettings?.Networks?.[routing.network]) fail("Routing native configuration readback failed; inspect before retrying", 503);
  return { nativeConfigurationVerified: true, activeProxy: "unverified", dns: "verified_before_apply_not_changed", ...(probeTls ? await verifyRoutingTls({ ...target, inspect }, domain, routing) : { tls: routing.resolver ? "certificate_pending_or_unverified" as const : "not_requested" as const }) };
}
