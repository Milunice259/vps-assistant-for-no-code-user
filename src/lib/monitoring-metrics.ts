import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { execLocal } from "@/lib/local-server";
import { connectToServer } from "@/lib/server-ssh";
import { executeCommand } from "@/lib/ssh";
import { readDeploymentDefinition } from "@/lib/deployment-state";

export const MONITORING_INTERVAL_MS = 60_000;
export const MONITORING_RETENTION_DAYS = 30;
export const MONITORING_RANGES: Record<string, number> = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 };
const PREFIX = "monitoring:v1:";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const aliasKey = (id: string) => PREFIX + "alias:" + hash(id);
const registryPrefix = PREFIX + "target:";
const samplePrefix = PREFIX + "sample:";
const minute = (time: number) => Math.floor(time / MONITORING_INTERVAL_MS) * MONITORING_INTERVAL_MS;
const sampleKey = (time: number, identity: string) => samplePrefix + new Date(time).toISOString() + ":" + identity;
type Target = { identity: string; serverId: string; appId?: string };
export type MonitoringMetricPoint = { time: string; cpu: number | null; mem: number | null; netIn: number | null; netOut: number | null; gap?: string };
const gap = (time: number, reason: string): MonitoringMetricPoint => ({ time: new Date(time).toISOString(), cpu: null, mem: null, netIn: null, netOut: null, gap: reason });
const discoveryId = (server: string, runtime: string) => server === "local" ? `local::${runtime}` : `discovered::${server}::${runtime}`;
const storedIdentity = (server: string, app: string) => hash(JSON.stringify([server, "app", app]));
const matches = (a: string | null, b: string) => !!a && /^[a-f0-9]{12,64}$/i.test(a) && b.startsWith(a);

function quantity(value: string, memory = false): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/);
  if (!match) throw new Error("Invalid metric quantity");
  const factors: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
  const result = Number(match[1]) * factors[match[2]] / (memory ? 1024 ** 2 : 1);
  if (!Number.isFinite(result)) throw new Error("Invalid metric quantity");
  return result;
}

/** Scheduler-only writer. Native runtime IDs are aliases, never the logical history key. */
export async function collectMonitoringMetrics(now = new Date()): Promise<{ sampled: number; gaps: number; servers: number }> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid collection time");
  const time = minute(now.getTime());
  const servers = ["local", ...(await prisma.server.findMany({ where: { isActive: true }, select: { id: true } })).map(s => s.id).filter(id => id !== "local")];
  const apps = await prisma.app.findMany({ select: { id: true, serverId: true, containerId: true, deploymentId: true } });
  const known = (await prisma.appSetting.findMany({ where: { key: { startsWith: registryPrefix } }, select: { value: true } })).map(row => JSON.parse(row.value) as Target);
  let sampled = 0, gaps = 0;
  for (const serverId of servers) {
    const targets = new Map<string, { target: Target; point: MonitoringMetricPoint }>();
    for (const target of known.filter(t => t.serverId === serverId)) targets.set(target.identity, { target, point: gap(time, "unavailable") });
    for (const app of apps.filter(a => a.serverId === serverId)) {
      const target = { identity: storedIdentity(serverId, app.id), serverId, appId: app.id };
      targets.set(target.identity, { target, point: gap(time, "missing") });
    }
    const aliases = new Map<string, string>();
    let close: (() => Promise<unknown>) | undefined;
    try {
      let run: (command: string) => Promise<string>;
      if (serverId === "local") run = async command => execLocal(command, 20_000);
      else {
        const { ssh } = await connectToServer(serverId);
        close = () => ssh.close();
        run = command => executeCommand(ssh, command, 20_000);
      }
      // Only identity labels: no inspect environment, arbitrary labels or credentials.
      const inventory = await run(`docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.State}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.compose.container-number"}}'`);
      const retained = new Set<string>();
      const deploymentRuntimes = new Map<string, string>();
      const deployments = await prisma.deploymentLog.findMany({ where: { serverId: serverId === "local" ? null : serverId }, select: { id: true } });
      const deploymentIds = [...new Set([...deployments.map(d => d.id), ...apps.filter(a => a.serverId === serverId && a.deploymentId).map(a => a.deploymentId!)])];
      for (const id of deploymentIds) {
        const definition = await readDeploymentDefinition(id);
        if (definition && definition.state.serverId === serverId) {
          for (const snapshot of definition.state.retained || []) retained.add(snapshot.inspect.Id);
          for (const runtime of definition.state.runtime.containerIds) deploymentRuntimes.set(runtime, id);
        }
      }
      const observed = inventory.split("\n").filter(Boolean).map(line => {
        const [id, name, state, project, service, replica, ...extra] = line.split("|");
        if (extra.length || !/^[a-f0-9]{64}$/.test(id) || !/^[a-zA-Z0-9_.-]+$/.test(name) || !state) throw new Error("Invalid inventory");
        return { id, name, state, project, service, replica };
      }).filter(c => !retained.has(c.id));
      const stats = new Map<string, MonitoringMetricPoint>();
      if (observed.some(c => c.state === "running")) {
        const raw = await run("docker stats --no-stream --no-trunc --format '{{json .}}'");
        for (const line of raw.split("\n").filter(Boolean)) {
          const row = JSON.parse(line) as Record<string, string>;
          const cpu = Number(row.CPUPerc?.replace(/%$/, ""));
          if (!/^[a-f0-9]{64}$/.test(row.ID) || !row.CPUPerc || !Number.isFinite(cpu) || cpu < 0) continue;
          try {
            const [netIn, netOut] = row.NetIO.split("/").map(s => quantity(s));
            if (netOut === undefined) continue;
            stats.set(row.ID, { time: new Date(time).toISOString(), cpu, mem: quantity(row.MemUsage.split("/")[0], true), netIn, netOut });
          } catch { /* Missing/malformed samples remain explicit gaps. */ }
        }
      }
      for (const container of observed) {
        const bound = apps.filter(a => a.serverId === serverId && matches(a.containerId, container.id));
        // ponytail: untracked names are logical slots; adopt as a stored App for stronger ownership than name reuse.
        const composeSlot = container.project && container.service && container.replica ? [container.project, container.service, container.replica] : null;
        const deploymentId = deploymentRuntimes.get(container.id);
        const identity = bound.length === 1 ? storedIdentity(serverId, bound[0].id) : hash(JSON.stringify([serverId, deploymentId ? "deployment" : "slot", deploymentId || null, composeSlot || (deploymentId ? "image" : container.name)]));
        const target: Target = { identity, serverId, ...(bound.length === 1 ? { appId: bound[0].id } : {}) };
        targets.set(identity, { target, point: container.state === "running" ? stats.get(container.id) || gap(time, "unavailable") : gap(time, "stopped") });
        for (const runtime of [container.id, container.id.slice(0, 12)]) {
          aliases.set(aliasKey(discoveryId(serverId, runtime)), identity);
          if (serverId === "local") aliases.set(aliasKey(`discovered::local::${runtime}`), identity);
        }
      }
    } catch {
      // No zero samples and no raw executor/credential errors leave this boundary.
      for (const value of targets.values()) value.point = gap(time, "unavailable");
    } finally { if (close) await close().catch(() => {}); }
    await prisma.$transaction(async tx => {
      for (const [key, identity] of aliases) await tx.appSetting.upsert({ where: { key }, create: { key, value: identity }, update: { value: identity } });
      for (const { target, point } of targets.values()) {
        const key = registryPrefix + target.identity;
        await tx.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(target) }, update: { value: JSON.stringify(target) } });
        const sample = sampleKey(time, target.identity);
        await tx.appSetting.upsert({ where: { key: sample }, create: { key: sample, value: JSON.stringify(point) }, update: {} });
        if (point.gap) gaps++; else sampled++;
      }
    }, { timeout: 30_000 });
  }
  // Global retention runs on every scheduler tick, including unavailable servers.
  const cutoff = new Date(time - MONITORING_RANGES["30d"]).toISOString();
  await prisma.$transaction([
    prisma.appSetting.deleteMany({ where: { key: { startsWith: samplePrefix, lt: samplePrefix + cutoff } } }),
    prisma.appMetric.deleteMany({ where: { timestamp: { lt: new Date(cutoff) } } }),
  ]);
  return { sampled, gaps, servers: servers.length };
}

