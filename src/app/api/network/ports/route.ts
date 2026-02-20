import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { canAccessHost, execOnHost } from "@/lib/local-server";
import type { ApiResponse, PortInfo } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Parse `ss -tulnp` output into PortInfo[].
 */
function parseSsOutput(raw: string): PortInfo[] {
  const lines = raw.trim().split("\n").slice(1); // skip header
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) return null;

      const protocol = parts[0] ?? "unknown";
      const localFull = parts[3] ?? "";
      const peerFull = parts[4] ?? "";
      const processInfo = parts.slice(5).join(" ") || "";

      const localMatch = localFull.match(/^(.+):(\d+)$/);
      const localAddress = localMatch?.[1] ?? localFull;
      const localPort = parseInt(localMatch?.[2] ?? "0", 10);

      const peerMatch = peerFull.match(/^(.+):(\d+)$/);
      const foreignAddress = peerMatch?.[1] ?? peerFull;
      const foreignPort = parseInt(peerMatch?.[2] ?? "0", 10);

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
}

/**
 * Parse `netstat -tlnp` output into PortInfo[].
 */
function parseNetstatOutput(raw: string): PortInfo[] {
  const lines = raw.trim().split("\n");
  // Find lines that look like data (skip headers)
  return lines
    .filter((l) => /^(tcp|udp)/i.test(l.trim()))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      // netstat -tlnp: Proto Recv-Q Send-Q Local-Address Foreign-Address State PID/Program
      if (parts.length < 6) return null;

      const protocol = parts[0] ?? "unknown";
      const localFull = parts[3] ?? "";
      const peerFull = parts[4] ?? "";
      const state = parts[5] ?? "LISTEN";
      const processInfo = parts[6] ?? "-";

      const localMatch = localFull.match(/^(.+):(\d+)$/);
      const localAddress = localMatch?.[1] ?? localFull;
      const localPort = parseInt(localMatch?.[2] ?? "0", 10);

      const peerMatch = peerFull.match(/^(.+):(\d+)$/);
      const foreignAddress = peerMatch?.[1] ?? peerFull;
      const foreignPort = parseInt(peerMatch?.[2] ?? "0", 10);

      // Extract process name from "pid/name" format
      const procParts = processInfo.split("/");
      const processName = procParts.length > 1 ? procParts.slice(1).join("/") : processInfo;

      return {
        protocol,
        localAddress,
        localPort,
        foreignAddress,
        foreignPort,
        state: state.toUpperCase(),
        process: processName || "-",
      } satisfies PortInfo;
    })
    .filter((p): p is PortInfo => p !== null);
}

/**
 * Extract exposed ports from Docker containers as a final fallback.
 */
function getDockerExposedPorts(): PortInfo[] {
  try {
    const raw = execSync(
      'docker ps --format "{{.Names}}\\t{{.Ports}}" 2>/dev/null || true',
      { encoding: "utf-8", timeout: 10_000 }
    );
    const ports: PortInfo[] = [];
    for (const line of raw.trim().split("\n")) {
      if (!line.trim()) continue;
      const [name, portStr] = line.split("\t");
      if (!portStr) continue;
      // Parse entries like "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp"
      const mappings = portStr.split(", ");
      for (const m of mappings) {
        const match = m.match(
          /(?:(\d+\.\d+\.\d+\.\d+|::):)?(\d+)->(\d+)\/(tcp|udp)/
        );
        if (match) {
          ports.push({
            protocol: match[4] ?? "tcp",
            localAddress: match[1] || "0.0.0.0",
            localPort: parseInt(match[2] ?? "0", 10),
            foreignAddress: "*",
            foreignPort: 0,
            state: "LISTEN",
            process: name?.trim() || "-",
          });
        }
      }
    }
    // Deduplicate by protocol+port (IPv4 and IPv6 often duplicate)
    const seen = new Set<string>();
    return ports.filter((p) => {
      const key = `${p.protocol}:${p.localPort}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * GET /api/network/ports — Adaptive port discovery.
 *
 * Strategy chain:
 * 1. `ss` via nsenter on host (full host port info)
 * 2. `netstat` in container (container-visible ports)
 * 3. Docker container port mappings (exposed ports)
 */
export async function GET(): Promise<NextResponse<ApiResponse<PortInfo[]>>> {
  try {
    let ports: PortInfo[] = [];
    let source = "none";

    // ── Strategy 1: ss via nsenter (best — real host ports) ──
    if (canAccessHost()) {
      try {
        const raw = execOnHost("ss -tulnp 2>/dev/null", 10_000);
        ports = parseSsOutput(raw);
        source = "ss";
      } catch {
        // nsenter succeeded but ss failed — try next
      }
    }

    // ── Strategy 2: ss/netstat in container ──
    if (ports.length === 0) {
      try {
        const raw = execSync("ss -tulnp 2>/dev/null || netstat -tlnp 2>/dev/null || true", {
          encoding: "utf-8",
          timeout: 10_000,
        });
        if (raw.trim()) {
          // Detect which command output we got
          if (raw.includes("Recv-Q") || raw.includes("State")) {
            ports = parseSsOutput(raw);
          } else if (raw.includes("Proto")) {
            ports = parseNetstatOutput(raw);
          }
          if (ports.length > 0) source = "container";
        }
      } catch {
        // Not available in this container
      }
    }

    // ── Strategy 3: Docker exposed ports ──
    if (ports.length === 0) {
      try {
        ports = getDockerExposedPorts();
        if (ports.length > 0) source = "docker";
      } catch {
        // Docker not available
      }
    }

    return NextResponse.json({
      success: true,
      data: ports,
      source,
    } as ApiResponse<PortInfo[]> & { source: string });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list ports";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
