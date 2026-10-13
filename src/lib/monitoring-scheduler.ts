import { randomUUID } from "node:crypto";
import { prisma } from "./db";

export const MONITORING_CONFIG_KEY = "monitoring.config";
const LEASE_KEY = "monitoring.lease";
const STATUS_KEY = "monitoring.status";
export type MonitoringConfig = { enabled: boolean; intervalSeconds: number };
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = { enabled: true, intervalSeconds: 60 };
export function validateMonitoringConfig(value: unknown): value is MonitoringConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && typeof v.enabled === "boolean" && Number.isInteger(v.intervalSeconds) && Number(v.intervalSeconds) >= 30 && Number(v.intervalSeconds) <= 3600;
}
export async function getMonitoringConfig(): Promise<MonitoringConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: MONITORING_CONFIG_KEY } });
  if (!row) return { ...DEFAULT_MONITORING_CONFIG };
  const value: unknown = JSON.parse(row.value);
  if (!validateMonitoringConfig(value)) throw new Error("Invalid monitoring configuration");
  return value;
}
export async function saveMonitoringConfig(value: MonitoringConfig) {
  if (!validateMonitoringConfig(value)) throw new Error("Invalid monitoring configuration");
  await prisma.appSetting.upsert({ where: { key: MONITORING_CONFIG_KEY }, create: { key: MONITORING_CONFIG_KEY, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
  return getMonitoringConfig();
}
export async function acquireMonitoringLease(durationMs: number, intervalMs = 0) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) throw new Error("Invalid lease duration");
  const now = Date.now();
  const owner = randomUUID();
  const value = JSON.stringify({ owner, startedAt: now, expiresAt: now + durationMs });
  // One SQLite statement: a competing worker can replace only an expired lease.
  const changed = await prisma.$executeRawUnsafe(`INSERT INTO app_settings (key,value,updated_at) SELECT ?,?,? WHERE COALESCE((SELECT CAST(json_extract(value,'$.lastCompletedAt') AS INTEGER) FROM app_settings WHERE key=?),0) <= ? ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(json_extract(app_settings.value,'$.expiresAt') AS INTEGER) <= ?`, LEASE_KEY, value, new Date(now), STATUS_KEY, now - intervalMs, now);
  return changed === 1 ? owner : null;
}
export async function finishMonitoringLease(owner: string, outcome: "ok" | "failed" | "timeout", startedAt: number) {
  // Only the exact owner may complete/release; a late dead process cannot erase its replacement.
  await prisma.$transaction(async tx => {
    const changed = await tx.$executeRawUnsafe("DELETE FROM app_settings WHERE key=? AND json_extract(value,'$.owner')=?", LEASE_KEY, owner);
    if (changed !== 1) return;
    const value = JSON.stringify({ lastStartedAt: startedAt, lastCompletedAt: Date.now(), outcome });
    await tx.appSetting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value }, update: { value } });
  });
}
export async function getMonitoringStatus() {
  const config = await getMonitoringConfig();
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [LEASE_KEY, STATUS_KEY, "monitoring.heartbeat"] } } });
  const values = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]));
  const heartbeat = Number(values["monitoring.heartbeat"]?.at) || null;
  const status = values[STATUS_KEY];
  // No owner token, error details, fleet totals or per-server identity crosses this boundary.
  return { ...config, workerOnline: Boolean(heartbeat && Date.now() - heartbeat < 20_000), heartbeatAt: heartbeat, running: Number(values[LEASE_KEY]?.expiresAt) > Date.now(), lastStartedAt: Number(values[LEASE_KEY]?.startedAt) || Number(status?.lastStartedAt) || null, lastCompletedAt: Number(status?.lastCompletedAt) || null, nextRun: config.enabled && status?.lastCompletedAt ? new Date(Number(status.lastCompletedAt) + config.intervalSeconds * 1000).toISOString() : null, outcome: ["ok", "failed", "timeout"].includes(status?.outcome) ? status.outcome : null };
}
export async function writeMonitoringHeartbeat() {
  const value = JSON.stringify({ at: Date.now() });
  await prisma.appSetting.upsert({ where: { key: "monitoring.heartbeat" }, create: { key: "monitoring.heartbeat", value }, update: { value } });
}
