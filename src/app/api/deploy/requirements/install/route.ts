import { execFileSync } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import type { ApiResponse } from "@/types";

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
    const body = await request.json() as { packageId?: PackageId; serverId?: string };
    const item = body.packageId ? packages[body.packageId] : null;
    if (!item) return NextResponse.json({ success: false, error: "Unsupported package" }, { status: 400 });

    const command = `sudo sh -lc '${item.command.replace(/'/g, "'\\''")}'`;
    const output = body.serverId
      ? await (async () => {
          const conn = await connectToServer(body.serverId as string);
          ssh = conn.ssh;
          return executeCommand(ssh, command, 120_000);
        })()
      : runLocal(command);

    await prisma.auditLog.create({
      data: {
        action: "deploy_requirement_install",
        username: "system",
        target: body.serverId || "local",
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
