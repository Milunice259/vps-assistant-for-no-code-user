import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { containerAction, closeSSH, executeCommand } from "@/lib/ssh";
import { execLocal, isLocalServer } from "@/lib/local-server";
import { validateContainerId } from "@/lib/validation";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { operationResult, type OperationResult } from "@/lib/operation-result";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ACTIONS = ["start", "stop", "restart"] as const;

/**
 * POST /api/servers/[id]/docker/action - Perform a Docker container action.
 * Body: { containerId: string, action: "start" | "stop" | "restart" }
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<OperationResult>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;

    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const body = await request.json();
    const { containerId, action } = body as {
      containerId?: string;
      action?: string;
      safeModeOff?: boolean;
    };

    if (!containerId || !action) {
      return NextResponse.json(
        { success: false, error: "containerId and action are required" },
        { status: 400 }
      );
    }

    // ── Validate containerId at API boundary ──
    const idCheck = validateContainerId(containerId);
    if (!idCheck.valid) {
      return NextResponse.json(
        { success: false, error: idCheck.reason },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const safetyBlock = requireSafeModeOff(`container_${action}`, body);
    if (safetyBlock) return safetyBlock;

    if (isLocalServer(id)) {
      const output = execLocal(`docker ${action} ${containerId} 2>&1`, 30_000);
      const status = execLocal(`docker inspect -f '{{.State.Status}}' ${containerId} 2>/dev/null || true`, 10_000).trim();
      const verified = action === "start" ? status === "running" : action === "stop" ? status === "exited" : status.length > 0;
      await auditLog({ action: `container_${action}` as "container_start" | "container_stop" | "container_restart", userId: session.sub, username: session.username, ip: getClientIp(request), target: id, details: JSON.stringify({ containerId, output: output || null, verified, status }) });
      return NextResponse.json({
        success: true,
        data: operationResult({ message: output || `Container ${action} successful`, risk: "danger", verified, output: status ? `Current status: ${status}` : output }),
      });
    }

    const result = await connectToServer(id);
    ssh = result.ssh;

    const actionResult = await containerAction(
      ssh,
      containerId,
      action as (typeof VALID_ACTIONS)[number]
    );

    if (!actionResult.success) {
      return NextResponse.json(
        { success: false, error: actionResult.message },
        { status: 500 }
      );
    }

    const status = (await executeCommand(ssh, `docker inspect -f '{{.State.Status}}' ${containerId} 2>/dev/null || true`, 10_000)).trim();
    const verified = action === "start" ? status === "running" : action === "stop" ? status === "exited" : status.length > 0;
    await auditLog({ action: `container_${action}` as "container_start" | "container_stop" | "container_restart", userId: session.sub, username: session.username, ip: getClientIp(request), target: id, details: JSON.stringify({ containerId, verified, status }) });
    return NextResponse.json({
      success: true,
      data: operationResult({ message: actionResult.message, risk: "danger", verified, output: status ? `Current status: ${status}` : actionResult.message }),
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
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to perform container action") }, { status });
  } finally {
    await closeSSH(ssh);
  }
}
