import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import type { ApiResponse, PackageInfo } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/network/packages - List installed packages via `apt`.
 * Only works on Linux servers with apt package manager.
 */
export async function GET(): Promise<NextResponse<ApiResponse<PackageInfo[]>>> {
  try {
    // ── Environment check ──
    if (os.platform() !== "linux") {
      return NextResponse.json(
        {
          success: false,
          error: "UNSUPPORTED_PLATFORM",
          message:
            "This feature requires a Linux server with APT package manager. " +
            "You are currently running on " +
            os.platform().toUpperCase() +
            ". Package management will work automatically when deployed to your Linux VPS.",
        },
        { status: 422 }
      );
    }

    const raw = execSync("apt list --installed 2>/dev/null | tail -n +2", {
      encoding: "utf-8",
      timeout: 30_000,
    });

    const lines = raw.trim().split("\n").filter(Boolean);

    const packages: PackageInfo[] = lines.map((line) => {
      // Format: "package/source version arch [installed,upgradable to: x.y.z]"
      const match = line.match(
        /^([^\s/]+)\/\S+\s+(\S+)\s+\S+\s*(?:\[([^\]]*)\])?/
      );

      const name = match?.[1] ?? line.split("/")[0] ?? line;
      const version = match?.[2] ?? "unknown";
      const statusPart = match?.[3] ?? "installed";
      const upgradable = statusPart.includes("upgradable");

      // Extract new version if upgradable
      const newVersionMatch = statusPart.match(/upgradable to:\s*(\S+)/);

      return {
        name,
        version,
        status: upgradable ? "upgradable" : "installed",
        upgradable,
        ...(newVersionMatch ? { newVersion: newVersionMatch[1] } : {}),
      } satisfies PackageInfo;
    });

    return NextResponse.json({ success: true, data: packages });
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
 * POST /api/network/packages - Run apt update or upgrade.
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

    // ── Environment check ──
    if (os.platform() !== "linux") {
      return NextResponse.json(
        {
          success: false,
          error: "UNSUPPORTED_PLATFORM",
          message:
            "Package operations require a Linux server with APT. " +
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

    let command: string;

    if (action === "update") {
      command = "apt update 2>&1";
    } else {
      // "upgrade"
      if (packages && packages.length > 0) {
        // Sanitize package names to prevent command injection
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
    }

    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 300_000, // 5 minute timeout for upgrades
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
