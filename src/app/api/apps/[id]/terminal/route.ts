import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalServer, execLocal } from "@/lib/local-server";
import { validateTerminalCommand, validateContainerId } from "@/lib/validation";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/apps/[id]/terminal - Execute a command inside the container.
 * Body: { command: string }
 * Returns: { output: string }
 *
 * Commands are validated against an allowlist of safe executables.
 * Dangerous shell metacharacters are rejected.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const command = body.command as string;

    // ── Validate command against allowlist ──
    const cmdCheck = validateTerminalCommand(command);
    if (!cmdCheck.valid) {
      return NextResponse.json(
        { success: false, error: cmdCheck.reason },
        { status: 400 }
      );
    }

    // Resolve container ID and server ID
    let serverId: string;
    let containerId: string;

    if (id.startsWith("local::") || id.startsWith("discovered::local::")) {
      // Local discovered container
      serverId = "local";
      containerId = id.startsWith("discovered::local::")
        ? id.split("::")[2] || ""
        : id.replace("local::", "");
    } else {
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
      if (!app.containerId) {
        return NextResponse.json(
          { success: false, error: "No container ID associated with this app" },
          { status: 400 }
        );
      }
      serverId = app.serverId;
      containerId = app.containerId;
    }

    // ── Validate container ID ──
    const idCheck = validateContainerId(containerId);
    if (!idCheck.valid) {
      return NextResponse.json(
        { success: false, error: "Invalid container ID" },
        { status: 400 }
      );
    }

    const safeId = containerId;

    // Split command into executable + args for docker exec
    const cmdParts = command.trim().split(/\s+/);
    const executable = cmdParts[0];
    const args = cmdParts.slice(1);

    // Build docker exec with explicit args (no sh -c)
    const dockerCmd = ["docker", "exec", safeId, executable, ...args].join(" ");

    // Local server — use execLocal
    if (isLocalServer(serverId)) {
      try {
        const output = execLocal(`${dockerCmd} 2>&1`, 30_000);
        return NextResponse.json({ success: true, data: { output: output || "" } });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Command failed";
        return NextResponse.json({ success: true, data: { output: msg } });
      }
    }

    // Remote server — use SSH
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

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
      const output = await executeCommand(
        ssh,
        `${dockerCmd} 2>&1`,
        30_000
      );

      return NextResponse.json({
        success: true,
        data: { output: output || "" },
      });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command execution failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
