import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getContainerLogs, closeSSH } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/apps/[id]/logs?lines=100 - Fetch recent logs for a tracked application.
 *
 * If the ID starts with "discovered::", it's parsed as a live-discovered container
 * (format: discovered::{serverId}::{containerId}).
 * Otherwise, it's looked up in the DB App table.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ logs: string }>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const lines = parseInt(url.searchParams.get("lines") || "100", 10);

    let serverId: string;
    let containerRef: string;

    if (id.startsWith("discovered::")) {
      // Format: discovered::{serverId}::{containerId}
      // Using :: delimiter to safely support any ID format (CUID, UUID, etc.)
      const parts = id.split("::");
      // parts[0] = "discovered", parts[1] = serverId, parts[2] = containerId
      serverId = parts[1] || "";
      containerRef = parts[2] || "";

      if (!serverId || !containerRef) {
        return NextResponse.json(
          { success: false, error: "Invalid discovered app ID format" },
          { status: 400 }
        );
      }
    } else {
      // DB-tracked app
      const app = await prisma.app.findUnique({ where: { id } });

      if (!app) {
        return NextResponse.json(
          { success: false, error: "App not found" },
          { status: 404 }
        );
      }

      serverId = app.serverId;
      containerRef = app.containerName || app.containerId || "";

      if (!containerRef) {
        return NextResponse.json(
          { success: false, error: "App has no associated container" },
          { status: 400 }
        );
      }
    }

    const result = await connectToServer(serverId);
    ssh = result.ssh;

    const logs = await getContainerLogs(ssh, containerRef, lines);

    return NextResponse.json({ success: true, data: { logs } });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
        { status: 503 }
      );
    }

    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 500;
    const message = err.message || "Failed to fetch logs";
    return NextResponse.json({ success: false, error: message }, { status });
  } finally {
    await closeSSH(ssh);
  }
}
