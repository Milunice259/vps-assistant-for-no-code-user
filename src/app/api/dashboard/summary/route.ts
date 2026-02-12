import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import { prisma } from "@/lib/db";
import type { ApiResponse, DashboardSummary } from "@/types";

export const dynamic = "force-dynamic";

// ─── Helper: count local Docker containers by state ───

interface ContainerCounts {
  total: number;
  running: number;
  stopped: number;
}

function getContainerCounts(): ContainerCounts {
  try {
    const raw = execSync('docker ps -a --format "{{.State}}"', {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!raw) return { total: 0, running: 0, stopped: 0 };

    const states = raw.split("\n").filter(Boolean);
    return {
      total: states.length,
      running: states.filter((s) => s.toLowerCase() === "running").length,
      stopped: states.filter((s) =>
        ["exited", "dead", "created"].includes(s.toLowerCase())
      ).length,
    };
  } catch {
    return { total: 0, running: 0, stopped: 0 };
  }
}

// ─── Helper: count Docker networks ───

function getDockerNetworkCount(): number {
  try {
    const raw = execSync('docker network ls --format "{{.Name}}"', {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!raw) return 0;
    return raw.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ─── Helper: count listening ports (Linux only) ───

function getListeningPortCount(): number {
  if (os.platform() !== "linux") return 0;
  try {
    const raw = execSync("ss -tulnp 2>/dev/null | tail -n +2 | wc -l", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

// ─── Helper: get OS info ───

interface OSInfo {
  distro: string;
  kernel: string;
  arch: string;
}

function getOSInfo(): OSInfo {
  const arch = os.arch();
  const kernel = os.release();

  // Try to read /etc/os-release for distro name
  let distro = os.type();
  try {
    const raw = execSync('cat /etc/os-release 2>/dev/null || echo ""', {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const nameMatch = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (nameMatch?.[1]) distro = nameMatch[1];
  } catch {
    // Keep os.type() fallback
  }

  return { distro, kernel, arch };
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
    // Run all queries in parallel
    const [
      containers,
      dockerNetworks,
      listeningPorts,
      serverCount,
      appCounts,
      deploymentCounts,
    ] = await Promise.all([
      // Docker containers (sync but fast)
      Promise.resolve(getContainerCounts()),
      Promise.resolve(getDockerNetworkCount()),
      Promise.resolve(getListeningPortCount()),

      // DB queries
      prisma.server.count(),
      prisma.app.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.deploymentLog.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

    // Aggregate app counts
    const appTotal = appCounts.reduce((sum, g) => sum + g._count, 0);
    const appRunning =
      appCounts.find((g) => g.status === "RUNNING")?._count ?? 0;
    const appStopped =
      appCounts.find((g) => g.status === "STOPPED")?._count ?? 0;

    // Aggregate deployment counts
    const deployTotal = deploymentCounts.reduce((sum, g) => sum + g._count, 0);
    const deployRunning =
      deploymentCounts.find((g) => g.status === "RUNNING")?._count ?? 0;
    const deployFailed =
      deploymentCounts.find((g) => g.status === "FAILED")?._count ?? 0;

    // Recent deployments (last 24h)
    const oneDayAgo = new Date(Date.now() - 86400_000);
    const recentCount = await prisma.deploymentLog.count({
      where: { createdAt: { gte: oneDayAgo } },
    });

    const summary: DashboardSummary = {
      containers,
      apps: {
        total: appTotal,
        running: appRunning,
        stopped: appStopped,
      },
      servers: {
        total: serverCount + 1, // +1 for local server
        active: serverCount + 1, // local is always active
      },
      network: {
        listeningPorts,
        dockerNetworks,
      },
      deployments: {
        total: deployTotal,
        running: deployRunning,
        failed: deployFailed,
        recent: recentCount,
      },
      os: getOSInfo(),
    };

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get dashboard summary";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
