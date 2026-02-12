import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { quickAction, closeSSH } from "@/lib/ssh";
import { isLocalServer, localQuickAction } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ACTIONS = [
  "system-update",
  "docker-prune",
  "restart-docker",
  "clear-apt-cache",
  "clear-logs",
  "check-disk",
  "security-updates",
  "docker-stats",
  "sync-time",
  "restart-server",
] as const;

/**
 * POST /api/servers/[id]/actions - Run a quick maintenance action.
 * Body: { action: "system-update" | "docker-prune" | ... }
 *
 * For local server: uses execLocal() directly.
 * For remote servers: uses SSH.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { action } = body as { action?: string };

    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Local server — execute directly
    if (isLocalServer(id)) {
      const result = localQuickAction(action);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.output },
          { status: 500 }
        );
      }
      return NextResponse.json({
        success: true,
        data: { output: result.output },
      });
    }

    // Remote server — use SSH
    const result = await connectToServer(id);
    ssh = result.ssh;

    const actionResult = await quickAction(ssh, action);

    if (!actionResult.success) {
      return NextResponse.json(
        { success: false, error: actionResult.output },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { output: actionResult.output },
    });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
        { status: 503 }
      );
    }

    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 500;
    const message = err.message || "Failed to run action";
    return NextResponse.json({ success: false, error: message }, { status });
  } finally {
    await closeSSH(ssh);
  }
}
