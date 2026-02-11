import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/apps/[id]/terminal - Execute a command inside the container.
 * Body: { command: string }
 * Returns: { output: string }
 *
 * Uses `docker exec <container> sh -c "<command>"` via SSH.
 * This is a stateless exec (no persistent shell session).
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

    // Limit command length for safety
    if (command.length > 4096) {
      return NextResponse.json(
        { success: false, error: "Command too long (max 4096 chars)" },
        { status: 400 }
      );
    }

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

    const server = app.server;
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
      const safeId = app.containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
      if (!safeId) {
        return NextResponse.json(
          { success: false, error: "Invalid container ID" },
          { status: 400 }
        );
      }

      // Escape single quotes in the command for shell safety
      const escapedCmd = command.replace(/'/g, "'\\''");

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
