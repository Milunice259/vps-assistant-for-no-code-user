import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { canAccessHost, execOnHost } from "@/lib/local-server";
import type { ApiResponse, PackageInfo } from "@/types";

export const dynamic = "force-dynamic";

type PkgMgr = "apt" | "apk";

/* ── Detect package manager ── */

function detectPackageManager(): PkgMgr | null {
  // Try host first via nsenter
  if (canAccessHost()) {
    try {
      execOnHost("which apt 2>/dev/null", 5_000);
      return "apt";
    } catch { /* not apt */ }
    try {
      execOnHost("which apk 2>/dev/null", 5_000);
      return "apk";
    } catch { /* not apk */ }
  }

  // Fallback: check inside the container
  try {
    execSync("which apt 2>/dev/null", { encoding: "utf-8", timeout: 3_000 });
    return "apt";
  } catch { /* */ }
  try {
    execSync("which apk 2>/dev/null", { encoding: "utf-8", timeout: 3_000 });
    return "apk";
  } catch { /* */ }

  return null;
}

/** Run a command adaptively: host (nsenter) first, then container. */
function runCmd(cmd: string, timeout = 30_000): string {
  if (canAccessHost()) {
    try {
      return execOnHost(cmd, timeout);
    } catch { /* fall through */ }
  }
  return execSync(cmd, {
    encoding: "utf-8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/* ── Parsers ── */

function parseAptInstalled(raw: string): PackageInfo[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^([^\s/]+)\/\S+\s+(\S+)\s+\S+\s*(?:\[([^\]]*)\])?/
      );
      const name = match?.[1] ?? line.split("/")[0] ?? line;
      const version = match?.[2] ?? "unknown";
      const statusPart = match?.[3] ?? "installed";
      const upgradable = statusPart.includes("upgradable");
      const newVersionMatch = statusPart.match(/upgradable to:\s*(\S+)/);

      return {
        name,
        version,
        status: upgradable ? "upgradable" : "installed",
        upgradable,
        ...(newVersionMatch ? { newVersion: newVersionMatch[1] } : {}),
      } satisfies PackageInfo;
    });
}

function parseApkInstalled(raw: string): PackageInfo[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(.+?)-(\d[\w.]*(?:-r\d+)?)\s+\S+\s+\{.*?\}\s+\(.*?\)\s+\[(.+?)\]/
      );
      if (match) {
        const upgradable = (match[3] ?? "").includes("upgradable");
        return {
          name: match[1],
          version: match[2],
          status: upgradable ? "upgradable" : "installed",
          upgradable,
        } satisfies PackageInfo;
      }
      // Fallback
      const parts = line.split(/\s+/);
      const nv = parts[0] ?? line;
      const lastDash = nv.lastIndexOf("-");
      return {
        name: lastDash > 0 ? nv.substring(0, lastDash) : nv,
        version: lastDash > 0 ? nv.substring(lastDash + 1) : "unknown",
        status: "installed",
        upgradable: false,
      } satisfies PackageInfo;
    });
}

/** Parse `apt list --upgradable` and merge into an existing package list. */
function mergeAptUpgradable(packages: PackageInfo[], raw: string): PackageInfo[] {
  const upgradableMap = new Map<string, string>();
  for (const line of raw.trim().split("\n")) {
    if (!line.trim() || line.startsWith("Listing")) continue;
    // Format: "pkg/source newVer arch [upgradable from: oldVer]"
    const match = line.match(/^([^\s/]+)\/\S+\s+(\S+)/);
    if (match) {
      upgradableMap.set(match[1], match[2]);
    }
  }

  if (upgradableMap.size === 0) return packages;

  return packages.map((pkg) => {
    const newVer = upgradableMap.get(pkg.name);
    if (newVer) {
      return { ...pkg, upgradable: true, status: "upgradable", newVersion: newVer };
    }
    return pkg;
  });
}

/** Parse `apk version -l '<'` and merge into package list. */
function mergeApkUpgradable(packages: PackageInfo[], raw: string): PackageInfo[] {
  const upgradableSet = new Set<string>();
  for (const line of raw.trim().split("\n")) {
    // Format: "pkg-oldVer < newVer"
    const match = line.match(/^(.+?)-\d[\w.]*(?:-r\d+)?\s+</);
    if (match) upgradableSet.add(match[1]);
  }

  if (upgradableSet.size === 0) return packages;

  return packages.map((pkg) => {
    if (upgradableSet.has(pkg.name)) {
      return { ...pkg, upgradable: true, status: "upgradable" };
    }
    return pkg;
  });
}

