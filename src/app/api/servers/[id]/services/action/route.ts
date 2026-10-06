import { NextRequest, NextResponse } from "next/server";
import { execOnHost } from "@/lib/local-server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { safeErrorMessage } from "@/lib/safe-error";
import { auditLog, getClientIp } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { operationResult } from "@/lib/operation-result";
import SSH2Promise from "ssh2-promise";

const ALLOWED_ACTIONS = ["start", "stop", "restart", "enable", "disable"] as const;
type ServiceAction = (typeof ALLOWED_ACTIONS)[number];

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/servers/[id]/services/action
 * Start, stop, or restart a systemd service on a server.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, serverId))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const body = await request.json();
    const { service, action } = body as { service: string; action: string; safeModeOff?: boolean };

    // Validate action
    if (!ALLOWED_ACTIONS.includes(action as ServiceAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}` },
        { status: 400 }
      );
    }

    // Validate service name — alphanumeric, dashes, dots, underscores, @
    if (typeof service !== "string" || !/^[a-zA-Z0-9_@][a-zA-Z0-9._@-]*$/.test(service)) {
      return NextResponse.json(
        { success: false, error: "Invalid service name" },
        { status: 400 }
      );
    }

    const safetyBlock = requireSafeModeOff(`service_${action}`, body);
    if (safetyBlock) return safetyBlock;

    const cmd = `systemctl ${action} -- ${service}`;
    const property = action === "enable" || action === "disable" ? "is-enabled" : "is-active";
    const expected = action === "enable" ? "enabled" : action === "disable" ? "disabled" : action === "stop" ? "inactive" : "active";
    const verifyCmd = `systemctl ${property} -- ${service} 2>/dev/null || true`;
    let status = "";
    let readbackError = "";

    if (serverId === "local") {
      await execOnHost(cmd);
      try { status = (await execOnHost(verifyCmd)).trim(); }
      catch (err) { readbackError = safeErrorMessage(err, "Service readback unavailable"); }
    } else {
      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return NextResponse.json(
          { success: false, error: "Server not found" },
          { status: 404 }
        );
      }

      const sshConfig: Record<string, unknown> = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 10000,
      };

      if (server.encryptedKey) {
        sshConfig.privateKey = decrypt(server.encryptedKey);
      } else if (server.encryptedPass) {
        sshConfig.password = decrypt(server.encryptedPass);
      }

      const ssh = new SSH2Promise(sshConfig);
      try {
        await ssh.connect();
        // ssh2-promise ignores remote exit codes; require explicit completion evidence.
        const commandOutput = String(await ssh.exec(`${cmd} 2>&1 && printf '\\n__ACTION_COMPLETED__\\n'`));
        if (!commandOutput.trim().endsWith("__ACTION_COMPLETED__")) throw new Error("Service command did not complete successfully");
        try { status = String(await ssh.exec(verifyCmd)).trim(); }
        catch (err) { readbackError = safeErrorMessage(err, "Service readback unavailable"); }
      } finally {
        try { await ssh.close(); } catch { /* Cleanup must not replace action evidence. */ }
      }
    }

    const verified = !readbackError && status === expected;
    const knownStates = property === "is-enabled"
      ? ["enabled", "enabled-runtime", "linked", "linked-runtime", "alias", "masked", "masked-runtime", "static", "indirect", "disabled", "generated", "transient", "not-found"]
      : ["active", "inactive", "failed", "activating", "deactivating", "reloading", "maintenance", "refreshing"];
    const outcome = verified ? "verified" : !readbackError && knownStates.includes(status) ? "failed" : "unverified";
    const output = `Expected ${property}: ${expected}; observed: ${status || "unknown"}${readbackError ? `; ${readbackError}` : ""}`;
    const ip = getClientIp(request);
    await auditLog({
      action: `service_${action}` as `service_${ServiceAction}`,
      userId: session?.sub as string | undefined,
      username: session?.username as string | undefined,
      target: `${serverId}:${service}`,
      details: JSON.stringify({ service, action, property, expected, status, verified, outcome, output }),
      ip,
    });

    const pastTense: Record<string, string> = { start: "started", stop: "stopped", restart: "restarted", enable: "enabled", disable: "disabled" };
    return NextResponse.json({
      success: true,
      data: operationResult({
        message: verified
          ? `Service "${service}" ${pastTense[action]}; ${property} confirmed ${status}`
          : `Service "${service}" ${action} command completed; ${outcome === "failed" ? `expected ${expected}, observed ${status}` : "result unverified — readback unavailable or unknown"}`,
        risk: "danger",
        verified,
        outcome,
        output,
      }),
    });
  } catch (err) {
    const message = safeErrorMessage(err, "Failed to execute service action");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
