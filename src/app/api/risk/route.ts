import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLocalServerInfo, isLocalServer } from "@/lib/local-server";
import { getHostStats } from "@/lib/stats";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, getRemoteStats } from "@/lib/ssh";
import { getVirtualServerStats } from "@/lib/virtual-server-data";
import type { ApiResponse, ServerInfo, SystemStats } from "@/types";

export const dynamic = "force-dynamic";

type RiskSeverity = "critical" | "warning" | "info";

interface RiskAlert {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  nextStep: string;
}

interface ServerRisk {
  serverId: string;
  serverName: string;
  host: string;
  status: "online" | "offline" | "unknown";
  score: number;
  label: "Healthy" | "Needs Attention" | "Critical";
  alerts: RiskAlert[];
  stats?: {
    cpu: number;
    memory: number;
    disk: number;
    uptime: number | string;
  };
}

interface RiskSummary {
  score: number;
  label: "Healthy" | "Needs Attention" | "Critical";
  servers: ServerRisk[];
  alerts: Array<RiskAlert & { serverId: string; serverName: string }>;
}

function labelFromScore(score: number): RiskSummary["label"] {
  if (score >= 85) return "Healthy";
  if (score >= 65) return "Needs Attention";
  return "Critical";
}

function addUsageRisk(alerts: RiskAlert[], id: string, label: string, value: number, warning: number, critical: number) {
  if (value >= critical) {
    alerts.push({
      id,
      severity: "critical",
      title: `${label} is critically high`,
      detail: `${label} is using ${value.toFixed(0)}%. Apps may slow down or fail if this continues.`,
      nextStep: label === "Disk" ? "Create a backup, then clean Docker cache/logs." : "Check app usage before restarting anything.",
    });
  } else if (value >= warning) {
    alerts.push({
      id,
      severity: "warning",
      title: `${label} needs attention`,
      detail: `${label} is using ${value.toFixed(0)}%. It is manageable, but should be watched.`,
      nextStep: label === "Disk" ? "Plan a cleanup before it reaches 90%." : "Watch the trend and inspect app resource usage if it keeps rising.",
    });
  }
}

function buildStatsRisk(server: ServerInfo, stats: SystemStats): ServerRisk {
  const alerts: RiskAlert[] = [];
  addUsageRisk(alerts, "cpu", "CPU", stats.cpu.usagePercent, 75, 90);
  addUsageRisk(alerts, "memory", "Memory", stats.memory.usagePercent, 80, 92);
  addUsageRisk(alerts, "disk", "Disk", stats.disk.usagePercent, 75, 88);

  const penalty = alerts.reduce((sum, alert) => sum + (alert.severity === "critical" ? 28 : alert.severity === "warning" ? 14 : 6), 0);
  const score = Math.max(0, 100 - penalty);

  return {
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    status: "online",
    score,
    label: labelFromScore(score),
    alerts,
    stats: {
      cpu: stats.cpu.usagePercent,
      memory: stats.memory.usagePercent,
      disk: stats.disk.usagePercent,
      uptime: stats.uptime,
    },
  };
}

function offlineRisk(server: ServerInfo, detail: string): ServerRisk {
  const alerts: RiskAlert[] = [{
    id: "server-unreachable",
    severity: "critical",
    title: "Server unreachable",
    detail,
    nextStep: "Check VPS power/network first, then verify SSH credentials and firewall rules.",
  }];

  return {
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    status: "offline",
    score: 30,
    label: "Critical",
    alerts,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

async function getServerRisk(server: ServerInfo): Promise<ServerRisk> {
  if (isLocalServer(server.id)) {
    return buildStatsRisk(server, getHostStats());
  }

  const virtualStats = getVirtualServerStats(server.id);
  if (virtualStats) return buildStatsRisk(server, virtualStats);

  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
  try {
    const result = await withTimeout(connectToServer(server.id), 6_000, "SSH connection timed out");
    ssh = result.ssh;
    const stats = await withTimeout(getRemoteStats(ssh), 6_000, "Stats command timed out");
    return buildStatsRisk(server, stats);
  } catch (error) {
    const detail = isDisconnectedError(error)
      ? "The control panel cannot reach this server over SSH."
      : error instanceof Error ? error.message : "Failed to read server health.";
    return offlineRisk(server, detail);
  } finally {
    await closeSSH(ssh);
  }
}

async function listServers(): Promise<ServerInfo[]> {
  const rows = await prisma.server.findMany({
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      authMethod: true,
      isActive: true,
      lastConnected: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

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

export async function GET(): Promise<NextResponse<ApiResponse<RiskSummary>>> {
  try {
    const servers = await listServers();
    const risks = await Promise.all(servers.map((server) => getServerRisk(server)));
    const score = risks.length > 0 ? Math.round(risks.reduce((sum, item) => sum + item.score, 0) / risks.length) : 100;
    const alerts = risks.flatMap((server) => server.alerts.map((alert) => ({ ...alert, serverId: server.serverId, serverName: server.serverName })));

    return NextResponse.json({
      success: true,
      data: {
        score,
        label: labelFromScore(score),
        servers: risks,
        alerts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to calculate server risk";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
