import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { validateHealthCheck, validateDomain } from "@/lib/validation";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalAppId, parseLocalContainerId, getLocalContainerDetail, execLocal } from "@/lib/local-server";
import type {
  ApiResponse,
  AppDetailInfo,
  AppStatusType,
  UpdateAppInput,
  ContainerStats,
  AppMetricInfo,
} from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── Helper: Map Prisma App → AppDetailInfo ───

function toAppDetail(
  app: {
    id: string;
    name: string;
    containerId: string | null;
    containerName: string | null;
    image: string | null;
    serverId: string;
    deploymentId: string | null;
    status: string;
    domain: string | null;
    cpuLimit: number | null;
    memoryLimit: number | null;
    storageLimit: number | null;
    encryptedEnv: string | null;
    restartPolicy: string | null;
    healthCheck: string | null;
    volumes: string | null;
    ports: string | null;
    createdAt: Date;
    updatedAt: Date;
    server: { name: string };
  }
): AppDetailInfo {
  return {
    id: app.id,
    name: app.name,
    containerId: app.containerId,
    containerName: app.containerName,
    image: app.image,
    serverId: app.serverId,
    serverName: app.server.name,
    status: app.status as AppStatusType,
    domain: app.domain,
    cpuLimit: app.cpuLimit,
    memoryLimit: app.memoryLimit,
    storageLimit: app.storageLimit,
    restartPolicy: app.restartPolicy,
    healthCheck: app.healthCheck,
    volumes: app.volumes,
    ports: app.ports,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

// ─── Helper: Parse docker stats output ───

function parseDockerStats(raw: string): ContainerStats | null {
  // Format: CPU% MEM_USAGE/MEM_LIMIT MEM% NET_IN/NET_OUT PIDS
  const lines = raw.trim().split("\n").filter(Boolean);
  if (!lines.length) return null;

  const parts = lines[0].split(/\s+/);
  if (parts.length < 6) return null;

  const cpuPercent = parseFloat(parts[0]) || 0;

  // Parse memory: "123.4MiB / 1GiB"
  const memParts = parts[1].split("/");
  const memUsageMB = parseMem(memParts[0]?.trim() || "0");
  const memLimitMB = parseMem(memParts[1]?.trim() || "0");
  const memPercent = parseFloat(parts[2]) || 0;

  // Parse network: "1.23kB / 456B"
  const netInOut = parts[3].split("/");
  const netIn = parseBytes(netInOut[0]?.trim() || "0");
  const netOut = parseBytes(netInOut[1]?.trim() || "0");

  const pids = parseInt(parts[5], 10) || 0;

  return { cpuPercent, memUsageMB, memLimitMB, memPercent, netIn, netOut, pids };
}

function parseMem(s: string): number {
  const n = parseFloat(s);
  if (s.includes("GiB")) return n * 1024;
  if (s.includes("MiB")) return n;
  if (s.includes("KiB")) return n / 1024;
  if (s.includes("B")) return n / (1024 * 1024);
  return n;
}

function parseBytes(s: string): number {
  const n = parseFloat(s);
  if (s.includes("GB")) return n * 1e9;
  if (s.includes("MB")) return n * 1e6;
  if (s.includes("kB")) return n * 1e3;
  return n;
}

/**
 * GET /api/apps/[id] - Get full app detail with optional live stats.
 * Query: ?stats=true to include live container stats.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<AppDetailInfo & { liveStats?: ContainerStats | null; metrics?: AppMetricInfo[] }>>> {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const includeStats = url.searchParams.get("stats") === "true";
    const includeMetrics = url.searchParams.get("metrics") === "true";

    // ── Local container: build virtual AppDetailInfo from Docker ──
    if (isLocalAppId(id)) {
      const containerId = parseLocalContainerId(id);
      const container = getLocalContainerDetail(containerId);
      if (!container) {
        return NextResponse.json(
          { success: false, error: "Local container not found" },
          { status: 404 }
        );
      }

      const stateMap: Record<string, AppStatusType> = {
        running: "RUNNING", exited: "STOPPED", dead: "STOPPED",
        created: "STOPPED", restarting: "RESTARTING", paused: "UNHEALTHY",
      };

      const detail: AppDetailInfo = {
        id,
        name: container.name || container.image || containerId,
        containerId: containerId,
        containerName: container.name,
        image: container.image,
        serverId: "local",
        serverName: "This Server",
        status: stateMap[container.state] || "UNKNOWN",
        domain: null,
        cpuLimit: null,
        memoryLimit: null,
        storageLimit: null,
        restartPolicy: null,
        healthCheck: null,
        volumes: null,
        ports: container.ports || null,
        createdAt: container.createdAt,
        updatedAt: container.createdAt,
      };

      let liveStats: ContainerStats | null = null;
      if (includeStats) {
        try {
          const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
          const raw = execLocal(
            `docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}} {{.MemPerc}} {{.NetIO}} {{.PIDs}}' ${safeId} 2>/dev/null`,
            10_000
          );
          liveStats = parseDockerStats(raw.replace(/%/g, ""));
        } catch { /* stats unavailable */ }
      }

      return NextResponse.json({
        success: true,
        data: { ...detail, liveStats, metrics: [] },
      });
    }

    const app = await prisma.app.findUnique({
      where: { id },
      include: { server: true },
    });

    if (!app) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    const detail = toAppDetail(app);
    let liveStats: ContainerStats | null = null;
    let metrics: AppMetricInfo[] | undefined;

    // Fetch live container stats via SSH
    if (includeStats && app.containerId) {
      try {
        const server = await prisma.server.findUnique({
          where: { id: app.serverId },
        });

        if (server) {
          const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
          const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;

          const ssh = await createSSHConnection({
            host: server.host,
            port: server.port,
            username: server.username,
            password,
            privateKey,
          });

          try {
            const safeId = app.containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
            const raw = await executeCommand(
              ssh,
              `docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}} {{.MemPerc}} {{.NetIO}} {{.PIDs}}' ${safeId} 2>/dev/null`,
              10_000
            );
            liveStats = parseDockerStats(raw.replace(/%/g, ""));
          } finally {
            await closeSSH(ssh);
          }
        }
      } catch {
        // Live stats unavailable — not fatal
      }
    }

    // Fetch historical metrics
    if (includeMetrics) {
      const dbMetrics = await prisma.appMetric.findMany({
        where: { appId: id },
        orderBy: { timestamp: "desc" },
        take: 60, // Last 60 data points
      });

      metrics = dbMetrics.reverse().map((m) => ({
        id: m.id,
        cpuUsage: m.cpuUsage,
        memUsage: m.memUsage,
        netIn: m.netIn,
        netOut: m.netOut,
        timestamp: m.timestamp.toISOString(),
      }));
    }

    return NextResponse.json({
      success: true,
      data: { ...detail, liveStats, metrics },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get app";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/apps/[id] - Update app settings (resource limits, domain, etc.)
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<AppDetailInfo>>> {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as UpdateAppInput;

    const existing = await prisma.app.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    // ── Write-time validation ──
    if (body.healthCheck !== undefined) {
      const hcCheck = validateHealthCheck(body.healthCheck);
      if (!hcCheck.valid) {
        return NextResponse.json(
          { success: false, error: hcCheck.reason },
          { status: 400 }
        );
      }
    }
    if (body.domain !== undefined) {
      const domCheck = validateDomain(body.domain);
      if (!domCheck.valid) {
        return NextResponse.json(
          { success: false, error: domCheck.reason },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.domain !== undefined) updateData.domain = body.domain;
    if (body.cpuLimit !== undefined) updateData.cpuLimit = body.cpuLimit;
    if (body.memoryLimit !== undefined) updateData.memoryLimit = body.memoryLimit;
    if (body.storageLimit !== undefined) updateData.storageLimit = body.storageLimit;
    if (body.restartPolicy !== undefined) updateData.restartPolicy = body.restartPolicy;
    if (body.healthCheck !== undefined) updateData.healthCheck = body.healthCheck;

    const app = await prisma.app.update({
      where: { id },
      data: updateData,
      include: { server: true },
    });

    return NextResponse.json({ success: true, data: toAppDetail(app) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update app";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/apps/[id] - Remove app tracking record.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  try {
    const { id } = await context.params;

    const existing = await prisma.app.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    await prisma.app.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete app";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
