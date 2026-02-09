/**
 * Host system stats using Node.js os module.
 * Used for both snapshot API and SSE streaming.
 */

import os from "os";
import { execSync } from "child_process";

export interface SystemStats {
  hostname: string;
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

// Store previous CPU times for delta calculation
let prevCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));

function getCpuUsage(): number {
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

  return totalTick > 0
    ? Math.round(((totalTick - totalIdle) / totalTick) * 10000) / 100
    : 0;
}

function getDiskStats(): SystemStats["disk"] {
  try {
    const output = execSync("df -B1 / | awk 'NR==2{print $2,$3,$4}'")
      .toString()
      .trim();
    const [total, used, available] = output.split(" ").map(Number);

    return {
      total: total || 0,
      used: used || 0,
      available: available || 0,
      usagePercent: total
        ? Math.round((used / total) * 10000) / 100
        : 0,
    };
  } catch {
    // Fallback for non-Linux (e.g. development on Windows/Mac)
    return { total: 0, used: 0, available: 0, usagePercent: 0 };
  }
}

/**
 * Collect a snapshot of the host machine's system stats.
 */
export function getHostStats(): SystemStats {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptime: os.uptime(),
    cpu: {
      model: os.cpus()[0]?.model || "Unknown",
      cores: os.cpus().length,
      usagePercent: getCpuUsage(),
    },
    memory: {
      total: totalMem,
      used: usedMem,
      available: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 10000) / 100,
    },
    disk: getDiskStats(),
  };
}