/* ══════════════════════════════════════════════════════════════
   GET /api/network/packages — List installed packages + check upgrades.
   Query param: ?check=1 — also check for upgradable packages.
   ══════════════════════════════════════════════════════════════ */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PackageInfo[]>>> {
  try {
    const pkgMgr = detectPackageManager();

    if (!pkgMgr) {
      // No package manager available — return empty list gracefully
      return NextResponse.json({
        success: true,
        data: [],
        packageManager: "none",
      } as ApiResponse<PackageInfo[]> & { packageManager: string });
    }

    // ── List installed packages ──
    const listCmd =
      pkgMgr === "apt"
        ? "apt list --installed 2>/dev/null | tail -n +2"
        : "apk list --installed 2>/dev/null";

    const raw = runCmd(listCmd);
    let packages =
      pkgMgr === "apt" ? parseAptInstalled(raw) : parseApkInstalled(raw);

    // ── Check for upgradable packages if requested ──
    const checkUpgrades = request.nextUrl.searchParams.get("check") === "1";
    if (checkUpgrades) {
      try {
        if (pkgMgr === "apt") {
          // apt update first to refresh index, then list upgradable
          try { runCmd("apt update -qq 2>/dev/null", 120_000); } catch { /* ok */ }
          const upgRaw = runCmd("apt list --upgradable 2>/dev/null | tail -n +2");
          packages = mergeAptUpgradable(packages, upgRaw);
        } else {
          // apk update + check
          try { runCmd("apk update -q 2>/dev/null", 60_000); } catch { /* ok */ }
          const upgRaw = runCmd("apk version -l '<' 2>/dev/null");
          packages = mergeApkUpgradable(packages, upgRaw);
        }
      } catch {
        // Upgrade check failed — return packages without upgrade info
      }
    }

    return NextResponse.json({
      success: true,
      data: packages,
      packageManager: pkgMgr,
    } as ApiResponse<PackageInfo[]> & { packageManager: string });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list packages";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/* ══════════════════════════════════════════════════════════════
   POST /api/network/packages — Run package operations.
   Body: { action: "update" | "upgrade", packages?: string[] }
   - action "update": refresh package index
   - action "upgrade" + no packages: upgrade ALL upgradable
   - action "upgrade" + packages[]: upgrade specific packages
   ══════════════════════════════════════════════════════════════ */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ logs: string; upgradedCount?: number }>>> {
  try {
    const body = (await request.json()) as {
      action: "update" | "upgrade";
      packages?: string[];
    };

    const { action, packages } = body;

    if (!action || !["update", "upgrade"].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'action must be "update" or "upgrade"' },
        { status: 400 }
      );
    }

    const pkgMgr = detectPackageManager();

    if (!pkgMgr) {
      return NextResponse.json(
        {
          success: false,
          error: "No supported package manager found (apt or apk).",
        },
        { status: 422 }
      );
    }

    let command: string;

    if (pkgMgr === "apt") {
      if (action === "update") {
        command = "apt update 2>&1";
      } else if (packages && packages.length > 0) {
        const safePackages = packages
          .map((p) => p.replace(/[^a-zA-Z0-9._:+-]/g, ""))
          .filter(Boolean);
        if (safePackages.length === 0) {
          return NextResponse.json(
            { success: false, error: "No valid package names provided" },
            { status: 400 }
          );
        }
        command = `DEBIAN_FRONTEND=noninteractive apt install -y ${safePackages.join(" ")} 2>&1`;
      } else {
        command = "DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1";
      }
    } else {
      // apk
      if (action === "update") {
        command = "apk update 2>&1";
      } else if (packages && packages.length > 0) {
        const safePackages = packages
          .map((p) => p.replace(/[^a-zA-Z0-9._:+-]/g, ""))
          .filter(Boolean);
        if (safePackages.length === 0) {
          return NextResponse.json(
            { success: false, error: "No valid package names provided" },
            { status: 400 }
          );
        }
        command = `apk add ${safePackages.join(" ")} 2>&1`;
      } else {
        command = "apk upgrade 2>&1";
      }
    }

    const output = runCmd(command, 300_000);

    // Count upgraded packages from output
    let upgradedCount = 0;
    if (action === "upgrade") {
      if (pkgMgr === "apt") {
        const match = output.match(/(\d+) upgraded/);
        upgradedCount = match ? parseInt(match[1], 10) : 0;
      } else {
        const lines = output.split("\n").filter((l) => l.includes("Upgrading") || l.includes("Installing"));
        upgradedCount = lines.length;
      }
    }

    return NextResponse.json({
      success: true,
      data: { logs: output, upgradedCount },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Package operation failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
