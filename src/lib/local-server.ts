/**
 * Local server utility.
 *
 * Provides a virtual "local" server entry for the VPS where this app runs.
 * All APIs check `isLocalServer(id)` and use `execLocal()` instead of SSH.
 *
 * Architecture:
 * - Docker commands → docker CLI → Docker socket → host daemon (no nsenter)
 * - Host OS commands → nsenter -t 1 → host PID namespace (apt, systemctl, etc.)
 *
 * Requires: pid:"host" in docker-compose and root inside the container.
 * This is the standard pattern used by Portainer and similar management tools.
 */

import os from "os";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import type { ServerInfo } from "@/types";

// ─── Bind-mount paths (set by docker-compose) ───
const HOST_OS_RELEASE = "/host/os-release";
const HOST_HOSTNAME   = "/host/hostname";

/** The sentinel ID for the local server. */
export const LOCAL_SERVER_ID = "local";

/** Check whether a server ID refers to the local machine. */
export function isLocalServer(id: string | null | undefined): boolean {
  return id === LOCAL_SERVER_ID;
}

/**
 * Execute a command locally (inside this container).
 * Used for Docker CLI commands which talk to the host daemon via socket.
 */
export function execLocal(command: string, timeoutMs = 30_000): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    const output = e.stderr || e.stdout || e.message || "Command failed";
    throw new Error(output.toString().trim());
  }
}

/**
 * Execute a command ON THE HOST via nsenter.
 * This breaks out of the container namespace into the host's PID 1 namespace,
 * giving access to the host's apt, systemctl, df, etc.
 *
 * Requires: pid:"host" in docker-compose.yml + running as root.
 */
export function execOnHost(command: string, timeoutMs = 30_000): string {
  // Escape single quotes in the command for safe embedding
  const escaped = command.replace(/'/g, "'\\''");
  return execLocal(
    `nsenter -t 1 -m -u -i -n -- sh -c '${escaped}'`,
    timeoutMs
  );
}

/**
 * Read a file from the host via bind-mount (/host/...).
 * Falls back to empty string on failure — never throws.
 */
export function readHostFile(path: string): string {
  try {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8").trim();
    }
  } catch {
    // Bind mount missing or unreadable
  }
  return "";
}

/**
 * Safe wrapper around execOnHost — returns empty string on failure.
 * Use for non-critical data gathering where failure is acceptable.
 */
export function tryExecOnHost(command: string, timeoutMs = 30_000): string {
  try {
    return execOnHost(command, timeoutMs);
  } catch (err) {
    console.warn(
      "[local-server] Host command failed:",
      command.slice(0, 60),
      err instanceof Error ? err.message.slice(0, 100) : ""
    );
    return "";
  }
}

/**
 * Read the real host hostname.
 * Fallback chain: bind mount → nsenter → os.hostname()
 */
function getHostHostname(): string {
  // 1. Try bind-mounted file (fastest, no nsenter)
  const fromFile = readHostFile(HOST_HOSTNAME);
  if (fromFile) return fromFile;

  // 2. Try nsenter
  const fromNsenter = tryExecOnHost("hostname");
  if (fromNsenter) return fromNsenter;

  // 3. Fallback to container hostname
  return os.hostname();
}

/** Build a virtual ServerInfo for the local machine. */
export function getLocalServerInfo(): ServerInfo {
  return {
    id: LOCAL_SERVER_ID,
    name: "Local Server",
    host: "127.0.0.1",
    port: 0,
    username: os.userInfo().username,
    authMethod: "PASSWORD",
    isActive: true,
    lastConnected: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    hostname: getHostHostname(),
  };
}

/**
 * Get local Docker containers.
 * Docker CLI → socket → host daemon (no nsenter needed).
 */
