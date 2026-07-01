import { NextRequest, NextResponse } from "next/server";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execLocal, isLocalServer } from "@/lib/local-server";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import type { ApiResponse, PackageInfo } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Runner = (cmd: string, timeoutMs?: number) => Promise<string>;

type PackagePayload = ApiResponse<PackageInfo[]> & { packageManager?: string };

async function detectPackageManager(run: Runner) {
  const raw = await run("if [ -x /usr/bin/apt-get ] || [ -x /usr/bin/apt ]; then echo apt; elif [ -x /sbin/apk ] || [ -x /usr/bin/apk ]; then echo apk; else echo none; fi", 10_000);
  const manager = raw.trim();
  return manager === "apt" || manager === "apk" ? manager : null;
}

function parseAptInstalled(raw: string): PackageInfo[] {
  return raw.trim().split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^([^\s/]+)\/\S+\s+(\S+)\s+\S+\s*(?:\[([^\]]*)\])?/);
    const name = match?.[1] ?? line.split("/")[0] ?? line;
    const version = match?.[2] ?? "unknown";
    const statusPart = match?.[3] ?? "installed";
    const upgradable = statusPart.includes("upgradable");
    const newVersionMatch = statusPart.match(/upgradable to:\s*(\S+)/);
    return { name, version, status: upgradable ? "upgradable" : "installed", upgradable, ...(newVersionMatch ? { newVersion: newVersionMatch[1] } : {}) };
  });
}

function parseApkInstalled(raw: string): PackageInfo[] {
  return raw.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    const nv = parts[0] ?? line;
    const lastDash = nv.lastIndexOf("-");
    return { name: lastDash > 0 ? nv.substring(0, lastDash) : nv, version: lastDash > 0 ? nv.substring(lastDash + 1) : "unknown", status: "installed", upgradable: false };
  });
}

function mergeAptUpgradable(packages: PackageInfo[], raw: string): PackageInfo[] {
  const upgradableMap = new Map<string, string>();
  for (const line of raw.trim().split("\n")) {
    if (!line.trim() || line.startsWith("Listing")) continue;
    const match = line.match(/^([^\s/]+)\/\S+\s+(\S+)/);
    if (match) upgradableMap.set(match[1], match[2]);
  }
  return packages.map((pkg) => upgradableMap.has(pkg.name) ? { ...pkg, upgradable: true, status: "upgradable", newVersion: upgradableMap.get(pkg.name) } : pkg);
}

async function withRunner<T>(id: string, fn: (run: Runner) => Promise<T>) {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
  try {
    if (isLocalServer(id)) return await fn(async (cmd, timeout) => execLocal(cmd, timeout));
    const connection = await connectToServer(id);
    ssh = connection.ssh;
    return await fn((cmd, timeout) => executeCommand(connection.ssh, cmd, timeout));
  } finally {
    await closeSSH(ssh);
  }
}

async function authorize(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
    return { error: NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse<PackagePayload>> {
  try {
    const { id } = await context.params;
    const auth = await authorize(id);
    if (auth.error) return auth.error;

    return await withRunner(id, async (run) => {
      const manager = await detectPackageManager(run);
      if (!manager) return NextResponse.json({ success: true, data: [], packageManager: "none" });
      const raw = await run(manager === "apt" ? "apt list --installed 2>/dev/null | tail -n +2" : "apk list --installed 2>/dev/null", 120_000);
      let packages = manager === "apt" ? parseAptInstalled(raw) : parseApkInstalled(raw);
      if (request.nextUrl.searchParams.get("check") === "1" && manager === "apt") {
        try { await run("apt-get update -qq", 180_000); } catch { /* keep stale list */ }
        try { packages = mergeAptUpgradable(packages, await run("apt list --upgradable 2>/dev/null | tail -n +2", 60_000)); } catch { /* keep installed list */ }
      }
      return NextResponse.json({ success: true, data: packages, packageManager: manager });
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to list packages" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<{ logs: string }>>> {
  try {
    const { id } = await context.params;
    const auth = await authorize(id);
    if (auth.error) return auth.error;
    const { action, packages } = (await request.json()) as { action?: "update" | "upgrade"; packages?: string[] };
    if (!action || !["update", "upgrade"].includes(action)) return NextResponse.json({ success: false, error: 'action must be "update" or "upgrade"' }, { status: 400 });

    return await withRunner(id, async (run) => {
      const manager = await detectPackageManager(run);
      if (!manager) return NextResponse.json({ success: false, error: "No supported package manager found (apt or apk)." }, { status: 422 });
      const safePackages = (packages || []).map((p) => p.replace(/[^a-zA-Z0-9._:+-]/g, "")).filter(Boolean);
      const command = manager === "apt"
        ? action === "update" ? "apt-get update 2>&1" : safePackages.length ? `DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y ${safePackages.join(" ")} 2>&1` : "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1"
        : action === "update" ? "apk update 2>&1" : safePackages.length ? `apk upgrade ${safePackages.join(" ")} 2>&1` : "apk upgrade 2>&1";
      return NextResponse.json({ success: true, data: { logs: await run(command, 300_000) } });
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Package operation failed" }, { status: 500 });
  }
}
