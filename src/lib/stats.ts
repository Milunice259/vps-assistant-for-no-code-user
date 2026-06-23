/**
 * Host system stats using Node.js os module.
 * Used for both snapshot API and SSE streaming.
 *
 * CPU usage is calculated via a single background sampler so that
 * concurrent SSE clients all read from one consistent value instead
 * of racing on a shared mutable variable.
 */

import os from "os";
import { execSync } from "child_process";

export interface SystemStats {
  hostname: string;
  localIp: string;
  platform: string;
  uptime: number;
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
}

// ─── CPU sampler (single background timer) ───
// One interval samples CPU ticks every 2 s and writes to a shared
// read-only value.  Multiple SSE streams read `latestCpuPercent`
// without any race condition because JS is single-threaded and
// the sampler writes atomically between event-loop ticks.

let latestCpuPercent = 0;
let prevCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));
let samplerTimer: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

function sampleCpu(): void {
  const currentTimes = os.cpus().map((cpu) => ({ ...cpu.times }));

  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < currentTimes.length; i++) {
    const prev = prevCpuTimes[i];
    const curr = currentTimes[i];
    if (!prev || !curr) continue;

    const idleDiff = curr.idle - prev.idle;
    const totalDiff =
      curr.user -
      prev.user +
      (curr.nice - prev.nice) +
      (curr.sys - prev.sys) +
      (curr.idle - prev.idle) +
      (curr.irq - prev.irq);

    totalIdle += idleDiff;
    totalTick += totalDiff;
  }

  prevCpuTimes = currentTimes;
  latestCpuPercent =
    totalTick > 0
      ? Math.round(((totalTick - totalIdle) / totalTick) * 10000) / 100
      : 0;
}

/**
 * Register a subscriber for system stats.
 * Starts the CPU sampler on the first subscriber; stops it when the
 * last subscriber unregisters — so the timer never runs when no one
 * is listening.
 */
export function subscribeStats(): () => void {
  subscriberCount++;
  if (subscriberCount === 1 && !samplerTimer) {
    // Take an initial sample immediately so the first read is non-zero
    sampleCpu();
    samplerTimer = setInterval(sampleCpu, 2000);
    // Prevent the timer from keeping the process alive on shutdown
    if (samplerTimer && typeof samplerTimer === "object" && "unref" in samplerTimer) {
      samplerTimer.unref();
    }
  }
  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0 && samplerTimer) {
      clearInterval(samplerTimer);
      samplerTimer = null;
    }
  };
}

// ─── Disk stats (cached for 5 s to avoid spawning df too often) ───

let cachedDisk: SystemStats["disk"] = {
  total: 0,
  used: 0,
  available: 0,
  usagePercent: 0,
};
let diskCacheExpiry = 0;
const DISK_CACHE_MS = 5000;

function getPrimaryLocalIp(): string {
  try {
    const hostIp = execSync("nsenter -t 1 -m -u -n -i -- hostname -I | awk '{print $1}'", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (hostIp) return hostIp;
  } catch {
    // Fallback to container-visible interfaces in local development.
  }

  const nets = os.networkInterfaces();
  for (const addresses of Object.values(nets)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "Unavailable";
}

function getDiskStats(): SystemStats["disk"] {
  const now = Date.now();
  if (now < diskCacheExpiry) return cachedDisk;

  try {
    const output = execSync("df -B1 / | awk 'NR==2{print $2,$3,$4}'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const [total, used, available] = output.split(" ").map(Number);

    cachedDisk = {
      total: total || 0,
      used: used || 0,
      available: available || 0,
      usagePercent: total
        ? Math.round((used / total) * 10000) / 100
        : 0,
    };
  } catch {
    // Fallback for non-Linux (e.g. development on Windows/Mac)
    cachedDisk = { total: 0, used: 0, available: 0, usagePercent: 0 };
  }

  diskCacheExpiry = now + DISK_CACHE_MS;
  return cachedDisk;
}

/**
 * Collect a snapshot of the host machine's system stats.
 * CPU percentage comes from the background sampler; memory and disk
 * are read on demand (disk is cached for 5 s).
 */
export function getHostStats(): SystemStats {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      hostname: os.hostname(),
      localIp: getPrimaryLocalIp(),
      platform: `${os.type()} ${os.release()}`,
      uptime: os.uptime(),
      cpu: {
        model: os.cpus()[0]?.model || "Unknown",
        cores: os.cpus().length || 1,
        usagePercent: latestCpuPercent,
      },
      memory: {
        total: totalMem,
        used: usedMem,
        available: freeMem,
        usagePercent: totalMem > 0
          ? Math.round((usedMem / totalMem) * 10000) / 100
          : 0,
      },
      disk: getDiskStats(),
    };
  } catch (err) {
    console.error("[stats] Failed to collect host stats:", err);
    return {
      hostname: "unknown",
      localIp: "Unavailable",
      platform: "Linux",
      uptime: 0,
      cpu: { model: "Unknown", cores: 1, usagePercent: 0 },
      memory: { total: 0, used: 0, available: 0, usagePercent: 0 },
      disk: { total: 0, used: 0, available: 0, usagePercent: 0 },
    };
  }
}
