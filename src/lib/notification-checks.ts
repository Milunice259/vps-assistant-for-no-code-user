import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "@/lib/db";
import { getLocalContainers, getLocalServerInfo, getLocalServices, isLocalServer } from "@/lib/local-server";
import { closeSSH, executeCommandSafe, getRemoteContainers, getRemoteServices, getRemoteStats } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { getHostStats } from "@/lib/stats";
import { evaluateAlertRules } from "@/lib/notifications";
import type { ServerInfo } from "@/types";

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

const BACKUP_DIR = resolve("./backups");
const IMPORTANT_SERVICES = new Set(["docker", "nginx", "traefik", "ssh", "sshd"]);
const SSL_WARN_DAYS = 14;
const BACKUP_STALE_DAYS = 7;

async function listServers(): Promise<ServerInfo[]> {
  const rows = await prisma.server.findMany({ orderBy: { createdAt: "desc" } });
  return [
    getLocalServerInfo(),
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

function backupIsStale() {
  if (!existsSync(BACKUP_DIR)) return 1;
  const newest = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => statSync(`${BACKUP_DIR}/${f}`).birthtimeMs)
    .sort((a, b) => b - a)[0];
  if (!newest) return 1;
  return Date.now() - newest > BACKUP_STALE_DAYS * 86_400_000 ? 1 : 0;
}

function countStoppedContainers(containers: Array<{ state: string }>) {
  return containers.filter((c) => c.state && c.state !== "running").length;
}

function countImportantFailedServices(services: Array<{ name: string; activeState: string }>) {
  return services.filter((s) => IMPORTANT_SERVICES.has(s.name) && s.activeState !== "active").length;
}

function uniqueDomains(apps: Array<{ domain: string | null }>) {
  return [...new Set(apps.map((a) => a.domain?.trim()).filter((d): d is string => Boolean(d)))]
    .map((d) => d.replace(/^https?:\/\//, "").split("/")[0])
    .filter(Boolean);
}

async function countExpiringSsl(domains: string[], run: (domain: string) => Promise<string>) {
  let count = 0;
  for (const domain of domains.slice(0, 20)) {
    const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!safeDomain) continue;
    const output = await run(safeDomain).catch(() => "");
    const validTo = output.split("\n").find((line) => line.startsWith("notAfter="))?.replace("notAfter=", "");
    const days = validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86_400_000) : -1;
    if (days >= 0 && days <= SSL_WARN_DAYS) count++;
  }
  return count;
}

async function checkServer(server: ServerInfo): Promise<NotificationCheckResult> {
  const apps = await prisma.app.findMany({ where: { serverId: server.id }, select: { domain: true } });
  const domains = uniqueDomains(apps);
  const backupStale = isLocalServer(server.id) ? backupIsStale() : 0;
  const alerts: string[] = [];
  let stats: Stats;

  if (isLocalServer(server.id)) {
    const host = getHostStats();
    const containers = getLocalContainers();
    const { services } = getLocalServices();
    stats = {
      cpu: host.cpu.usagePercent,
      memory: host.memory.usagePercent,
      disk: host.disk.usagePercent,
      app_down: countStoppedContainers(containers),
      service_down: countImportantFailedServices(services),
      ssl_expiring: await countExpiringSsl(domains, (domain) => import("child_process").then(({ execSync }) => execSync(`echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`, { encoding: "utf8", timeout: 15_000 }))),
      backup_stale: backupStale,
    };
  } else {
    let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
    try {
      const connected = await connectToServer(server.id);
      ssh = connected.ssh;
      const [host, containers, services] = await Promise.all([getRemoteStats(ssh), getRemoteContainers(ssh), getRemoteServices(ssh)]);
      stats = {
        cpu: host.cpu.usagePercent,
        memory: host.memory.usagePercent,
        disk: host.disk.usagePercent,
        app_down: countStoppedContainers(containers),
        service_down: countImportantFailedServices(services),
        ssl_expiring: await countExpiringSsl(domains, (domain) => executeCommandSafe(ssh!, `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`, 15_000)),
        backup_stale: 0,
      };
    } catch {
      await evaluateAlertRules({ offline: 1 }, server.name, server.id);
      return { serverId: server.id, serverName: server.name, status: "offline", alerts: ["offline"] };
    } finally {
      await closeSSH(ssh);
    }
  }

  for (const metric of ["app_down", "service_down", "ssl_expiring", "backup_stale"] as const) {
    if ((stats[metric] ?? 0) > 0) alerts.push(metric);
  }
  await evaluateAlertRules(stats, server.name, server.id);
  return { serverId: server.id, serverName: server.name, status: "checked", alerts };
}

export async function runNotificationChecks(): Promise<NotificationCheckSummary> {
  const [channels, rules] = await Promise.all([
    prisma.notificationChannel.count({ where: { enabled: true } }),
    prisma.alertRule.count({ where: { enabled: true } }),
  ]);
  if (!channels || !rules) return { checked: 0, offline: 0, appDown: 0, serviceDown: 0, sslExpiring: 0, backupStale: 0, results: [] };

  const results = await Promise.all((await listServers()).map(checkServer));
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
  console.assert(countImportantFailedServices([{ name: "docker", activeState: "failed" }, { name: "cups", activeState: "failed" }]) === 1);
}
