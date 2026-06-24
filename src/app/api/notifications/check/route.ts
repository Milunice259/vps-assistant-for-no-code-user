import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLocalServerInfo, isLocalServer } from "@/lib/local-server";
import { getHostStats } from "@/lib/stats";
import { connectToServer } from "@/lib/server-ssh";
import { closeSSH, getRemoteStats } from "@/lib/ssh";
import { evaluateAlertRules } from "@/lib/notifications";
import type { ApiResponse, ServerInfo } from "@/types";

export const dynamic = "force-dynamic";

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

async function checkServer(server: ServerInfo) {
  if (isLocalServer(server.id)) {
    const stats = getHostStats();
    await evaluateAlertRules({ cpu: stats.cpu.usagePercent, memory: stats.memory.usagePercent, disk: stats.disk.usagePercent }, server.name, server.id);
    return { serverId: server.id, serverName: server.name, status: "checked" };
  }

  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
  try {
    const result = await connectToServer(server.id);
    ssh = result.ssh;
    const stats = await getRemoteStats(ssh);
    await evaluateAlertRules({ cpu: stats.cpu.usagePercent, memory: stats.memory.usagePercent, disk: stats.disk.usagePercent }, server.name, server.id);
    return { serverId: server.id, serverName: server.name, status: "checked" };
  } catch {
    await evaluateAlertRules({ cpu: 0, memory: 0, disk: 0, offline: 1 }, server.name, server.id);
    return { serverId: server.id, serverName: server.name, status: "offline" };
  } finally {
    await closeSSH(ssh);
  }
}

export async function POST(): Promise<NextResponse<ApiResponse<{ checked: number; offline: number; results: Awaited<ReturnType<typeof checkServer>>[] }>>> {
  const servers = await listServers();
  const results = await Promise.all(servers.map(checkServer));
  return NextResponse.json({
    success: true,
    data: {
      checked: results.length,
      offline: results.filter((r) => r.status === "offline").length,
      results,
    },
  });
}
