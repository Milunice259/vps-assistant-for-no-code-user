import type { SystemStats } from "@/types";

const GiB = 1024 ** 3;

export function getVirtualServerStats(id: string): SystemStats | null {
  const stats: Record<string, SystemStats> = {
    "seed-remote-healthy": {
      hostname: "seed-remote-healthy",
      localIp: "192.0.2.41",
      platform: "linux",
      uptime: 1000 * 60 * 60 * 24 * 18,
      cpu: { model: "4 vCPU Virtual VPS", cores: 4, usagePercent: 18 },
      memory: { total: 8 * GiB, used: 2.3 * GiB, available: 5.7 * GiB, usagePercent: 29 },
      disk: { total: 120 * GiB, used: 41 * GiB, available: 79 * GiB, usagePercent: 34 },
      os: { distro: "Ubuntu 24.04 LTS", version: "24.04", kernel: "6.8.0-virtual" },
    },
    "seed-remote-high-disk": {
      hostname: "seed-remote-high-disk",
      localIp: "192.0.2.42",
      platform: "linux",
      uptime: 1000 * 60 * 60 * 24 * 46,
      cpu: { model: "2 vCPU Virtual VPS", cores: 2, usagePercent: 42 },
      memory: { total: 4 * GiB, used: 2.8 * GiB, available: 1.2 * GiB, usagePercent: 70 },
      disk: { total: 80 * GiB, used: 73 * GiB, available: 7 * GiB, usagePercent: 91 },
      os: { distro: "Debian 12", version: "12", kernel: "6.1.0-cloud" },
    },
    "seed-remote-maintenance": {
      hostname: "seed-remote-maintenance",
      localIp: "192.0.2.43",
      platform: "linux",
      uptime: 1000 * 60 * 33,
      cpu: { model: "2 vCPU Virtual VPS", cores: 2, usagePercent: 8 },
      memory: { total: 2 * GiB, used: 0.8 * GiB, available: 1.2 * GiB, usagePercent: 40 },
      disk: { total: 50 * GiB, used: 18 * GiB, available: 32 * GiB, usagePercent: 36 },
      os: { distro: "Ubuntu 22.04 LTS", version: "22.04", kernel: "5.15.0-virtual" },
    },
  };
  return stats[id] ?? null;
}

export function getVirtualActionOutput(id: string, action: string): string | null {
  const stats = getVirtualServerStats(id);
  if (!stats) return null;

  switch (action) {
    case "check-disk":
      return `Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1       ${Math.round(stats.disk.total / GiB)}G   ${Math.round(stats.disk.used / GiB)}G   ${Math.round(stats.disk.available / GiB)}G  ${stats.disk.usagePercent.toFixed(0)}% /`;
    case "check-memory":
      return `              total        used        free      shared  buff/cache   available\nMem:           ${Math.round(stats.memory.total / GiB)}Gi       ${Math.round(stats.memory.used / GiB)}Gi       ${Math.round(stats.memory.available / GiB)}Gi       120Mi       500Mi       ${Math.round(stats.memory.available / GiB)}Gi\nSwap:          2.0Gi       0.0Gi       2.0Gi`;
    case "check-uptime":
      return `up ${Math.floor(Number(stats.uptime) / 86400000)} days, load average: 0.18, 0.22, 0.19`;
    case "docker-stats":
      return "NAME                CPU %     MEM USAGE / LIMIT     NET I/O\nseed-api-gateway    1.2%      128MiB / 512MiB       4MB / 8MB\nseed-worker         3.8%      256MiB / 1GiB         2MB / 1MB";
    case "check-connections":
      return "TCP: 42 (estab 12, closed 20, timewait 10)\nUDP: 8";
    case "check-docker-version":
      return "Docker version 27.5.1, build virtual-seed";
    default:
      return `Virtual test server: ${action} preview only. No real server was changed.`;
  }
}
