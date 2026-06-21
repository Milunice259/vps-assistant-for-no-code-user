import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { quickAction, closeSSH } from "@/lib/ssh";
import { isLocalServer, localQuickAction } from "@/lib/local-server";
import { auditLog, getClientIp } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ACTIONS = [
  // Maintenance
  "system-health-check",
  "security-check",
  "sync-time",
  "os-version-check",
  // Update
  "os-update",
  // Diagnostics
  "docker-stats",
  "connection-stats",
  // Cleanup
  "docker-prune",
  "clear-apt-cache",
  "clear-logs",
  "clear-temp",
  "remove-old-kernels",
  // System
  "restart-docker",
  "restart-server",
  // Security
  "firewall-reload",
  "unban-all",
  "ban-ip",
  "unban-ip",
  // Legacy (backend-only, used by other features)
  "check-disk",
  "check-uptime",
  "check-memory",
  "check-connections",
  "check-docker-version",
] as const;

/** Actions that accept a `param` field (e.g. an IP address). */
const PARAM_ACTIONS = new Set(["ban-ip", "unban-ip"]);

/** Validate IPv4/IPv6 address. */
function isValidIP(ip: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split(".").every((n) => Number(n) >= 0 && Number(n) <= 255);
  }
  // IPv6 (simplified check)
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":")) return true;
  return false;
}

/**
 * POST /api/servers/[id]/actions - Run a quick maintenance action.
 * Body: { action: "system-health-check" | "docker-prune" | ..., param?: string }
 *
 * For local server: uses execLocal() directly.
 * For remote servers: uses SSH.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<
    ReturnType<typeof import("@/lib/ssh").createSSHConnection>
  > | null = null;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { action, param } = body as { action?: string; param?: string };

    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate param for actions that require it
    if (PARAM_ACTIONS.has(action)) {
      if (!param || !isValidIP(param)) {
        return NextResponse.json(
          { success: false, error: "A valid IP address is required for this action" },
          { status: 400 },
        );
      }
    }

    // Local server — execute directly
    if (isLocalServer(id)) {
      const result = localQuickAction(action, param);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.output },
          { status: 500 },
        );
      }
      const session = await getSession();
      await auditLog({
        action: "quick_action",
        userId: session?.sub as string | undefined,
        username: session?.username as string | undefined,
        target: id,
        details: param ? `${action}: ${param}` : action,
        ip: getClientIp(request),
      });
      return NextResponse.json({
        success: true,
        data: { output: result.output },
      });
    }

    // Remote server — use SSH
    const result = await connectToServer(id);
    ssh = result.ssh;

    const actionResult = await quickAction(ssh, action, param);

    if (!actionResult.success) {
      return NextResponse.json(
        { success: false, error: actionResult.output },
        { status: 500 },
      );
    }

    const session = await getSession();
    await auditLog({
      action: "quick_action",
      userId: session?.sub as string | undefined,
      username: session?.username as string | undefined,
      target: id,
      details: param ? `${action}: ${param}` : action,
      ip: getClientIp(request),
    });
    return NextResponse.json({
      success: true,
      data: { output: actionResult.output },
    });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: "Server is offline or unreachable",
          code: "DISCONNECTED",
        },
        { status: 503 },
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
