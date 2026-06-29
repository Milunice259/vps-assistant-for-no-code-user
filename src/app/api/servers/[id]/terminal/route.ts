/**
 * API: /api/servers/[id]/terminal
 * Execute individual commands on a server (stateless).
 *
 * Security: Uses allowlist-based validateTerminalCommand() to restrict
 * which executables can be run. Only whitelisted commands are permitted.
 */

import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { execOnHost } from "@/lib/local-server";
import { validateTerminalCommand } from "@/lib/validation";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import SSH2Promise from "ssh2-promise";

type RouteContext = { params: Promise<{ id: string }> };

// ── Rate limiter (30 commands per 60s per IP) ──
const rateLimitMap = new Map<string, { count: number; firstAttempt: number }>();
const MAX_CMDS = 30;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return false;
  }
  entry.count++;
  return entry.count > MAX_CMDS;
}

const _termCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.firstAttempt > WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 300_000);
if (typeof _termCleanup === "object" && _termCleanup && "unref" in _termCleanup) {
  (_termCleanup as NodeJS.Timeout).unref();
}

const MAX_OUTPUT_BYTES = 1_000_000; // 1MB max output

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
    const ip = getClientIp(request);

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many commands. Try again later." },
        { status: 429 }
      );
    }

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
      ip,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { output, exitCode },
    });
  } catch (error) {
    const msg = safeErrorMessage(error, "Command execution failed");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
