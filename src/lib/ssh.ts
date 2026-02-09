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
