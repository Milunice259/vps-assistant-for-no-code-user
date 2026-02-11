import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getRemoteServices, closeSSH } from "@/lib/ssh";
import { isLocalServer, getLocalServices } from "@/lib/local-server";
import type { ApiResponse, ServiceInfo } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/[id]/services - List systemd services.
 * For local server: uses execSync.
 * For remote servers: uses SSH.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ServiceInfo[]>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    // Local server — use local systemctl
    if (isLocalServer(id)) {
      const services = getLocalServices();
      const data: ServiceInfo[] = services.map((s) => ({
        name: s.name,
        loadState: s.loadState,
        activeState: s.activeState,
        subState: s.subState,
        description: s.description,
      }));
      return NextResponse.json({ success: true, data });
    }

    const result = await connectToServer(id);
    ssh = result.ssh;

    const services = await getRemoteServices(ssh);

    const data: ServiceInfo[] = services.map((s) => ({
      name: s.name,
      loadState: s.loadState,
      activeState: s.activeState,
      subState: s.subState,
      description: s.description,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
        { status: 503 }
      );
    }

    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 500;
    const message = err.message || "Failed to fetch services";
    return NextResponse.json({ success: false, error: message }, { status });
  } finally {
    await closeSSH(ssh);
  }
}

