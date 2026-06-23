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
const HOST_HOSTNAME   = "/host/hostname";

// ─── Host access detection (cached) ───
let hostAccessAvailable: boolean | null = null;
let hostAccessCheckedAt = 0;
const HOST_ACCESS_CHECK_INTERVAL = 60_000; // Re-check every 60 s

/**
 * Test whether nsenter can reach the host PID namespace.
 * Result is cached for 60 s so repeated calls are cheap.
 */
export function canAccessHost(): boolean {
  const now = Date.now();
  if (hostAccessAvailable !== null && now - hostAccessCheckedAt < HOST_ACCESS_CHECK_INTERVAL) {
    return hostAccessAvailable;
  }
  try {
    execSync('nsenter -t 1 -m -u -i -n -- echo ok', {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    hostAccessAvailable = true;
  } catch {
    hostAccessAvailable = false;
  }
  hostAccessCheckedAt = now;
  return hostAccessAvailable;
}

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

function getHostPrimaryIp(): string {
  const fromNsenter = tryExecOnHost("hostname -I | awk '{print $1}'");
  if (fromNsenter) return fromNsenter;

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}

/** Build a virtual ServerInfo for the local machine. */
export function getLocalServerInfo(): ServerInfo {
  return {
    id: LOCAL_SERVER_ID,
    name: "Local Server",
    host: getHostPrimaryIp(),
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
 * Returns empty array when host access is unavailable (no throw).
 */
export function getLocalServices(): { services: Array<{ name: string; loadState: string; activeState: string; subState: string; unitFileState: string; description: string }>; hostAccess: boolean } {
  if (!canAccessHost()) {
    return { services: [], hostAccess: false };
  }

  try {
    const raw = execOnHost(
      "systemctl list-units --type=service --all --no-pager --plain --no-legend"
    );
    if (!raw) return { services: [], hostAccess: true };

    const services = raw.split("\n").filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      const unitName = parts[0] || "";
      const safeUnit = unitName.replace(/[^a-zA-Z0-9_.@-]/g, "");
      let unitFileState = "unknown";

      if (safeUnit) {
        try {
          unitFileState = execOnHost(
            `systemctl show ${safeUnit} -p UnitFileState --value 2>/dev/null || true`,
            5_000
          ).trim() || "unknown";
        } catch {
          unitFileState = "unknown";
        }
      }

      return {
        name: unitName.replace(".service", ""),
        loadState: parts[1] || "unknown",
        activeState: parts[2] || "unknown",
        subState: parts[3] || "unknown",
        unitFileState,
        description: parts.slice(4).join(" ") || "",
      };
    });
    return { services, hostAccess: true };
  } catch (err) {
    console.warn(
      "[local-server] Service discovery failed:",
      err instanceof Error ? err.message : err
    );
    return { services: [], hostAccess: true };
  }
}

// ─── Local Quick Actions ───

/** Actions that use Docker CLI (via socket, no nsenter) */
const DOCKER_ACTIONS = new Set([
  "docker-prune",
  "docker-stats",
  "connection-stats",
  "check-docker-version",
]);

/** Command map: all host-level commands run via nsenter */
const LOCAL_ACTION_COMMANDS: Record<string, string> = {
  // Maintenance
  "system-health-check": "echo '=== DISK ===' && df -h / && echo '' && echo '=== MEMORY ===' && free -h && echo '' && echo '=== CPU LOAD ===' && uptime && echo '' && echo '=== UPTIME ===' && uptime -p 2>/dev/null || uptime && echo '' && echo '=== PENDING UPDATES ===' && (apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0) && echo '' && echo '=== FAILED SERVICES ===' && (systemctl --failed --no-pager --no-legend 2>/dev/null || echo 'N/A') && echo '' && echo '=== KERNEL ===' && uname -r",
  "security-check":     "echo '=== FIREWALL ===' && (ufw status 2>/dev/null || iptables -L -n --line-numbers 2>/dev/null | head -30 || echo 'No firewall detected') && echo '' && echo '=== FAIL2BAN ===' && (fail2ban-client status 2>/dev/null || echo 'fail2ban not installed') && echo '' && echo '=== RECENT SSH LOGINS ===' && (last -n 10 -a 2>/dev/null || echo 'N/A') && echo '' && echo '=== FAILED LOGIN ATTEMPTS ===' && (journalctl _SYSTEMD_UNIT=sshd.service --since '24 hours ago' --no-pager 2>/dev/null | grep -i 'failed\\|invalid' | tail -10 || echo 'None in last 24h')",
  "sync-time":          "timedatectl set-ntp true; chronyc -a makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || echo NTP sync attempted",
  "os-version-check":   "echo '=== OS ===' && cat /etc/os-release 2>/dev/null && echo '' && echo '=== KERNEL ===' && uname -a && echo '' && echo '=== DISTRIBUTION UPGRADES ===' && (do-release-upgrade -c 2>/dev/null || echo 'do-release-upgrade not available')",
  // Update
  "os-update":          "apt update -y && apt upgrade -y",
  // Diagnostics
  "docker-stats":       'docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}"',
  "connection-stats":   "echo '=== CONNECTION SUMMARY ===' && ss -s && echo '' && echo '=== LISTENING PORTS ===' && ss -tlnp",
  // Cleanup
  "docker-prune":       "docker system prune -af",
  "clear-apt-cache":    "apt clean && apt autoclean",
  "clear-logs":         "journalctl --vacuum-time=3d",
  "clear-temp":         "rm -rf /tmp/* /var/tmp/* 2>/dev/null && echo 'Temp files cleared'",
  "remove-old-kernels": "apt autoremove --purge -y",
  // System
  "restart-docker":     "systemctl restart docker",
  "restart-server":     "reboot",
  // Security
  "firewall-reload":    "ufw reload 2>/dev/null || (iptables-save && echo 'iptables rules reloaded')",
  "unban-all":          "fail2ban-client unban --all 2>/dev/null || echo 'fail2ban not available'",
  "ban-ip":             "fail2ban-client set sshd banip {PARAM} 2>/dev/null || ufw deny from {PARAM} 2>/dev/null || echo 'Neither fail2ban nor ufw available'",
  "unban-ip":           "fail2ban-client set sshd unbanip {PARAM} 2>/dev/null || ufw delete deny from {PARAM} 2>/dev/null || echo 'Neither fail2ban nor ufw available'",
  // Legacy
  "check-disk":         "df -h",
  "check-uptime":       "uptime",
  "check-memory":       "free -h",
  "check-connections":  "ss -s",
  "check-docker-version": 'docker version --format "Client: {{.Client.Version}}, Server: {{.Server.Version}}"',
};

/**
 * Run a quick action locally.
 * Docker commands use the socket directly; system commands use nsenter.
 */
export function localQuickAction(
  action: string,
  param?: string,
): { success: boolean; output: string } {
  let command = LOCAL_ACTION_COMMANDS[action];
  if (!command) {
    return { success: false, output: `Unknown action: ${action}` };
  }

  // Substitute {PARAM} with validated param
  if (command.includes("{PARAM}") && param) {
    const safeParam = param.replace(/[^a-fA-F0-9.:]/g, "");
    // Validate IP format (IPv4 or IPv6) before injection
    const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(safeParam) &&
      safeParam.split(".").every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
    const isIPv6 = /^[a-fA-F0-9:]+$/.test(safeParam) && safeParam.includes(":");
    if (!isIPv4 && !isIPv6) {
      return { success: false, output: "Invalid IP address format. Please enter a valid IPv4 (e.g., 192.168.1.1) or IPv6 address." };
    }
    command = command.replace(/\{PARAM\}/g, safeParam);
  }

  const isDockerAction = DOCKER_ACTIONS.has(action);

  // Check host access before attempting nsenter commands
  if (!isDockerAction && !canAccessHost()) {
    return {
      success: false,
      output: "Host access unavailable — this action requires nsenter (pid:host mode in Docker). This feature only works when the app is deployed on a Linux VPS.",
    };
  }

  try {
    const exec = isDockerAction ? execLocal : execOnHost;
    const output = exec(command, 120_000);
    return { success: true, output: output || "Done (no output)" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: friendlyErrorMessage(msg) };
  }
}

/**
 * Map raw technical error messages to human-readable explanations.
 * Used by Quick Actions and any host command output.
 */
export function friendlyErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("nsenter") && lower.includes("operation not permitted"))
    return "Host access unavailable — the app needs Docker 'pid:host' mode to run system commands. Check your docker-compose.yml settings.";
  if (lower.includes("nsenter") && lower.includes("no such file"))
    return "The nsenter tool is not available inside this container. Ensure the Docker image supports host access.";
  if (lower.includes("econnrefused"))
    return "Connection refused — the service is not responding. It may be stopped or still starting up.";
  if (lower.includes("permission denied"))
    return "Permission denied — this command requires elevated privileges that are not available.";
  if (lower.includes("command not found") || lower.includes("not found"))
    return `Command not available in this environment: ${raw.split(":").pop()?.trim() || raw}`;
  if (lower.includes("timed out") || lower.includes("etimedout") || lower.includes("timeout"))
    return "The command timed out — the server may be under heavy load. Please try again.";
  if (lower.includes("docker.sock") || lower.includes("cannot connect to the docker"))
    return "Cannot connect to Docker — make sure the Docker socket is mounted and Docker is running.";
  if (lower.includes("enotfound") || lower.includes("getaddrinfo"))
    return "DNS resolution failed — check your network connection and server hostname.";
  return raw;
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
  restartPolicy: string;
  volumes: string;
  domain: string | null;
  env: string[];
} | null {
  try {
    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!safeId) return null;

    const raw = execLocal(
      `docker inspect --format "{{.Id}}|||{{.Name}}|||{{.Config.Image}}|||{{.State.Status}}|||{{.Created}}|||{{.HostConfig.RestartPolicy.Name}}" ${safeId}`,
      10_000
    );
    if (!raw.trim()) return null;

    const [fullId, name, image, state, created, restartPolicy] = raw.trim().split("|||");

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

    // Get volumes (bind mounts + named volumes)
    let volumes = "";
    try {
      volumes = execLocal(
        `docker inspect --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' ${safeId}`,
        5_000
      ).trim();
    } catch { /* ignore */ }

    // Get labels for domain detection (traefik, caddy, nginx-proxy)
    let domain: string | null = null;
    try {
      const labelRaw = execLocal(
        `docker inspect --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}\\n{{end}}' ${safeId}`,
        5_000
      );
      // Check for Traefik Host rules. Router names often contain dashes.
      const traefikRule = labelRaw
        .split("\n")
        .find((line) => /^traefik\.http\.routers\.[^.]+\.rule=/.test(line));
      const traefikMatch = traefikRule?.match(/Host\(([^)]*)\)/);
      const hostMatch = traefikMatch?.[1].match(/[`\"]([^`\"]+)[`\"]/);
      if (hostMatch) domain = hostMatch[1];
      // Check for VIRTUAL_HOST (nginx-proxy)
      if (!domain) {
        const vhMatch = labelRaw.match(/VIRTUAL_HOST=([^\s\n]+)/);
        if (vhMatch) domain = vhMatch[1];
      }
    } catch { /* ignore */ }

    // Get environment variables from container config
    let env: string[] = [];
    try {
      const envRaw = execLocal(
        `docker inspect --format '{{range .Config.Env}}{{.}}\\n{{end}}' ${safeId}`,
        5_000
      );
      env = envRaw.trim().split("\n").filter(Boolean);
    } catch { /* ignore */ }

    return {
      id: fullId || containerId,
      name: (name || "").replace(/^\//, ""), // Remove leading /
      image: image || "",
      state: state || "unknown",
      status,
      ports: ports.trim(),
      createdAt: created || new Date().toISOString(),
      restartPolicy: restartPolicy || "no",
      volumes,
      domain,
      env,
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
          `docker network inspect ${net.id} --format '{{range $id,$c := .Containers}}{{printf "%s\\t%s\\t%s\\n" $id $c.Name $c.IPv4Address}}{{end}}'`,
          5_000
        );
        if (inspectRaw.trim()) {
          for (const cLine of inspectRaw.trim().split("\n").filter(Boolean)) {
            const [cId, cName, ipv4] = cLine.split("\t");
            if (cName) {
              let image = "";
              let state = "";
              let ports = "";
              try {
                const details = execLocal(
                  `docker inspect --format "{{.Config.Image}}\\t{{.State.Status}}\\t{{range $p,$conf := .NetworkSettings.Ports}}{{$p}} {{end}}" ${cId}`,
                  5_000,
                );
                [image, state, ports] = details.split("\t");
              } catch { /* optional details */ }
              net.containers.push({
                id: cId || cName,
                name: cName,
                ipv4: (ipv4 || "").replace(/\/\d+$/, ""),
                image,
                state,
                ports,
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