export function getLocalContainers() {
  try {
    const fmt = "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.State}}";
    const raw = execLocal(
      `docker ps -a --format "${fmt}"`,
      10_000
    );
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [id, name, image, status, ports, state] = line.split("\t");
      return {
        id: id || "",
        name: name || "",
        image: image || "",
        status: status || "",
        ports: ports || "",
        state: state || "",
        uptime: status || "",
      };
    });
  } catch (err) {
    console.warn(
      "[local-server] Docker container discovery failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get local systemd services via nsenter (runs on the host).
 */
export function getLocalServices() {
  try {
    const raw = execOnHost(
      "systemctl list-units --type=service --all --no-pager --plain --no-legend"
    );
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        name: (parts[0] || "").replace(".service", ""),
        loadState: parts[1] || "unknown",
        activeState: parts[2] || "unknown",
        subState: parts[3] || "unknown",
        description: parts.slice(4).join(" ") || "",
      };
    });
  } catch (err) {
    console.warn(
      "[local-server] Service discovery failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

// ─── Local Quick Actions ───

/** Actions that use Docker CLI (via socket, no nsenter) */
const DOCKER_ACTIONS = new Set([
  "docker-prune",
  "docker-stats",
  "check-docker-version",
]);

/** Command map: all host-level commands run via nsenter */
const LOCAL_ACTION_COMMANDS: Record<string, string> = {
  "system-update":    "apt update -y && apt upgrade -y",
  "docker-prune":     "docker system prune -af",
  "restart-docker":   "systemctl restart docker",
  "clear-apt-cache":  "apt clean && apt autoclean",
  "clear-logs":       "journalctl --vacuum-time=3d",
  "check-disk":       "df -h",
  "security-updates": "apt update -qq && apt list --upgradable 2>/dev/null",
  "docker-stats":     'docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}"',
  "sync-time":        "timedatectl set-ntp true; chronyc -a makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || echo NTP sync attempted",
  "restart-server":   "reboot",
  "check-uptime":     "uptime",
  "check-memory":     "free -h",
  "check-connections": "ss -s",
  "check-docker-version": 'docker version --format "Client: {{.Client.Version}}, Server: {{.Server.Version}}"',
};

/**
 * Run a quick action locally.
 * Docker commands use the socket directly; system commands use nsenter.
 */
export function localQuickAction(
  action: string
): { success: boolean; output: string } {
  const command = LOCAL_ACTION_COMMANDS[action];
  if (!command) {
    return { success: false, output: `Unknown action: ${action}` };
  }

  try {
    const exec = DOCKER_ACTIONS.has(action) ? execLocal : execOnHost;
    const output = exec(command, 120_000);
    return { success: true, output: output || "Done (no output)" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: msg };
  }
}

// ─── Local App ID Helpers ───

/**
 * Local containers have IDs like `local::abc123` or `local:abc123`.
 * Check if an ID is a local container reference.
 */
export function isLocalAppId(id: string): boolean {
  return id.startsWith("local::");
}

/**
 * Extract the Docker container ID from a local app ID.
 * `local::abc123def` → `abc123def`
 */
export function parseLocalContainerId(id: string): string {
  return id.replace(/^local::/, "");
}

/**
 * Get detailed info for a local Docker container by container ID.
 * Uses `docker inspect` for metadata + `docker ps` for status.
 */
export function getLocalContainerDetail(containerId: string): {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  createdAt: string;
} | null {
  try {
    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!safeId) return null;

    const raw = execLocal(
      `docker inspect --format "{{.Id}}\\t{{.Name}}\\t{{.Config.Image}}\\t{{.State.Status}}\\t{{.Created}}\\t{{.HostConfig.RestartPolicy.Name}}" ${safeId}`,
      10_000
    );
    if (!raw.trim()) return null;

    const [fullId, name, image, state, created, restartPolicy] = raw.trim().split("\t");

    // Get ports from docker ps
    let ports = "";
    try {
      ports = execLocal(
        `docker ps -a --filter "id=${safeId}" --format "{{.Ports}}"`,
        5_000
      );
    } catch { /* ignore */ }

    // Get status text from docker ps
    let status = state || "unknown";
    try {
      const statusRaw = execLocal(
        `docker ps -a --filter "id=${safeId}" --format "{{.Status}}"`,
        5_000
      );
      if (statusRaw) status = statusRaw;
    } catch { /* ignore */ }

    return {
      id: fullId || containerId,
      name: (name || "").replace(/^\//, ""), // Remove leading /
      image: image || "",
      state: state || "unknown",
      status,
      ports: ports.trim(),
      createdAt: created || new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      "[local-server] Container detail failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ─── Local Network Topology ───

/**
 * Get Docker networks with attached containers (local).
 */
export function getLocalDockerNetworks(): Array<{
  id: string; name: string; driver: string;
  containers: Array<{ id: string; name: string; ipv4: string; image?: string; state?: string; ports?: string }>;
}> {
  try {
    // List networks
    const netRaw = execLocal(
      'docker network ls --format "{{.ID}}\\t{{.Name}}\\t{{.Driver}}"',
      10_000
    );
    if (!netRaw.trim()) return [];

    const networks = netRaw.trim().split("\n").filter(Boolean).map((line) => {
      const [id, name, driver] = line.split("\t");
      return { id: id || "", name: name || "", driver: driver || "", containers: [] as Array<{ id: string; name: string; ipv4: string; image?: string; state?: string; ports?: string }> };
    });

    // For each network, inspect to get containers
    for (const net of networks) {
      try {
        const inspectRaw = execLocal(
          `docker network inspect ${net.id} --format "{{range .Containers}}{{.Name}}\\t{{.IPv4Address}}\\n{{end}}"`,
          5_000
        );
        if (inspectRaw.trim()) {
          for (const cLine of inspectRaw.trim().split("\n").filter(Boolean)) {
            const [cName, ipv4] = cLine.split("\t");
            if (cName) {
              net.containers.push({
                id: "", // Inspect doesn't give container ID easily in this format
                name: cName,
                ipv4: (ipv4 || "").replace(/\/\d+$/, ""), // Remove CIDR
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    return networks;
  } catch (err) {
    console.warn("[local-server] Docker network discovery failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get listening ports on the local host via `ss`.
 */
export function getLocalHostPorts(): Array<{
  protocol: string; localAddress: string; localPort: number;
  foreignAddress: string; foreignPort: number; state: string; process: string;
}> {
  try {
    const raw = execLocal("ss -tlnp 2>/dev/null || echo ''", 10_000);
    if (!raw.trim()) return [];

    const lines = raw.trim().split("\n").filter(Boolean);
    // Skip header line
    return lines.slice(1).map((line) => {
      const parts = line.split(/\s+/);
      const state = parts[0] || "LISTEN";
      const local = parts[3] || "";
      const foreign = parts[4] || "";
      const process = parts[5] || "";

      // Parse local address:port
      const lastColon = local.lastIndexOf(":");
      const localAddress = local.slice(0, lastColon) || "*";
      const localPort = parseInt(local.slice(lastColon + 1), 10) || 0;

      const fLastColon = foreign.lastIndexOf(":");
      const foreignAddress = foreign.slice(0, fLastColon) || "*";
      const foreignPort = parseInt(foreign.slice(fLastColon + 1), 10) || 0;

      return { protocol: "tcp", localAddress, localPort, foreignAddress, foreignPort, state, process };
    });
  } catch {
    return [];
  }
}

/**
 * Get full local network topology (Docker networks + host ports).
 */
export function getLocalNetworkTopology() {
  return {
    networks: getLocalDockerNetworks(),
    hostPorts: getLocalHostPorts(),
  };
}
