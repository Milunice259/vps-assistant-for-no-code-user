import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, getRemoteContainers, closeSSH } from "@/lib/ssh";
import type { ApiResponse, AppInfo, AppStatusType, CreateAppInput } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Map Docker container state string to AppStatus.
 */
function mapContainerState(state: string): AppStatusType {
  const s = state.toLowerCase();
  if (s === "running") return "RUNNING";
  if (s === "exited" || s === "dead" || s === "created") return "STOPPED";
  if (s === "restarting") return "RESTARTING";
  if (s === "unhealthy" || s === "paused") return "UNHEALTHY";
  return "UNKNOWN";
}

/**
 * GET /api/apps - List all applications across all managed servers.
 *
 * This aggregates data from two sources:
 * 1. DB App records (manually tracked)
 * 2. Live Docker containers from each active server (discovered via SSH)
 *
 * DB records are merged with live data when container IDs match.
 * Containers not in the DB are included as "discovered" apps.
 */
export async function GET(): Promise<NextResponse<ApiResponse<AppInfo[]>>> {
  try {
    // Fetch all DB apps and all active servers in parallel
    const [dbApps, servers] = await Promise.all([
      prisma.app.findMany({ include: { server: true } }),
      prisma.server.findMany({ where: { isActive: true } }),
    ]);

    const allApps: AppInfo[] = [];
    const discoveredContainerIds = new Set<string>();

    // Add DB-tracked apps first
    for (const app of dbApps) {
      allApps.push({
        id: app.id,
        name: app.name,
        containerId: app.containerId,
        containerName: app.containerName,
        image: app.image,
        serverId: app.serverId,
        serverName: app.server.name,
        status: app.status as AppStatusType,
        domain: app.domain,
        createdAt: app.createdAt.toISOString(),
      });
      if (app.containerId) discoveredContainerIds.add(app.containerId);
    }

    // Discover live containers from each server
    for (const server of servers) {
      let ssh = null;
      try {
        const password = server.encryptedPass
          ? decrypt(server.encryptedPass)
          : undefined;
        const privateKey = server.encryptedKey
          ? decrypt(server.encryptedKey)
          : undefined;

        ssh = await createSSHConnection({
          host: server.host,
          port: server.port,
          username: server.username,
          password,
          privateKey,
        });

        const containers = await getRemoteContainers(ssh);

        for (const c of containers) {
          // Skip containers already tracked in DB
          if (discoveredContainerIds.has(c.id)) {
            // Update status for existing DB app
            const existing = allApps.find((a) => a.containerId === c.id);
            if (existing) {
              existing.status = mapContainerState(c.state);
            }
            continue;
          }

          allApps.push({
            id: `discovered::${server.id}::${c.id}`,
            name: c.name || c.image,
            containerId: c.id,
            containerName: c.name,
            image: c.image,
            serverId: server.id,
            serverName: server.name,
            status: mapContainerState(c.state),
            domain: null,
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        // Server is offline — mark its DB apps as UNKNOWN
        for (const app of allApps) {
          if (app.serverId === server.id && app.status !== "STOPPED") {
            app.status = "UNKNOWN";
          }
        }
      } finally {
        await closeSSH(ssh);
      }
    }

    return NextResponse.json({ success: true, data: allApps });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list applications";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/apps - Manually add a tracked application.
 * Body: { name, serverId, containerId?, containerName?, image?, domain? }
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<AppInfo>>> {
  try {
    const body = (await request.json()) as CreateAppInput;
    const { name, serverId, containerId, containerName, image, domain } = body;

    // Validate required fields
    if (!name || !serverId) {
      return NextResponse.json(
        { success: false, error: "name and serverId are required" },
        { status: 400 }
      );
    }

    // Verify the server exists
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    // Create the app record
    const app = await prisma.app.create({
      data: {
        name,
        serverId,
        containerId: containerId ?? null,
        containerName: containerName ?? null,
        image: image ?? null,
        domain: domain ?? null,
        status: "UNKNOWN",
      },
      include: { server: true },
    });

    const data: AppInfo = {
      id: app.id,
      name: app.name,
      containerId: app.containerId,
      containerName: app.containerName,
      image: app.image,
      serverId: app.serverId,
      serverName: app.server.name,
      status: app.status as AppStatusType,
      domain: app.domain,
      createdAt: app.createdAt.toISOString(),
    };

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create application";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
