import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessServer, scopedServerWhere } from "@/lib/server-access";
import { execLocal, execOnHost, getLocalHostPorts, tryExecOnHost, readHostFile } from "@/lib/local-server";
import { cachedInventory, mergeInventory, parseInventory, DOCKER_INVENTORY_COMMAND, SERVICE_INVENTORY_COMMAND, type InventoryApp } from "@/lib/apps-inventory";
import type { ApiResponse, DashboardSummary } from "@/types";

// Bind-mount path set by docker-compose
const HOST_OS_RELEASE = "/host/os-release";

export const dynamic = "force-dynamic";

function appCounts(apps: InventoryApp[]) {
  return {
    total: apps.length,
    running: apps.filter((app) => app.status === "RUNNING").length,
    stopped: apps.filter((app) => app.status === "STOPPED").length,
  };
}

// ─── Helper: count Docker networks ───

function getDockerNetworkCount(): number | null {
  try {
    // Docker CLI → socket → host daemon
    const raw = execLocal('docker network ls --format "{{.Name}}"', 10_000);
    if (!raw) return 0;
    return raw.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}

// ─── Helper: count listening ports on HOST ───

function getListeningPortCount(): number | null {
  try {
    return getLocalHostPorts().length;
  } catch {
    return null;
  }
}

// ─── Helper: get HOST OS info ───

interface OSInfo {
  distro: string;
  kernel: string;
  arch: string;
}

function getOSInfo(): OSInfo | null {
  let distro = "";
  let kernel = "";
  let arch = "";

  // 1. Try bind-mounted /host/os-release (fastest, no nsenter)
  const fromFile = readHostFile(HOST_OS_RELEASE);
  if (fromFile) {
    const nameMatch = fromFile.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (nameMatch?.[1]) distro = nameMatch[1];
  } else {
    // 2. Fallback: nsenter
    const raw = tryExecOnHost("cat /etc/os-release 2>/dev/null || echo ''", 5_000);
    const nameMatch = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (nameMatch?.[1]) distro = nameMatch[1];
  }

  // Kernel + arch: try nsenter, defaults to empty (UI shows "—")
  kernel = tryExecOnHost("uname -r", 5_000);
  arch = tryExecOnHost("uname -m", 5_000);

  return distro || kernel || arch ? { distro, kernel, arch } : null;
}

/**
 * Fetch aggregated dashboard summary data.
 * Exported so the SSE stream endpoint can reuse this.
 */
export async function getDashboardSummary(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<DashboardSummary> {
  const localAllowed = await canAccessServer(session.sub, session.role, "local");
  const serverScope = await scopedServerWhere(session.sub, session.role);
  const appScope = { OR: [
    { serverId: serverScope.id ?? { not: "local" } },
    ...(localAllowed ? [{ serverId: "local" }] : []),
  ] };
  const deploymentScope = { OR: [...appScope.OR, ...(localAllowed ? [{ serverId: null }] : [])] };
  const [servers, storedApps, deploymentCounts] = await Promise.all([
    prisma.server.findMany({ where: serverScope, select: { id: true, isActive: true, updatedAt: true } }),
    prisma.app.findMany({ where: appScope, include: { server: { select: { name: true } } } }),
    prisma.deploymentLog.groupBy({ where: deploymentScope, by: ["status"], _count: true }),
  ]);
  // Match /api/apps: stored and cached states are not current runtime observations.
  let apps: InventoryApp[] = storedApps.map((app) => ({
    ...app, serverName: app.server.name, createdAt: app.createdAt.toISOString(), status: "UNKNOWN",
  }));
  let containers: DashboardSummary["containers"] = null;
  if (localAllowed) {
    const observedAt = new Date().toISOString();
    for (const kind of ["docker", "systemd"] as const) {
      try {
        const raw = kind === "docker" ? execLocal(DOCKER_INVENTORY_COMMAND, 10_000) : execOnHost(SERVICE_INVENTORY_COMMAND, 10_000);
        const observed = parseInventory(raw, kind, "local", "This Server", observedAt);
        if (kind === "docker") containers = appCounts(observed);
        apps = mergeInventory(apps, observed);
      } catch { /* unavailable is not an empty successful observation */ }
    }
  }
  const remoteServers = servers.filter((server) => server.id !== "local");
  for (const server of remoteServers) {
    const snapshot = server.isActive ? cachedInventory(server.id, server.updatedAt.toISOString()) : undefined;
    if (snapshot) apps = mergeInventory(apps, snapshot.apps.map((app) => ({ ...app, status: "UNKNOWN" })));
  }
  const remoteTotal = remoteServers.length;
  const remoteActive = remoteServers.filter((server) => server.isActive).length;
  const remoteInactive = remoteTotal - remoteActive;

  // Aggregate deployment counts
  const deployTotal = deploymentCounts.reduce((sum, g) => sum + g._count, 0);
  const deployRunning =
    deploymentCounts.find((g) => g.status === "RUNNING")?._count ?? 0;
  const deployFailed =
    deploymentCounts.find((g) => g.status === "FAILED")?._count ?? 0;

  // Recent deployments (last 24h)
  const oneDayAgo = new Date(Date.now() - 86400_000);
  const recentCount = await prisma.deploymentLog.count({
    where: { ...deploymentScope, createdAt: { gte: oneDayAgo } },
  });

  return {
    containers,
    apps: appCounts(apps),
    servers: {
      total: remoteTotal + Number(localAllowed),
      active: remoteActive + Number(localAllowed),
      remote: remoteTotal,
      inactive: remoteInactive,
    },
    network: localAllowed ? {
      listeningPorts: getListeningPortCount(),
      dockerNetworks: getDockerNetworkCount(),
    } : null,
    deployments: {
      total: deployTotal,
      running: deployRunning,
      failed: deployFailed,
      recent: recentCount,
    },
    os: localAllowed ? getOSInfo() : null,
  };
}

/**
 * GET /api/dashboard/summary
 *
 * Aggregates counts from containers, apps, servers, network, and deployments
 * into a single response for the dashboard overview.
 */
export async function GET(): Promise<
  NextResponse<ApiResponse<DashboardSummary>>
> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const summary = await getDashboardSummary(session);
    return NextResponse.json({ success: true, data: summary }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get dashboard summary";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
