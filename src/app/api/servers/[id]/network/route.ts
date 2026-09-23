import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { getRemoteDockerNetworks, getRemoteHostPorts, closeSSH } from "@/lib/ssh";
import { isLocalServer, getLocalNetworkTopology } from "@/lib/local-server";
import type { ApiResponse, NetworkFinding, NetworkTopology, PortInfo } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const RISKY_PORTS: Record<number, { title: string; detail: string }> = {
  21: { title: "FTP is publicly reachable", detail: "FTP is old and often sends data without modern protection." },
  22: { title: "SSH is publicly reachable", detail: "SSH is expected on many VPSes, but it should be protected by strong keys, fail2ban, or trusted IPs." },
  23: { title: "Telnet is publicly reachable", detail: "Telnet is insecure and should not be exposed to the internet." },
  3306: { title: "MySQL is publicly reachable", detail: "Databases should usually be private or restricted to trusted IPs." },
  5432: { title: "PostgreSQL is publicly reachable", detail: "Databases should usually be private or restricted to trusted IPs." },
  6379: { title: "Redis is publicly reachable", detail: "Redis exposure can lead to data loss or server compromise." },
  27017: { title: "MongoDB is publicly reachable", detail: "Databases should usually be private or restricted to trusted IPs." },
  9200: { title: "Elasticsearch is publicly reachable", detail: "Search clusters often expose sensitive data and should be restricted." },
};

function isPublicAddress(address: string) {
  return !address || address === "*" || address === "0.0.0.0" || address === "::" || address === "[::]";
}

function networkFindings(hostPorts: PortInfo[]): NetworkFinding[] {
  const seen = new Set<string>();
  return hostPorts.flatMap((port) => {
    if (!isPublicAddress(port.localAddress)) return [];
    const key = `${port.protocol}:${port.localPort}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const risk = RISKY_PORTS[port.localPort];
    if (!risk) return [];
    return [{
      id: `public-${key}`,
      severity: port.localPort === 22 ? "medium" : "high",
      title: risk.title,
      detail: risk.detail,
      suggestedFix: port.localPort === 22 ? "Keep SSH protected with keys/fail2ban; restrict by IP if possible." : "Use Preview first, then block public access if this service should not be internet-facing.",
      port: port.localPort,
      protocol: port.protocol,
    } satisfies NetworkFinding];
  });
}

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

    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    // ── Local server: use Docker socket + ss (no SSH) ──
    if (isLocalServer(id)) {
      const topo = getLocalNetworkTopology();
      return NextResponse.json({
        success: true,
        data: {
          networks: topo.networks.map((n) => ({
            id: n.id,
            name: n.name,
            driver: n.driver,
            containers: n.containers.map((c) => ({
              id: c.id,
              name: c.name,
              ipv4: c.ipv4,
              image: c.image,
              state: c.state,
              ports: c.ports,
            })),
          })),
          hostPorts: topo.hostPorts.map((p) => ({
            protocol: p.protocol,
            localAddress: p.localAddress,
            localPort: p.localPort,
            foreignAddress: p.foreignAddress,
            foreignPort: p.foreignPort,
            state: p.state,
            process: p.process,
          })),
          findings: networkFindings(topo.hostPorts),
        },
      });
    }

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
          image: c.image,
          state: c.state,
          ports: c.ports,
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
    data.findings = networkFindings(data.hostPorts);

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

