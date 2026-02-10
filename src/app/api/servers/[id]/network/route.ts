import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getRemoteDockerNetworks, getRemoteHostPorts, closeSSH } from "@/lib/ssh";
import type { ApiResponse, NetworkTopology } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/[id]/network - Fetch Docker network topology and host ports.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<NetworkTopology>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;
    const result = await connectToServer(id);
    ssh = result.ssh;

    const [dockerResult, hostPorts] = await Promise.all([
      getRemoteDockerNetworks(ssh),
      getRemoteHostPorts(ssh),
    ]);

    const data: NetworkTopology = {
      networks: dockerResult.networks.map((n) => ({
        id: n.id,
        name: n.name,
        driver: n.driver,
        containers: n.containers.map((c) => ({
          id: c.id,
          name: c.name,
          ipv4: c.ipv4,
        })),
      })),
      hostPorts: hostPorts.map((p) => ({
        protocol: p.protocol,
        localAddress: p.localAddress,
        localPort: p.localPort,
        foreignAddress: "",
        foreignPort: 0,
        state: p.state,
        process: p.process,
      })),
    };

    const warning = dockerResult.dockerInstalled
      ? undefined
      : "Docker is not installed on this server";

    return NextResponse.json({ success: true, data, warning });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json(
        { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
        { status: 503 }
      );
    }

    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 500;
    const message = err.message || "Failed to fetch network topology";
    return NextResponse.json({ success: false, error: message }, { status });
  } finally {
    await closeSSH(ssh);
  }
}
