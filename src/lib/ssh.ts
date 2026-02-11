/**
 * SSH connection wrapper using ssh2-promise.
 *
 * IMPORTANT: Host keys are auto-accepted for automation.
 * ssh2 does NOT verify host keys unless you explicitly provide
 * a hostVerifier callback. By not setting one, all host keys
 * are accepted automatically — intentional for VPS automation.
 */

import SSH2Promise from "ssh2-promise";

export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/** Default timeouts (milliseconds) */
const SSH_READY_TIMEOUT = 10_000;
const SSH_COMMAND_TIMEOUT = 15_000;

/**
 * Create and connect an SSH session.
 * Host keys are auto-accepted (no interactive verification).
 * Keepalive is enabled so the connection doesn't drop on slow servers.
 */
export async function createSSHConnection(
  config: SSHConnectionConfig
): Promise<SSH2Promise> {
  const sshConfig: Record<string, unknown> = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: SSH_READY_TIMEOUT,
    // Send keepalive every 10 s — prevents premature timeouts on slow hosts
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    // Supported host key algorithms (broad compatibility)
    algorithms: {
      serverHostKey: [
        "ssh-ed25519",
        "ecdsa-sha2-nistp256",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp521",
        "rsa-sha2-512",
        "rsa-sha2-256",
        "ssh-rsa",
      ],
    },
  };

  if (config.password) {
    sshConfig.password = config.password;
  }

  if (config.privateKey) {
    sshConfig.privateKey = config.privateKey;
  }

  const ssh = new SSH2Promise(sshConfig);
  await ssh.connect();
  return ssh;
}

/**
 * Safely close an SSH connection (ignores errors).
 */
export async function closeSSH(
  ssh: SSH2Promise | null | undefined
): Promise<void> {
  if (!ssh) return;
  try {
    await ssh.close();
  } catch {
    // Ignore close errors — connection may already be dead
  }
}

/**
 * Execute a command on a remote server and return stdout.
 * Includes a per-command timeout to prevent hangs.
 */
