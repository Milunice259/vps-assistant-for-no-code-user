import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import type { ApiResponse, PortInfo } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/network/ports - List listening ports on the host using `ss`.
 * Only works on Linux servers.
 */
export async function GET(): Promise<NextResponse<ApiResponse<PortInfo[]>>> {
  try {
    // ── Environment check ──
    if (os.platform() !== "linux") {
      return NextResponse.json(
        {
          success: false,
          error: "UNSUPPORTED_PLATFORM",
          message:
            "This feature requires a Linux server. " +
            "You are currently running on " +
            os.platform().toUpperCase() +
            ". Port scanning will work automatically when deployed to your Linux VPS.",
        },
        { status: 422 }
      );
    }

    let raw: string;
    try {
      raw = execSync("ss -tulnp 2>/dev/null", {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024, // 5 MB
      });
    } catch (execErr) {
      const msg =
        execErr instanceof Error ? execErr.message : "Command failed";
      const notFound =
        typeof msg === "string" &&
        (msg.includes("ENOENT") || msg.includes("not found") || msg.includes("ss"));
      return NextResponse.json(
        {
          success: false,
          error: "COMMAND_FAILED",
          message: notFound
            ? "Port listing requires 'ss' (Linux). Not available in this environment."
            : "Could not list ports. " + msg,
        },
        { status: 200 }
      );
    }

    const lines = raw.trim().split("\n");
    // Skip header line
    const dataLines = lines.slice(1);

    const ports: PortInfo[] = dataLines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        // ss output: State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
        // Index:     0      1       2       3                   4                   5+

        if (parts.length < 5) return null;

        const protocol = parts[0] ?? "unknown";
        const localFull = parts[3] ?? "";
        const peerFull = parts[4] ?? "";
        const processInfo = parts.slice(5).join(" ") || "";

        // Parse local address:port (handle IPv6 brackets)
        const localMatch = localFull.match(/^(.+):(\d+)$/);
        const localAddress = localMatch?.[1] ?? localFull;
        const localPort = parseInt(localMatch?.[2] ?? "0", 10);

        // Parse peer address:port
        const peerMatch = peerFull.match(/^(.+):(\d+)$/);
        const foreignAddress = peerMatch?.[1] ?? peerFull;
        const foreignPort = parseInt(peerMatch?.[2] ?? "0", 10);

        // Extract process name from e.g. users:(("sshd",pid=1234,fd=3))
        const procMatch = processInfo.match(/\("([^"]+)"/);
        const processName = procMatch?.[1] ?? (processInfo || "-");

        return {
          protocol,
          localAddress,
          localPort,
          foreignAddress,
          foreignPort,
          state: "LISTEN",
          process: processName,
        } satisfies PortInfo;
      })
      .filter((p): p is PortInfo => p !== null);

    return NextResponse.json({ success: true, data: ports });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list ports";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
