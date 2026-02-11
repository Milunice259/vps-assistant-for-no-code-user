import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalServer, execLocal } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/apps/[id]/terminal - Execute a command inside the container.
 * Body: { command: string }
 * Returns: { output: string }
 *
 * For local containers: uses `execSync("docker exec ...")`.
 * For remote containers: uses SSH.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const command = body.command as string;

    if (!command || typeof command !== "string") {
      return NextResponse.json(
        { success: false, error: "command is required" },
        { status: 400 }
      );
    }

    if (command.length > 4096) {
      return NextResponse.json(
        { success: false, error: "Command too long (max 4096 chars)" },
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

    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!safeId) {
      return NextResponse.json(
        { success: false, error: "Invalid container ID" },
        { status: 400 }
      );
    }

    const escapedCmd = command.replace(/'/g, "'\\''" );

    // Local server — use execLocal
    if (isLocalServer(serverId)) {
      try {
        const output = execLocal(
          `docker exec ${safeId} sh -c '${escapedCmd}' 2>&1`,
          30_000
        );
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
        `docker exec ${safeId} sh -c '${escapedCmd}' 2>&1`,
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