export async function executeCommand(
  ssh: SSH2Promise,
  command: string,
  timeoutMs: number = SSH_COMMAND_TIMEOUT
): Promise<string> {
  try {
    const result = await Promise.race([
      ssh.exec(command),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`SSH command timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
    return result.toString().trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`SSH command failed: ${msg}`);
  }
}

/**
 * Execute a command silently — returns empty string on failure instead of throwing.
 * Useful for optional commands (e.g., docker may not be installed).
 */
async function executeCommandSafe(
  ssh: SSH2Promise,
  command: string,
  timeoutMs: number = SSH_COMMAND_TIMEOUT
): Promise<string> {
  try {
    return await executeCommand(ssh, command, timeoutMs);
  } catch {
    return "";
  }
}

/**
 * Fetch system stats from a remote VPS via SSH.
 * All 6 commands run in parallel for minimal latency.
 */
export async function getRemoteStats(ssh: SSH2Promise) {
  const [cpuRaw, memRaw, diskRaw, uptimeRaw, hostnameRaw, osRaw] =
    await Promise.all([
      executeCommand(
        ssh,
        "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"
      ),
      executeCommand(
        ssh,
        "free -b | awk 'NR==2{printf \"%s %s %s\", $2, $3, $7}'"
      ),
      executeCommand(
        ssh,
        "df -B1 / | awk 'NR==2{printf \"%s %s %s\", $2, $3, $4}'"
      ),
      executeCommand(ssh, "uptime -p 2>/dev/null || uptime"),
      executeCommand(ssh, "hostname"),
      executeCommand(ssh, "cat /etc/os-release 2>/dev/null | head -1 | cut -d'\"' -f2 || uname -s"),
    ]);

  const [memTotal, memUsed, memAvailable] = memRaw.split(" ").map(Number);
  const [diskTotal, diskUsed, diskAvailable] = diskRaw.split(" ").map(Number);

  return {
    hostname: hostnameRaw,
    platform: osRaw,
    uptime: uptimeRaw,
    cpu: {
      usagePercent: parseFloat(cpuRaw) || 0,
    },
    memory: {
      total: memTotal || 0,
      used: memUsed || 0,
      available: memAvailable || 0,
      usagePercent: memTotal ? (memUsed / memTotal) * 100 : 0,
    },
    disk: {
      total: diskTotal || 0,
      used: diskUsed || 0,
      available: diskAvailable || 0,
      usagePercent: diskTotal ? (diskUsed / diskTotal) * 100 : 0,
    },
  };
}

// ─── OS Details ───

export interface RemoteOSDetails {
  distro: string;
  version: string;
  kernel: string;
}

/**
 * Fetch detailed OS information from a remote server.
 */
export async function getRemoteOSDetails(
  ssh: SSH2Promise
): Promise<RemoteOSDetails> {
  const [kernelRaw, prettyName, versionId] = await Promise.all([
    executeCommandSafe(ssh, "uname -r"),
    executeCommandSafe(
      ssh,
      "grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d'\"' -f2"
    ),
    executeCommandSafe(
      ssh,
      "grep '^VERSION_ID=' /etc/os-release 2>/dev/null | cut -d'\"' -f2"
    ),
  ]);

  return {
    distro: prettyName || "Unknown Linux",
    version: versionId || "",
    kernel: kernelRaw || "",
  };
}

// ─── Docker Containers ───

export interface RemoteContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  uptime: string;
  ports: string;
  state: string;
}

/**
 * List all Docker containers (running and stopped) on a remote server.
 * Returns empty array if Docker is not installed.
 */
export async function getRemoteContainers(
  ssh: SSH2Promise
): Promise<RemoteContainerInfo[]> {
  const raw = await executeCommandSafe(
    ssh,
    "docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.RunningFor}}\\t{{.Ports}}\\t{{.State}}' 2>/dev/null"
  );

  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, name, image, status, uptime, ports, state] = line.split("\t");
      return {
        id: id || "",
        name: name || "",
        image: image || "",
        status: status || "",
        uptime: uptime || "",
        ports: ports || "",
        state: state || "",
      };
    });
}

// ─── Systemd Services ───

export interface RemoteServiceInfo {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  description: string;
}

/**
 * List systemd service units on a remote server.
 * Returns empty array if systemctl is unavailable.
 */
export async function getRemoteServices(
  ssh: SSH2Promise
): Promise<RemoteServiceInfo[]> {
  const raw = await executeCommandSafe(
    ssh,
    "systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null"
  );

  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // Format: UNIT LOAD ACTIVE SUB DESCRIPTION...
      const parts = line.trim().split(/\s+/);
      const name = (parts[0] || "").replace(".service", "");
      const loadState = parts[1] || "";
      const activeState = parts[2] || "";
      const subState = parts[3] || "";
      const description = parts.slice(4).join(" ");
      return { name, loadState, activeState, subState, description };
    });
}

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
  // Fetch network list and container status in parallel
  const [networkList, containerStatusRaw] = await Promise.all([
    executeCommandSafe(
      ssh,
      "docker network ls --format '{{.ID}}\\t{{.Name}}\\t{{.Driver}}' 2>/dev/null"
    ),
    executeCommandSafe(
      ssh,
      "docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Ports}}' 2>/dev/null"
    ),
  ]);

  if (!networkList) {
    return { networks: [], dockerInstalled: false };
  }

  // Build lookup map: container name → { image, state, ports }
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

    // Sanitize network name to prevent command injection
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!safeName) continue;

    // Inspect each network for container info
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

    networks.push({
      id: id || "",
      name: name || "",
      driver: driver || "",
      containers,
    });
  }

  return { networks, dockerInstalled: true };
}

/**
 * Fetch host-level open ports from a remote server using ss.
 */
export async function getRemoteHostPorts(ssh: SSH2Promise) {
  const raw = await executeCommandSafe(
    ssh,
    "ss -tulnp 2>/dev/null | tail -n +2"
  );

  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const protocol = parts[0] || "";
      const localAddr = parts[4] || "";
      const process = parts[6] || "";

      // Parse address:port
      const lastColon = localAddr.lastIndexOf(":");
      const address = localAddr.substring(0, lastColon);
      const port = parseInt(localAddr.substring(lastColon + 1), 10);

      // Extract process name from users:(("name",pid=X,fd=Y))
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

// ─── Container Actions ───

const ALLOWED_CONTAINER_ACTIONS = ["start", "stop", "restart"] as const;
type ContainerAction = (typeof ALLOWED_CONTAINER_ACTIONS)[number];

/**
 * Perform a Docker container action (start/stop/restart).
 * Container ID is sanitized to prevent command injection.
 */
export async function containerAction(
  ssh: SSH2Promise,
  containerId: string,
  action: ContainerAction
): Promise<{ success: boolean; message: string }> {
  // Sanitize container ID — only allow alphanumeric and basic chars
  const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeId) {
    return { success: false, message: "Invalid container ID" };
  }

  if (!ALLOWED_CONTAINER_ACTIONS.includes(action)) {
    return { success: false, message: `Invalid action: ${action}` };
  }

  try {
    const output = await executeCommand(
      ssh,
      `docker ${action} ${safeId} 2>&1`,
      30_000 // Container ops can take longer
    );
    return { success: true, message: output || `Container ${action} successful` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// ─── Quick Server Actions ───

const QUICK_ACTION_COMMANDS: Record<string, string> = {
  "apt-update": "sudo apt update -y 2>&1",
  "docker-prune": "docker system prune -af 2>&1",
  "restart-docker": "sudo systemctl restart docker 2>&1",
};

/**
 * Run a predefined server maintenance action.
 * Only whitelisted commands are allowed.
 */
export async function quickAction(
  ssh: SSH2Promise,
  action: string
): Promise<{ success: boolean; output: string }> {
  const command = QUICK_ACTION_COMMANDS[action];
  if (!command) {
    return { success: false, output: `Unknown action: ${action}` };
  }

  try {
    const output = await executeCommand(ssh, command, 120_000); // Long timeout for apt/prune
    return { success: true, output };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: msg };
  }
}

// ─── Remote Deployment (SSH-based git clone) ───

export interface RemoteDeployResult {
  success: boolean;
  logs: string;
  commitHash: string;
}

/**
 * Deploy a git repository to a remote server via SSH.
 * Clones (or pulls) the repo at the specified path on the target server.
 * Returns the latest commit hash and deployment logs.
 *
 * Security: repoUrl is validated by the caller (API route).
 * customPath is sanitized to prevent directory traversal.
 */
export async function remoteDeployViaSSH(
  ssh: SSH2Promise,
  repoUrl: string,
  branch: string,
  customPath: string,
  envVarsDecrypted?: string
): Promise<RemoteDeployResult> {
  const logs: string[] = [];

  // Sanitize customPath — prevent traversal and command injection
  const safePath = customPath
    .replace(/[;&|`$(){}!#]/g, "") // strip shell metacharacters
    .replace(/\.\./g, "")          // prevent directory traversal
    .trim();

  if (!safePath || !safePath.startsWith("/")) {
    return {
      success: false,
      logs: "Invalid custom path. Must be an absolute path (e.g., /opt/apps/myapp).",
      commitHash: "",
    };
  }

  try {
    // 1. Ensure parent directory exists
    const parentDir = safePath.substring(0, safePath.lastIndexOf("/")) || "/";
    logs.push(`[1/5] Ensuring parent directory: ${parentDir}`);
    await executeCommand(ssh, `mkdir -p "${parentDir}"`, 15_000);

    // 2. Check if the target directory already has a .git folder (update vs fresh clone)
    const hasGit = await executeCommandSafe(
      ssh,
      `test -d "${safePath}/.git" && echo "exists" || echo "missing"`
    );

    if (hasGit.trim() === "exists") {
      // Pull latest changes
      logs.push(`[2/5] Repository exists at ${safePath} — pulling latest changes...`);
      const pullOutput = await executeCommand(
        ssh,
        `cd "${safePath}" && git fetch origin "${branch}" && git reset --hard "origin/${branch}" 2>&1`,
        120_000
      );
      logs.push(pullOutput);
    } else {
      // Fresh clone
      logs.push(`[2/5] Cloning ${repoUrl} (branch: ${branch}) to ${safePath}...`);
      const cloneOutput = await executeCommand(
        ssh,
        `git clone --depth 1 --branch "${branch}" "${repoUrl}" "${safePath}" 2>&1`,
        120_000
      );
      logs.push(cloneOutput);
    }

    // 3. Get commit hash
    logs.push(`[3/5] Retrieving commit hash...`);
    const commitHash = await executeCommand(
      ssh,
      `cd "${safePath}" && git rev-parse --short HEAD 2>/dev/null`,
      10_000
    );
    logs.push(`Commit: ${commitHash}`);

    // 4. Write .env file if envVars provided
    if (envVarsDecrypted) {
      logs.push(`[4/5] Writing environment variables to .env...`);
      // Use printf to safely write multi-line env vars without shell expansion
      // Base64-encode the content to avoid any shell interpretation issues
      const envBase64 = Buffer.from(envVarsDecrypted).toString("base64");
      await executeCommand(
        ssh,
        `echo "${envBase64}" | base64 -d > "${safePath}/.env"`,
        10_000
      );
      logs.push("Environment file written.");
    } else {
      logs.push(`[4/5] No environment variables to write — skipped.`);
    }

    // 5. Detect and run docker-compose if present
    const hasCompose = await executeCommandSafe(
      ssh,
      `test -f "${safePath}/docker-compose.yml" -o -f "${safePath}/docker-compose.yaml" -o -f "${safePath}/compose.yml" && echo "found" || echo "none"`
    );

    if (hasCompose.trim() === "found") {
      logs.push(`[5/5] Docker Compose file detected — building and starting...`);
      const composeOutput = await executeCommand(
        ssh,
        `cd "${safePath}" && docker compose up -d --build 2>&1`,
        300_000 // 5 min for build + start
      );
      logs.push(composeOutput);
    } else {
      logs.push(`[5/5] No Docker Compose file found — clone complete. Manual setup required.`);
    }

    return {
      success: true,
      logs: logs.join("\n"),
      commitHash: commitHash.trim(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logs.push(`\nERROR: ${msg}`);
    return {
      success: false,
      logs: logs.join("\n"),
      commitHash: "",
    };
  }
}

// ─── Container Logs ───

/**
 * Fetch recent logs from a Docker container.
 * Container name is sanitized to prevent injection.
 */
export async function getContainerLogs(
  ssh: SSH2Promise,
  containerIdOrName: string,
  lines: number = 100
): Promise<string> {
  const safeName = containerIdOrName.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeName) return "Invalid container identifier";

  const safeLines = Math.min(Math.max(1, lines), 5000); // Clamp between 1-5000

  try {
    return await executeCommand(
      ssh,
      `docker logs --tail ${safeLines} ${safeName} 2>&1`,
      30_000
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to fetch logs: ${msg}`;
  }
}
