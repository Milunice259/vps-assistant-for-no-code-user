/**
 * SSH Stats — system stats and OS detail retrieval via SSH.
 */

import type SSH2Promise from "ssh2-promise";
import { executeCommand, executeCommandSafe } from "./connection";

/**
 * Fetch system stats from a remote VPS via SSH.
 * All 6 commands run in parallel for minimal latency.
 */
export async function getRemoteStats(ssh: SSH2Promise) {
  const [cpuRaw, memRaw, diskRaw, uptimeRaw, hostnameRaw, osRaw] =
    await Promise.all([
      executeCommand(ssh, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"),
      executeCommand(ssh, "free -b | awk 'NR==2{printf \"%s %s %s\", $2, $3, $7}'"),
      executeCommand(ssh, "df -B1 / | awk 'NR==2{printf \"%s %s %s\", $2, $3, $4}'"),
      executeCommand(ssh, "uptime -p 2>/dev/null || uptime"),
      executeCommand(ssh, "hostname"),
      executeCommand(ssh, "cat /etc/os-release 2>/dev/null | head -1 | cut -d'\"' -f2 || uname -s"),
    ]);

  const [memTotal, memUsed, memAvailable] = memRaw.split(" ").map(Number);
  const [diskTotal, diskUsed, diskAvailable] = diskRaw.split(" ").map(Number);

  return {
    hostname: hostnameRaw,
    platform: osRaw,
    uptime: uptimeRaw,
    cpu: { usagePercent: parseFloat(cpuRaw) || 0 },
    memory: {
      total: memTotal || 0,
      used: memUsed || 0,
      available: memAvailable || 0,
      usagePercent: memTotal ? (memUsed / memTotal) * 100 : 0,
    },
    disk: {
      total: diskTotal || 0,
      used: diskUsed || 0,
      available: diskAvailable || 0,
      usagePercent: diskTotal ? (diskUsed / diskTotal) * 100 : 0,
    },
  };
}

// ─── OS Details ───

export interface RemoteOSDetails {
  distro: string;
  version: string;
  kernel: string;
}

/**
 * Fetch detailed OS information from a remote server.
 */
export async function getRemoteOSDetails(
  ssh: SSH2Promise
): Promise<RemoteOSDetails> {
  const [kernelRaw, prettyName, versionId] = await Promise.all([
    executeCommandSafe(ssh, "uname -r"),
    executeCommandSafe(ssh, "grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d'\"' -f2"),
    executeCommandSafe(ssh, "grep '^VERSION_ID=' /etc/os-release 2>/dev/null | cut -d'\"' -f2"),
  ]);

  return {
    distro: prettyName || "Unknown Linux",
    version: versionId || "",
    kernel: kernelRaw || "",
  };
}
