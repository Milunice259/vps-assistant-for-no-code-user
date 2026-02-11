import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getContainerLogs, closeSSH } from "@/lib/ssh";
import { isLocalServer, execLocal } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/apps/[id]/logs?lines=100 - Fetch recent logs for an application.
 *
 * ID formats:
 *   - "discovered::local::{containerId}" — local discovered container
 *   - "discovered::{serverId}::{containerId}" — remote discovered container
 *   - "local::{containerId}" — local container
 *   - any other — DB app
 *
 * For local containers: uses execSync("docker logs ...").
 * For remote containers: uses SSH.
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
      const parts = id.split("::");
      serverId = parts[1] || "";
      containerRef = parts[2] || "";

      if (!serverId || !containerRef) {
        return NextResponse.json(
          { success: false, error: "Invalid discovered app ID format" },
          { status: 400 }
        );
      }
    } else if (id.startsWith("local::")) {
      serverId = "local";
      containerRef = id.replace("local::", "");
    } else {
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

    // Local server — use execSync
    if (isLocalServer(serverId)) {
      try {
        const safeRef = containerRef.replace(/[^a-zA-Z0-9_.-]/g, "");
        const logs = execLocal(
          `docker logs --tail ${lines} ${safeRef} 2>&1`,
          15_000
        );
        return NextResponse.json({ success: true, data: { logs } });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to fetch logs";
        return NextResponse.json({ success: true, data: { logs: msg } });
      }
    }

    // Remote server — use SSH
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
