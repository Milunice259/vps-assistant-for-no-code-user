/**
 * API: /api/servers/[id]/cron
 * List, create, and delete cron jobs on a server.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { execOnHost } from "@/lib/local-server";
import SSH2Promise from "ssh2-promise";

type RouteContext = { params: Promise<{ id: string }> };

// ── GET — List current crontab entries ──
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const output = await execCron(serverId, "crontab -l 2>/dev/null || echo ''");

    const jobs = parseCrontab(output);
    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to list cron jobs";
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

    // Validate schedule format (5 fields)
    if (!/^(\S+\s+){4}\S+$/.test(schedule.trim())) {
      return NextResponse.json(
        { success: false, error: "Invalid cron schedule (expected 5 fields)" },
        { status: 400 }
      );
    }

    // Sanitize command — prevent injection
    const safeCommand = command.replace(/[`]/g, "");

    // Add to crontab
    const comment = description ? `# ${description}\n` : "";
    const addCmd = `(crontab -l 2>/dev/null; echo '${comment}${schedule} ${safeCommand}') | crontab -`;
    await execCron(serverId, addCmd);

    return NextResponse.json({ success: true, message: "Cron job added" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to add cron job";
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

    if (lineNum < 1) {
      return NextResponse.json(
        { success: false, error: "Valid line number required" },
        { status: 400 }
      );
    }

    // Delete specific line from crontab
    const deleteCmd = `crontab -l 2>/dev/null | sed '${lineNum}d' | crontab -`;
    await execCron(serverId, deleteCmd);

    return NextResponse.json({ success: true, message: "Cron job removed" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to remove cron job";
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
