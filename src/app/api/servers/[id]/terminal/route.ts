/**
 * API: /api/servers/[id]/terminal
 * Execute individual commands on a server (stateless).
 *
 * Security: Uses allowlist-based validateTerminalCommand() to restrict
 * which executables can be run. Only whitelisted commands are permitted.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { execOnHost } from "@/lib/local-server";
import { validateTerminalCommand } from "@/lib/validation";
import { auditLog, getClientIp } from "@/lib/audit";
import SSH2Promise from "ssh2-promise";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_OUTPUT_BYTES = 1_000_000; // 1MB max output

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const body = await request.json();
    const { command } = body as { command: string };

    if (!command?.trim()) {
      return NextResponse.json(
        { success: false, error: "Command is required" },
        { status: 400 }
      );
    }

    // ── Validate command against allowlist ──
    const cmdCheck = validateTerminalCommand(command);
    if (!cmdCheck.valid) {
      return NextResponse.json({
        success: true,
        data: {
          output: `\x1b[31mBlocked: ${cmdCheck.reason}\x1b[0m\n`,
          exitCode: 1,
        },
      });
    }

    let output: string;
    let exitCode = 0;

    try {
      if (serverId === "local") {
        output = await execOnHost(command, 30_000);
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
          readyTimeout: 10_000,
        };

        if (server.encryptedKey) {
          sshConfig.privateKey = decrypt(server.encryptedKey);
        } else if (server.encryptedPass) {
          sshConfig.password = decrypt(server.encryptedPass);
        }

        const ssh = new SSH2Promise(sshConfig);
        try {
          await ssh.connect();
          output = await ssh.exec(command);
        } finally {
          ssh.close();
        }
      }
    } catch (execError) {
      output = execError instanceof Error ? execError.message : String(execError);
      exitCode = 1;
    }

    // Truncate excessive output
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES) + "\n... (output truncated)";
    }

    // Audit log the command execution (fire-and-forget)
    auditLog({
      action: "quick_action",
      target: serverId,
      details: `Terminal: ${command.slice(0, 200)}`,
      ip: getClientIp(request),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { output, exitCode },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Command execution failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
