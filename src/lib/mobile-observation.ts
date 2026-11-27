import { percent } from "./mobile-snapshot-view";
export type ResourceObservation = {
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
};
export const emptyResources = (): ResourceObservation => ({cpuPercent:null,memoryPercent:null,diskPercent:null});
export function observedRatio(total: unknown, used: unknown): number | null {
  if (typeof total !== "number" || typeof used !== "number" || !Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  return percent(100 * used / total);
}
function parseUsageLine(raw: string): number | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3 || parts.some(v => !/^\d+$/.test(v))) return null;
  const [total, used] = parts.map(Number);
  return observedRatio(total, used);
}
export function parseRemoteObservation(cpuRaw: string, memRaw: string, diskRaw: string): ResourceObservation {
  const idle = /(?:^|[\s,])(\d+(?:\.\d+)?)\s*id(?:\s|,|$)/.exec(cpuRaw);
  const idlePct = idle ? percent(Number(idle[1])) : null;
  return { cpuPercent: idlePct === null ? null : percent(100-idlePct),
    memoryPercent: parseUsageLine(memRaw), diskPercent: parseUsageLine(diskRaw) };
}
// Only a transport error from the connection stage, never arbitrary command errors.
export function connectionReachability(error: unknown): "offline" | "unknown" {
  if (!(error instanceof Error)) return "unknown";
  const code = (error as Error & {code?:unknown}).code;
  return typeof code === "string" && ["ECONNREFUSED","ETIMEDOUT","EHOSTUNREACH","ENETUNREACH","ENOTFOUND","ECONNRESET"].includes(code) ? "offline" : "unknown";
}
export function observedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