/** Read-only: never contacts Engines or writes samples/aliases. Caller must authorizeApp first. */
export async function readMonitoringHistory(appId: string, range: string, now = new Date()) {
  if (!Object.hasOwn(MONITORING_RANGES, range) || !Number.isFinite(now.getTime())) throw new Error("Invalid metric range/time");
  let identity: string | null = null;
  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true, serverId: true } });
  if (app) identity = storedIdentity(app.serverId, app.id);
  else identity = (await prisma.appSetting.findUnique({ where: { key: aliasKey(appId) }, select: { value: true } }))?.value || null;
  const end = minute(now.getTime()), start = end - MONITORING_RANGES[range] + MONITORING_INTERVAL_MS;
  const rows = identity ? await prisma.appSetting.findMany({ where: { key: { startsWith: samplePrefix, gte: sampleKey(start, ""), lte: sampleKey(end, "~"), endsWith: ":" + identity } }, orderBy: { key: "asc" }, select: { value: true } }) : [];
  const pointsByTime = new Map(rows.map(row => { const point = JSON.parse(row.value) as MonitoringMetricPoint; return [point.time, point] as const; }));
  // Preserve pre-scheduler stored-app history without fabricating missing network counters.
  if (app) for (const row of await prisma.appMetric.findMany({ where: { appId, timestamp: { gte: new Date(start), lte: new Date(end) } }, orderBy: { timestamp: "asc" } })) {
    const time = new Date(minute(row.timestamp.getTime())).toISOString();
    if (!pointsByTime.has(time)) pointsByTime.set(time, { time, cpu: row.cpuUsage, mem: row.memUsage, netIn: row.netIn, netOut: row.netOut });
  }
  const points: MonitoringMetricPoint[] = [];
  const step = Math.ceil((end - start + MONITORING_INTERVAL_MS) / MONITORING_INTERVAL_MS / 360);
  for (let time = start; time <= end; time += step * MONITORING_INTERVAL_MS) {
    const bucket: MonitoringMetricPoint[] = [];
    for (let t = time; t <= Math.min(end, time + (step - 1) * MONITORING_INTERVAL_MS); t += MONITORING_INTERVAL_MS) bucket.push(pointsByTime.get(new Date(t).toISOString()) || gap(t, "not_collected"));
    // Conservative downsampling: never bridge a missing interval with an average.
    const missing = bucket.find(p => p.gap);
    if (missing) points.push(gap(time, missing.gap!));
    else {
      const average = (field: "cpu" | "mem" | "netIn" | "netOut") => bucket.some(p => p[field] === null) ? null : bucket.reduce((sum, p) => sum + p[field]!, 0) / bucket.length;
      points.push({ time: new Date(time).toISOString(), cpu: average("cpu"), mem: average("mem"), netIn: average("netIn"), netOut: average("netOut") });
    }
  }
  return { points, identity, intervalMs: MONITORING_INTERVAL_MS * step, retentionDays: MONITORING_RETENTION_DAYS, networkUnit: "bytes (cumulative counters, not bytes/s)" };
}
