import { execFileSync } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type DeployMode = "git" | "image" | "compose";
type Requirement = { name: string; command: string; ok: boolean; detail: string; installCommand?: string; packageId?: "git" | "docker-compose-plugin" };
type RequirementResult = { target: "local" | "remote"; requirements: Requirement[] };

const requirements: Record<DeployMode, Array<Omit<Requirement, "ok" | "detail">>> = {
  git: [
    { name: "Git", command: "git --version", installCommand: "sudo apt-get update && sudo apt-get install -y git", packageId: "git" },
    { name: "Docker", command: "docker info", installCommand: "Open Docs for Docker setup wizard." },
  ],
  image: [{ name: "Docker", command: "docker info", installCommand: "Open Docs for Docker setup wizard." }],
  compose: [
    { name: "Docker", command: "docker info", installCommand: "Open Docs for Docker setup wizard." },
    { name: "Docker Compose", command: "docker compose version", installCommand: "sudo apt-get update && sudo apt-get install -y docker-compose-plugin", packageId: "docker-compose-plugin" },
  ],
};

function runLocal(command: string) {
  try {
    execFileSync("sh", ["-lc", command], { encoding: "utf8", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<RequirementResult>>> {
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;

  try {
    const body = await request.json() as { mode?: DeployMode; serverId?: string };
    const mode = body.mode || "git";
    const target = body.serverId ? "remote" : "local";
    if (!requirements[mode]) {
      return NextResponse.json({ success: false, error: "Invalid deploy mode" }, { status: 400 });
    }

    if (body.serverId) {
      const conn = await connectToServer(body.serverId);
      ssh = conn.ssh;
    }

    const data = await Promise.all(requirements[mode].map(async (item) => {
      const ok = ssh
        ? (await executeCommand(ssh, `${item.command} >/dev/null 2>&1 && echo ok || echo missing`, 10_000)) === "ok"
        : runLocal(item.command);
      return {
        ...item,
        ok,
        detail: ok ? `${item.name} is ready.` : `${item.name} is missing or not running on the target server.`,
      };
    }));

    return NextResponse.json({ success: true, data: { target, requirements: data } });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json({ success: false, error: "Server is offline or unreachable" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Failed to check deploy requirements";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
