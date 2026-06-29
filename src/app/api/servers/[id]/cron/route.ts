/**
 * API: /api/servers/[id]/cron
 * List, create, and delete cron jobs on a server.
 */

import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { execOnHost } from "@/lib/local-server";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import SSH2Promise from "ssh2-promise";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Escape a string for safe embedding in a single-quoted shell argument.
 * 'hello' → 'hello'    (no change)
 * "it's"  → "it'\''s"  (break out, add escaped quote, re-enter)
 */
function shellEscapeSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// ── GET — List current crontab entries ──
export async function GET(
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
    const output = await execCron(serverId, "crontab -l 2>/dev/null || echo ''");

    const jobs = parseCrontab(output);
    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to list cron jobs");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST — Add a new cron job ──
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const body = await request.json();
    const { schedule, command, description } = body as {
      schedule: string;
      command: string;
      description?: string;
    };

    if (!schedule || !command) {
      return NextResponse.json(
        { success: false, error: "schedule and command are required" },
        { status: 400 }
      );
    }

    // Validate schedule format (5 fields, no shell metacharacters)
    const trimmedSchedule = schedule.trim();
    if (!/^(\S+\s+){4}\S+$/.test(trimmedSchedule)) {
      return NextResponse.json(
        { success: false, error: "Invalid cron schedule (expected 5 fields)" },
        { status: 400 }
      );
    }

    // Reject shell metacharacters in schedule fields
    if (/[`$(){}|;&'"\\]/.test(trimmedSchedule)) {
      return NextResponse.json(
        { success: false, error: "Invalid characters in cron schedule" },
        { status: 400 }
      );
    }

    // Sanitize command — escape single quotes to prevent shell injection
    const safeCommand = shellEscapeSingleQuote(command);

    // Build the crontab entry as a safely-quoted string
    const comment = description ? `# ${shellEscapeSingleQuote(description)}\n` : "";
    const cronLine = `${trimmedSchedule} ${safeCommand}`;
    const addCmd = `(crontab -l 2>/dev/null; echo '${comment}${cronLine}') | crontab -`;
    await execCron(serverId, addCmd);

    // Audit log
    auditLog({
      action: "quick_action",
      target: serverId,
      details: `Cron add: ${trimmedSchedule} ${command.slice(0, 100)}`,
      ip: getClientIp(request),
    }).catch(() => {});

    return NextResponse.json({ success: true, message: "Cron job added" });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to add cron job");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── DELETE — Remove a cron job by line number ──
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const { searchParams } = new URL(request.url);
    const lineNum = parseInt(searchParams.get("line") || "0");

    if (lineNum < 1 || lineNum > 9999) {
      return NextResponse.json(
        { success: false, error: "Valid line number required" },
        { status: 400 }
      );
    }

    // Delete specific line from crontab
    const deleteCmd = `crontab -l 2>/dev/null | sed '${lineNum}d' | crontab -`;
    await execCron(serverId, deleteCmd);

    // Audit log
    auditLog({
      action: "quick_action",
      target: serverId,
      details: `Cron delete: line ${lineNum}`,
      ip: getClientIp(request),
    }).catch(() => {});

    return NextResponse.json({ success: true, message: "Cron job removed" });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to remove cron job");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── Helpers ──

interface CronJob {
  line: number;
  schedule: string;
  command: string;
  comment: string | null;
  raw: string;
}

function parseCrontab(output: string): CronJob[] {
  const lines = output.split("\n").filter(Boolean);
  const jobs: CronJob[] = [];
  let pendingComment: string | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) return;

    if (trimmed.startsWith("#")) {
      pendingComment = trimmed.replace(/^#\s*/, "");
      return;
    }

    const match = trimmed.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
    if (match) {
      jobs.push({
        line: index + 1,
        schedule: match[1],
        command: match[2],
        comment: pendingComment,
        raw: trimmed,
      });
      pendingComment = null;
    }
  });

  return jobs;
}

async function execCron(serverId: string, cmd: string): Promise<string> {
  if (serverId === "local") {
    return execOnHost(cmd);
  }

  const server = await prisma.server.findUnique({
    where: { id: serverId },
  });

  if (!server) throw new Error("Server not found");

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
    return await ssh.exec(cmd);
  } finally {
    ssh.close();
  }
}
