import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { prisma } from "@/lib/db";
import { execLocal, getLocalServerInfo, getLocalServices, isLocalServer } from "@/lib/local-server";
import { closeSSH, executeCommand, getRemoteServices, getRemoteStats } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { getHostStats } from "@/lib/stats";
import { evaluateAlertRules } from "@/lib/notifications";
import type { ServerInfo } from "@/types";
import type { SessionPayload } from "@/lib/auth";
import { adminRoles, canAccessServer, normalizeRole, roleRank, scopedServerWhere } from "@/lib/server-access";

export type NotificationCheckResult = {
  serverId: string;
  serverName: string;
  status: "checked" | "offline";
  alerts: string[];
};

export type NotificationCheckSummary = {
  checked: number;
  offline: number;
  appDown: number;
  serviceDown: number;
  sslExpiring: number;
  backupStale: number;
  results: NotificationCheckResult[];
};

type Stats = Record<string, number>;

// Canonical snapshots live beside the actual SQLite database, not the process cwd.
const IMPORTANT_SERVICES = new Set(["docker", "nginx", "traefik", "ssh", "sshd"]);
const SSL_WARN_DAYS = 14;
const BACKUP_STALE_DAYS = 7;

async function listServers(actor?: SessionPayload): Promise<ServerInfo[]> {
  const where = actor ? await scopedServerWhere(actor.sub, actor.role) : {};
  const localAllowed = !actor || await canAccessServer(actor.sub, actor.role, "local");
  const rows = await prisma.server.findMany({ where, orderBy: { createdAt: "desc" } });
  return [
    ...(localAllowed ? [getLocalServerInfo()] : []),
    ...rows.map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      authMethod: s.authMethod,
      isActive: s.isActive,
      lastConnected: s.lastConnected?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  ];
}

export async function backupIsStale(database: Pick<typeof prisma, "$queryRawUnsafe"> = prisma, now = Date.now()): Promise<0 | 1> {
  try {
    const rows = await database.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const file = rows.find(row => row.name === "main")?.file;
    if (!file || !isAbsolute(file) || !lstatSync(file).isFile()) return 1;
    const directory = join(realpathSync(dirname(file)), "backups");
    if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) return 1;
    for (const name of readdirSync(directory)) {
      // panel-backup publishes this timestamped name only after snapshot integrity succeeds.
      // ponytail: no manifest exists; use publication identity, never copied-file birthtime/mtime.
      const match = /^backup_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/.exec(name);
      if (!match) continue;
      const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
      const timestamp = Date.parse(iso);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== iso || timestamp > now || now - timestamp > BACKUP_STALE_DAYS * 86_400_000) continue;
      const stat = lstatSync(join(directory, name));
      if (stat.isFile() && stat.nlink === 1 && stat.size > 0) return 0;
    }
  } catch { /* Missing/unreadable evidence is never a fresh backup. */ }
  return 1;
}

function countStoppedContainers(containers: Array<{ state: string }>) {
  return containers.filter((c) => c.state && c.state !== "running").length;
}

function countImportantFailedServices(services: Array<{ name: string; activeState: string; loadState?: string }>) {
  return services.filter((s) => IMPORTANT_SERVICES.has(s.name) && s.loadState !== "not-found" && s.activeState !== "active").length;
}

function uniqueDomains(apps: Array<{ domain: string | null }>) {
  return [...new Set(apps.map((a) => a.domain?.trim()).filter((d): d is string => Boolean(d)))]
    .map((d) => d.replace(/^https?:\/\//, "").split("/")[0])
    .filter(Boolean);
}

export async function countExpiringSsl(domains: string[], run: (domain: string) => Promise<string>): Promise<number | undefined> {
  let count = 0;
  let unavailable = domains.length > 20;
  for (const domain of domains.slice(0, 20)) {
    if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain)) { unavailable = true; continue; }
    const safeDomain = domain;
    const output = await run(safeDomain).catch(() => "");
    const validTo = output.split("\n").find((line) => line.startsWith("notAfter="))?.replace("notAfter=", "");
    const expiresAt = validTo ? Date.parse(validTo) : NaN;
    if (!Number.isFinite(expiresAt)) unavailable = true;
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() <= SSL_WARN_DAYS * 86_400_000) count++;
  }
  return unavailable ? undefined : count;
}

