import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
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
    if (!idCheck.valid || containerId.startsWith("-")) {
      return NextResponse.json(
        { success: false, error: !idCheck.valid ? idCheck.reason : "Invalid container ID" },
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

    let commandOutput: string;
    if (isLocalServer(id)) {
      commandOutput = execLocal(`docker ${action} ${containerId} 2>&1`, 30_000);
    } else {
      ssh = (await connectToServer(id)).ssh;
      // ssh2-promise ignores exit codes, so stdout alone is not success evidence.
      const output = await executeCommand(ssh, `docker ${action} ${containerId} 2>&1 && printf '\\n__ACTION_COMPLETED__\\n'`, 30_000);
      if (!output.trim().endsWith("__ACTION_COMPLETED__")) throw new Error("Container command did not complete successfully");
      commandOutput = output.replace(/\s*__ACTION_COMPLETED__\s*$/, "");
    }

    // One immediate lifecycle/health snapshot, not an application endpoint probe.
    const verifyCmd = `docker inspect -f '{{json .State}}' ${containerId} 2>/dev/null`;
    let status = "unknown";
    let health: NonNullable<OperationResult["health"]> = "unknown";
    let readbackError = "";
    try {
      const raw = ssh ? await executeCommand(ssh, verifyCmd, 10_000) : execLocal(verifyCmd, 10_000);
      const state = JSON.parse(raw);
      if (!["running", "exited", "created", "restarting", "paused", "removing", "dead"].includes(state?.Status)) {
        throw new Error("Unknown container state");
      }
      status = state.Status;
      health = state.Health == null ? "absent"
        : ["healthy", "starting", "unhealthy"].includes(state.Health.Status) ? state.Health.Status : "unknown";
    } catch (error) {
      readbackError = safeErrorMessage(error, "Container readback unavailable or invalid");
    }
    const expected = action === "stop" ? "exited" : "running";
    const verified = !readbackError && status === expected;
    const outcome = verified ? "verified" : readbackError ? "unverified" : "failed";
    const healthMessage = health === "absent" ? "no health check configured; application readiness unverified"
      : health === "healthy" ? "Docker health check healthy"
      : health === "starting" ? "health check starting; application not ready yet"
      : health === "unhealthy" ? "health check unhealthy"
      : "application health unknown";
    const output = `Expected state: ${expected}; observed: ${status}; ${healthMessage}${readbackError ? `; ${readbackError}` : ""}`;
    const message = `Container ${action} command completed; ${verified ? `${status} confirmed${action === "stop" ? "" : `; ${healthMessage}`}` : outcome === "failed" ? `expected ${expected}, observed ${status}` : "result unverified — readback unavailable or unknown"}`;
    await auditLog({ action: `container_${action}` as "container_start" | "container_stop" | "container_restart", userId: session.sub, username: session.username, ip: getClientIp(request), target: id, details: JSON.stringify({ containerId, action, commandOutput, expected, status, verified, outcome, health, output }) });
    return NextResponse.json({
      success: true,
      data: operationResult({ message, risk: "danger", verified, outcome, health, output }),
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
