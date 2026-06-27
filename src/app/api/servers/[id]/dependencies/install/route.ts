import { NextRequest, NextResponse } from "next/server";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execLocal, isLocalServer } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const ALLOWED_PACKAGES = ["openssl"] as const;

type InstallResult = { package: string; output: string };
type Runner = (cmd: string, timeoutMs?: number) => Promise<string>;

async function installPackage(run: Runner, pkg: string) {
  const manager = await run("command -v apt >/dev/null 2>&1 && echo apt || command -v apk >/dev/null 2>&1 && echo apk || echo none", 10_000);
  if (manager === "apt") return run(`apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`, 120_000);
  if (manager === "apk") return run(`apk add --no-cache ${pkg}`, 120_000);
  throw new Error("No supported package manager found. Install manually with apt or apk.");
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<InstallResult>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;
    const { package: pkg } = (await request.json()) as { package?: string };

    if (!pkg || !ALLOWED_PACKAGES.includes(pkg as (typeof ALLOWED_PACKAGES)[number])) {
      return NextResponse.json({ success: false, error: "Unsupported package" }, { status: 400 });
    }

    const run: Runner = isLocalServer(id)
      ? async (cmd, timeout) => execLocal(cmd, timeout)
      : async (cmd, timeout) => {
          if (!ssh) ssh = (await connectToServer(id)).ssh;
          return executeCommand(ssh, cmd, timeout);
        };

    const output = await installPackage(run, pkg);
    return NextResponse.json({ success: true, data: { package: pkg, output } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Install failed" },
      { status: 500 },
    );
  } finally {
    await closeSSH(ssh);
  }
}
