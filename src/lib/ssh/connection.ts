/**
 * SSH Connection Management — create, close, execute commands.
 *
 * IMPORTANT: Host keys are auto-accepted for automation.
 * ssh2 does NOT verify host keys unless you explicitly provide
 * a hostVerifier callback. By not setting one, all host keys
 * are accepted automatically — intentional for VPS automation.
 */

import SSH2Promise from "ssh2-promise";
import * as fs from "fs";
import * as crypto from "crypto";

export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/** Default timeouts (milliseconds) */
const SSH_READY_TIMEOUT = 10_000;
export const SSH_COMMAND_TIMEOUT = 15_000;

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
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
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

  const knownHostsPath = process.env.SSH_KNOWN_HOSTS_PATH;
  if (knownHostsPath) {
    try {
      const knownHosts = fs.readFileSync(knownHostsPath, "utf-8");
      sshConfig.hostVerifier = (keyHash: string) => {
        const hostPattern = config.host;
        const lines = knownHosts.split("\n").filter((l: string) => l.trim() && !l.startsWith("#"));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const hosts = parts[0];
          const keyData = parts[2];
          if (hosts.includes(hostPattern)) {
            const storedHash = crypto
              .createHash("md5")
              .update(Buffer.from(keyData, "base64"))
              .digest("hex");
            if (storedHash === keyHash || keyData === keyHash) return true;
          }
        }
        throw new Error(
          `SSH host key verification failed for ${config.host}. ` +
          `Host key not found in ${knownHostsPath}. ` +
          `Add the host key or unset SSH_KNOWN_HOSTS_PATH to auto-accept.`
        );
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`SSH_KNOWN_HOSTS_PATH file not found: ${knownHostsPath}`);
      }
      throw err;
    }
  }

  if (config.password) sshConfig.password = config.password;
  if (config.privateKey) sshConfig.privateKey = config.privateKey;

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
  try { await ssh.close(); } catch { /* Ignore */ }
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
export async function executeCommandSafe(
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
