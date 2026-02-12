import { NextRequest, NextResponse } from "next/server";
import { execOnHost } from "@/lib/local-server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { safeErrorMessage } from "@/lib/safe-error";
import SSH2Promise from "ssh2-promise";

const ALLOWED_ACTIONS = ["start", "stop", "restart"] as const;
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
    const body = await request.json();
    const { service, action } = body as { service: string; action: string };

    // Validate action
    if (!ALLOWED_ACTIONS.includes(action as ServiceAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}` },
        { status: 400 }
      );
    }

    // Validate service name — alphanumeric, dashes, dots, underscores, @
    if (!service || !/^[a-zA-Z0-9._@-]+$/.test(service)) {
      return NextResponse.json(
        { success: false, error: "Invalid service name" },
        { status: 400 }
      );
    }

    const cmd = `systemctl ${action} ${service}`;

    if (serverId === "local") {
      await execOnHost(cmd);
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
        await ssh.exec(cmd);
      } finally {
        ssh.close();
      }
    }

    return NextResponse.json({
      success: true,
      message: `Service "${service}" ${action}ed successfully`,
    });
  } catch (err) {
    const message = safeErrorMessage(err, "Failed to execute service action");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
