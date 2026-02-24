/**
 * SSH Network — Docker network topology and host port retrieval via SSH.
 */

import type SSH2Promise from "ssh2-promise";
import { executeCommandSafe } from "./connection";

// ─── Docker Networks (for topology) ───

export interface RemoteDockerNetworkContainer {
  id: string;
  name: string;
  ipv4: string;
  image?: string;
  state?: string;
  ports?: string;
}

export interface RemoteDockerNetwork {
  id: string;
  name: string;
  driver: string;
  containers: RemoteDockerNetworkContainer[];
}

/**
 * Fetch Docker network topology and host ports from a remote server.
 */
export async function getRemoteDockerNetworks(
  ssh: SSH2Promise
): Promise<{ networks: RemoteDockerNetwork[]; dockerInstalled: boolean }> {
  const [networkList, containerStatusRaw] = await Promise.all([
    executeCommandSafe(ssh, "docker network ls --format '{{.ID}}\\t{{.Name}}\\t{{.Driver}}' 2>/dev/null"),
    executeCommandSafe(ssh, "docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Ports}}' 2>/dev/null"),
  ]);

  if (!networkList) return { networks: [], dockerInstalled: false };

  const containerMeta = new Map<string, { image: string; state: string; ports: string }>();
  if (containerStatusRaw) {
    for (const line of containerStatusRaw.split("\n").filter(Boolean)) {
      const [cName, cImage, cState, cPorts] = line.split("\t");
      if (cName) containerMeta.set(cName, { image: cImage || "", state: cState || "", ports: cPorts || "" });
    }
  }

  const networkEntries = networkList.split("\n").filter(Boolean);
  const networks: RemoteDockerNetwork[] = [];

  for (const entry of networkEntries) {
    const [id, name, driver] = entry.split("\t");
    if (!name) continue;

    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!safeName) continue;

    const inspectRaw = await executeCommandSafe(
      ssh,
      `docker network inspect ${safeName} --format '{{range .Containers}}{{.Name}}\\t{{slice .EndpointID 0 12}}\\t{{.IPv4Address}}\\n{{end}}' 2>/dev/null`
    );

    const containers: RemoteDockerNetworkContainer[] = [];
    if (inspectRaw) {
      for (const cLine of inspectRaw.split("\n").filter(Boolean)) {
        const [cName, cId, cIpv4] = cLine.split("\t");
        if (cName) {
          const meta = containerMeta.get(cName);
          containers.push({
            id: cId || "",
            name: cName,
            ipv4: (cIpv4 || "").replace(/\/\d+$/, ""),
            image: meta?.image,
            state: meta?.state,
            ports: meta?.ports,
          });
        }
      }
    }

    networks.push({ id: id || "", name: name || "", driver: driver || "", containers });
  }

  return { networks, dockerInstalled: true };
}

/**
 * Fetch host-level open ports from a remote server using ss.
 */
export async function getRemoteHostPorts(ssh: SSH2Promise) {
  const raw = await executeCommandSafe(ssh, "ss -tulnp 2>/dev/null | tail -n +2");
  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const protocol = parts[0] || "";
      const localAddr = parts[4] || "";
      const process = parts[6] || "";

      const lastColon = localAddr.lastIndexOf(":");
      const address = localAddr.substring(0, lastColon);
      const port = parseInt(localAddr.substring(lastColon + 1), 10);

      const processMatch = process.match(/\(\("([^"]+)"/);
      const processName = processMatch ? processMatch[1] : "";

      return {
        protocol,
        localAddress: address,
        localPort: isNaN(port) ? 0 : port,
        process: processName,
        state: "LISTEN",
      };
    });
}
