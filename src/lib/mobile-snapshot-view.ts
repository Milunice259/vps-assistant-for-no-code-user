/** Pure Mobile API projection: no IO, auth or monitoring side effects. */
export type Reachability = "online" | "offline" | "unknown";
export type MobileState = Reachability | "disabled" | "stale";
export type Observation = {
  observedAt: number;
  reachability: Reachability;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
};
export type Freshness = {
  enabled: boolean;
  online: boolean;
  intervalSeconds: number;
};
export function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : null;
}
export function projectMobileObservation(
  active: boolean,
  observation: Observation | null,
  worker: Freshness,
  now: number,
) {
  const validTime = observation !== null &&
    Number.isSafeInteger(observation.observedAt) && observation.observedAt > 0 &&
    Number.isSafeInteger(now) && observation.observedAt <= now;
  const observedAt = validTime && observation ? observation.observedAt : null;
  const interval = Number.isInteger(worker.intervalSeconds) &&
    worker.intervalSeconds >= 30 && worker.intervalSeconds <= 3600
    ? worker.intervalSeconds : 60;
  // Existing cycle has a 120s deadline; allow one cycle plus scheduler interval.
  const staleAfter = Math.max(180_000, (interval + 125) * 1000);
  const stale = observedAt !== null &&
    (!worker.enabled || !worker.online || now - observedAt > staleAfter);
  const reachability = observation?.reachability;
  const known = reachability === "online" || reachability === "offline";
  const state: MobileState = !active ? "disabled"
    : observedAt === null ? "unknown"
    : stale ? "stale"
    : known ? reachability : "unknown";
  // Never show cached numeric values as fresh for failed/disabled/stale observations.
  const show = state === "online";
  return {
    state, observedAt,
    cpuPercent: show ? percent(observation?.cpuPercent) : null,
    memoryPercent: show ? percent(observation?.memoryPercent) : null,
    diskPercent: show ? percent(observation?.diskPercent) : null,
  };
}
