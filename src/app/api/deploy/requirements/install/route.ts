import { execFileSync } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { requireSafeModeOff } from "@/lib/operation-safety";
import type { ApiResponse } from "@/types";

import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAccessServer } from "@/lib/server-access";

export const dynamic = "force-dynamic";

type PackageId = "git" | "docker-compose-plugin";

const packages: Record<PackageId, { label: string; command: string }> = {
  git: { label: "Git", command: "apt-get update && apt-get install -y git" },
  "docker-compose-plugin": { label: "Docker Compose", command: "apt-get update && apt-get install -y docker-compose-plugin" },
};

function runLocal(command: string) {
  return execFileSync("sh", ["-lc", command], { encoding: "utf8", timeout: 120_000 }).trim();
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!can(session.role as string, "OPERATOR")) return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    const body = await request.json() as { packageId?: PackageId; serverId?: string; safeModeOff?: boolean };
    const targetId = body.serverId ?? "local";
    if (typeof targetId !== "string" || !targetId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, targetId))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    const item = body.packageId ? packages[body.packageId] : null;
    if (!item) return NextResponse.json({ success: false, error: "Unsupported package" }, { status: 400 });
    const safetyBlock = requireSafeModeOff("deploy_requirement_install", body);
    if (safetyBlock) return safetyBlock;

    const command = `sudo sh -lc '${item.command.replace(/'/g, "'\\''")}'`;
    const output = targetId !== "local"
      ? await (async () => {
          const conn = await connectToServer(targetId);
          ssh = conn.ssh;
          return executeCommand(ssh, command, 120_000);
        })()
      : runLocal(command);

    await prisma.auditLog.create({
      data: {
        action: "deploy_requirement_install",
        userId: session.sub as string,
        username: session.username as string,
        target: targetId,
        details: JSON.stringify({ packageId: body.packageId, label: item.label }),
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { output: output.slice(-4000) || `${item.label} installed.` } });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json({ success: false, error: "Server is offline or unreachable" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Package install failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
