import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import type { ApiResponse, PackageInfo } from "@/types";

export const dynamic = "force-dynamic";

type PackageManager = "apt" | "apk";

/**
 * Detect which package manager is available on this system.
 * Returns "apt" (Debian/Ubuntu), "apk" (Alpine), or null.
 */
function detectPackageManager(): PackageManager | null {
  if (os.platform() !== "linux") return null;

  try {
    execSync("which apk 2>/dev/null", { encoding: "utf-8", timeout: 3_000 });
    return "apk";
  } catch {
    // not Alpine
  }

  try {
    execSync("which apt 2>/dev/null", { encoding: "utf-8", timeout: 3_000 });
    return "apt";
  } catch {
    // not Debian/Ubuntu
  }

  return null;
}

/**
 * Parse `apt list --installed` output into PackageInfo[].
 * Format: "package/source version arch [installed,upgradable to: x.y.z]"
 */
function parseAptOutput(raw: string): PackageInfo[] {
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

/**
 * Parse `apk list --installed` output into PackageInfo[].
 * Format: "name-version-rN description"
 * Example: "busybox-1.36.1-r15 x86_64 {busybox} (GPL-2.0-only) [installed]"
 */
function parseApkOutput(raw: string): PackageInfo[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // apk format: "name-version arch {origin} (license) [status]"
      const match = line.match(
        /^(.+?)-(\d[\w.]*(?:-r\d+)?)\s+\S+\s+\{.*?\}\s+\(.*?\)\s+\[(.+?)\]/
      );

      if (match) {
        const name = match[1];
        const version = match[2];
        const statusStr = match[3] ?? "installed";
        const upgradable = statusStr.includes("upgradable");

        return {
          name,
          version,
          status: upgradable ? "upgradable" : "installed",
          upgradable,
        } satisfies PackageInfo;
      }

      // Fallback: simpler parse
      const parts = line.split(/\s+/);
      const nameVersion = parts[0] ?? line;
      const lastDash = nameVersion.lastIndexOf("-");
      const name = lastDash > 0 ? nameVersion.substring(0, lastDash) : nameVersion;
      const version = lastDash > 0 ? nameVersion.substring(lastDash + 1) : "unknown";

      return {
        name,
        version,
        status: "installed" as const,
        upgradable: false,
      } satisfies PackageInfo;
    });
}

/**
 * GET /api/network/packages - List installed packages.
 * Auto-detects apt (Debian/Ubuntu) or apk (Alpine).
 */
export async function GET(): Promise<NextResponse<ApiResponse<PackageInfo[]>>> {
  try {
    // ── Platform check ──
    if (os.platform() !== "linux") {
      return NextResponse.json(
        {
          success: false,
          error: "UNSUPPORTED_PLATFORM",
          message:
            "This feature requires a Linux server with a supported package manager. " +
            "You are currently running on " +
            os.platform().toUpperCase() +
            ". Package management will work automatically when deployed to your Linux VPS.",
        },
        { status: 422 }
      );
    }

    // ── Detect package manager ──
    const pkgMgr = detectPackageManager();

    if (!pkgMgr) {
      return NextResponse.json(
        {
          success: false,
          error: "NO_PACKAGE_MANAGER",
          message:
            "No supported package manager found (apt or apk). " +
            "This feature requires a Linux system with apt (Debian/Ubuntu) or apk (Alpine).",
        },
        { status: 422 }
      );
    }

    // ── List installed packages ──
    const command =
      pkgMgr === "apt"
        ? "apt list --installed 2>/dev/null | tail -n +2"
        : "apk list --installed 2>/dev/null";

    const raw = execSync(command, {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const packages =
      pkgMgr === "apt" ? parseAptOutput(raw) : parseApkOutput(raw);

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

/**
 * POST /api/network/packages - Run package update or upgrade.
 * Auto-detects apt or apk and runs the appropriate command.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ logs: string }>>> {
  try {
    const body = (await request.json()) as {
      action: "update" | "upgrade";
      packages?: string[];
    };

    const { action, packages } = body;

    // ── Platform check ──
    if (os.platform() !== "linux") {
      return NextResponse.json(
        {
          success: false,
          error: "UNSUPPORTED_PLATFORM",
          message:
            "Package operations require a Linux server. " +
            "You are running on " +
            os.platform().toUpperCase() +
            ".",
        },
        { status: 422 }
      );
    }

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
          error: "NO_PACKAGE_MANAGER",
          message: "No apt or apk found on this system.",
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
        command = `apt install -y ${safePackages.join(" ")} 2>&1`;
      } else {
        command = "apt upgrade -y 2>&1";
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

    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
    });

    return NextResponse.json({
      success: true,
      data: { logs: output },
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
