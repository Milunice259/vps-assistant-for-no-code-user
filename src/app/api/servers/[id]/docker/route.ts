import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getRemoteContainers, closeSSH } from "@/lib/ssh";
import { isLocalServer, getLocalContainers } from "@/lib/local-server";
import type { ApiResponse, ContainerInfo } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/[id]/docker - List all Docker containers.
 * For local server: uses execSync.
 * For remote servers: uses SSH.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ContainerInfo[]>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    // Local server — use local docker ps
    if (isLocalServer(id)) {
      const containers = getLocalContainers();
      const data: ContainerInfo[] = containers.map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        status: c.status,
        uptime: c.uptime,
        ports: c.ports,
        state: c.state,
      }));
      return NextResponse.json({ success: true, data });
    }

    const result = await connectToServer(id);
    ssh = result.ssh;

    const containers = await getRemoteContainers(ssh);

    const data: ContainerInfo[] = containers.map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      status: c.status,
      uptime: c.uptime,
      ports: c.ports,
      state: c.state,
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
    const message = err.message || "Failed to fetch containers";
    return NextResponse.json({ success: false, error: message }, { status });
  } finally {
    await closeSSH(ssh);
  }
}