async function observeStoppedContainers(server: ServerInfo, run: (command: string) => Promise<string>): Promise<number | undefined> {
  try {
    const { DOCKER_INVENTORY_COMMAND, parseInventory } = await import("@/lib/apps-inventory");
    const { readDeploymentDefinition } = await import("@/lib/deployment-state");
    // SSH may resolve silent nonzero exits; require completion even for empty inventories.
    const marker = "MON5_DOCKER_OK";
    const output = await run(`${DOCKER_INVENTORY_COMMAND} && printf '\\n${marker}\\n'`);
    const lines = output.trimEnd().split("\n");
    if (lines.pop() !== marker) throw new Error("Docker inventory unavailable");
    const containers = parseInventory(lines.join("\n"), "docker", server.id, server.name, new Date().toISOString());
    if (containers.some(c => !/^[a-f0-9]{64}$/.test(c.containerId || "") || c.status === "UNKNOWN")) throw new Error("Invalid Docker observation");
    const retained = new Set<string>();
    const deployments = await prisma.deploymentLog.findMany({ where: { serverId: isLocalServer(server.id) ? null : server.id }, select: { id: true } });
    for (const { id } of deployments) {
      const definition = await readDeploymentDefinition(id);
      // Same encrypted deployment/server binding as monitoring-metrics, never names/prefixes.
      if (definition && definition.state.serverId === server.id) {
        for (const snapshot of definition.state.retained || []) {
          if (!/^[a-f0-9]{64}$/.test(snapshot.inspect.Id)) throw new Error("Invalid retained identity");
          retained.add(snapshot.inspect.Id);
        }
      }
    }
    return containers.filter(c => !retained.has(c.containerId!) && c.status !== "RUNNING").length;
  } catch { return undefined; }
}

async function checkServer(server: ServerInfo, deliver: boolean): Promise<NotificationCheckResult> {
  const apps = await prisma.app.findMany({ where: { serverId: server.id }, select: { domain: true } });
  const domains = uniqueDomains(apps);
  const backupStale = isLocalServer(server.id) ? await backupIsStale() : 0;
  const alerts: string[] = [];
  let stats: Stats;

  if (isLocalServer(server.id)) {
    const host = getHostStats();
    const appDown = await observeStoppedContainers(server, async command => execLocal(command));
    const { services, available } = getLocalServices();
    const sslExpiring = await countExpiringSsl(domains, async domain => execLocal(`echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`, 15_000));
    stats = {
      cpu: host.cpu.usagePercent,
      memory: host.memory.usagePercent,
      disk: host.disk.usagePercent,
      ...(appDown !== undefined ? { app_down: appDown } : {}),
      ...(available ? { service_down: countImportantFailedServices(services) } : {}),
      ...(sslExpiring !== undefined ? { ssl_expiring: sslExpiring } : {}),
      backup_stale: backupStale,
      offline: 0,
    };
  } else {
    let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
    try {
      const connected = await connectToServer(server.id);
      ssh = connected.ssh;
      const [host, appDown, services] = await Promise.all([getRemoteStats(ssh), observeStoppedContainers(server, command => executeCommand(ssh!, command)), getRemoteServices(ssh).catch(() => undefined)]);
      const sslExpiring = await countExpiringSsl(domains, domain => executeCommand(ssh!, `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`, 15_000));
      stats = {
        cpu: host.cpu.usagePercent,
        memory: host.memory.usagePercent,
        disk: host.disk.usagePercent,
        ...(appDown !== undefined ? { app_down: appDown } : {}),
        ...(services !== undefined ? { service_down: countImportantFailedServices(services) } : {}),
        ...(sslExpiring !== undefined ? { ssl_expiring: sslExpiring } : {}),
        offline: 0,
      };
    } catch {
      if (deliver) await evaluateAlertRules({ offline: 1 }, server.name, server.id);
      return { serverId: server.id, serverName: server.name, status: "offline", alerts: ["offline"] };
    } finally {
      await closeSSH(ssh);
    }
  }

  for (const metric of ["app_down", "service_down", "ssl_expiring", "backup_stale"] as const) {
    if ((stats[metric] ?? 0) > 0) alerts.push(metric);
  }
  if (deliver) await evaluateAlertRules(stats, server.name, server.id);
  return { serverId: server.id, serverName: server.name, status: "checked", alerts };
}

// Only the internal scheduler omits actor; HTTP callers must pass the authenticated session.
export async function runNotificationChecks(actor?: SessionPayload): Promise<NotificationCheckSummary> {
  if (actor !== undefined && (!actor || roleRank[normalizeRole(actor.role)] < roleRank.MANAGER)) throw new Error("Insufficient permissions");
  const deliver = !actor || adminRoles.has(normalizeRole(actor.role));
  const servers = await listServers(actor);
  const results: NotificationCheckResult[] = [];
  // ponytail: two concurrent server checks; process deadline bounds the whole cycle.
  for (let i = 0; i < servers.length; i += 2) {
    results.push(...await Promise.all(servers.slice(i, i + 2).map(server => checkServer(server, deliver))));
  }
  return {
    checked: results.length,
    offline: results.filter((r) => r.status === "offline").length,
    appDown: results.filter((r) => r.alerts.includes("app_down")).length,
    serviceDown: results.filter((r) => r.alerts.includes("service_down")).length,
    sslExpiring: results.filter((r) => r.alerts.includes("ssl_expiring")).length,
    backupStale: results.filter((r) => r.alerts.includes("backup_stale")).length,
    results,
  };
}

export function notificationCheckSelfTest() {
  console.assert(countStoppedContainers([{ state: "running" }, { state: "exited" }]) === 1);
  console.assert(countImportantFailedServices([{ name: "docker", activeState: "failed" }, { name: "sshd", activeState: "inactive", loadState: "not-found" }, { name: "cups", activeState: "failed" }]) === 1);
}
