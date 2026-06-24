import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getRemoteStats, getRemoteOSDetails, closeSSH } from "@/lib/ssh";
import { isLocalServer } from "@/lib/local-server";
import { getHostStats } from "@/lib/stats";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/[id]/stats - Fetch live system stats.
 * For local server: uses Node.js os module.
 * For remote servers: uses SSH.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    // Local server — use Node.js os module directly
    if (isLocalServer(id)) {
      const stats = getHostStats();
      return NextResponse.json({ success: true, data: { ...stats, os: { distro: stats.platform, kernel: "", arch: process.arch } } });
    }


    const result = await connectToServer(id);
    ssh = result.ssh;

    // Fetch stats and OS details in parallel
    const [stats, osDetails] = await Promise.all([
      getRemoteStats(ssh),
      getRemoteOSDetails(ssh),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ...stats,
        os: osDetails,
      },
    });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
        { status: 503 }
      );
    }

    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 500;
    const message = err.message || "Failed to fetch remote stats";
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  } finally {
    await closeSSH(ssh);
  }
}

