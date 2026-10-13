/** SSH sessions require an enrolled identity; probes never authenticate. */

import SSH2Promise from "ssh2-promise";
import * as fs from "fs";
import * as crypto from "crypto";
import { Client } from "ssh2";
import { prisma } from "@/lib/db";

export const sshIdentitySettingKey = (serverId: string) => `ssh.identity.${serverId}`;
export const sshFingerprint = (key: Buffer) => `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

function validateEndpoint(host: string, port: number): void {
  if (typeof host !== "string" || !host || /[\s\0,\[\]]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid SSH host or port");
  }
}

export async function getSSHIdentity(serverId: string, host: string, port: number): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: sshIdentitySettingKey(serverId) } });
  if (!row) return null;
  try {
    const identity = JSON.parse(row.value);
    return identity.host === host && identity.port === port && /^SHA256:[A-Za-z0-9+/]{43}$/.test(identity.fingerprint) ? identity.fingerprint : null;
  } catch { return null; }
}

/** Exact entries only; no substring, wildcard, CA or hashed-host fallback. */
export function verifyKnownHost(contents: string, host: string, port: number, key: Buffer): boolean {
  const target = port === 22 ? host : `[${host}]:${port}`;
  let matches = false;
  for (const line of contents.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const marker = parts[0]?.startsWith("@") ? parts.shift() : undefined;
    if (parts.length < 3 || !parts[0].split(",").includes(target)) continue;
    const stored = Buffer.from(parts[2], "base64");
    if (!stored.equals(key) || stored.toString("base64") !== parts[2] || key.length < 4) continue;
    const typeLength = key.readUInt32BE(0);
    if (typeLength > key.length - 4 || key.subarray(4, 4 + typeLength).toString("utf8") !== parts[1]) continue;
    if (marker === "@revoked") return false;
    if (!marker) matches = true;
  }
  return matches;
}

/** Reject the handshake after capturing the public key, before user authentication. */
export function probeSSHIdentity(config: Pick<SSHConnectionConfig, "host" | "port">): Promise<string> {
  const port = config.port ?? 22;
  validateEndpoint(config.host, port);
  return new Promise((resolve, reject) => {
    const client = new Client();
    let fingerprint: string | undefined;
    const timer = setTimeout(() => { client.end(); reject(new Error("SSH identity probe timed out")); }, SSH_READY_TIMEOUT);
    const finish = () => {
      clearTimeout(timer);
      client.end();
      if (fingerprint) resolve(fingerprint);
      else reject(new Error("Could not read SSH identity. Check host, port and SSH availability."));
    };
    client.on("error", finish).on("close", finish);
    client.connect({ host: config.host, port, username: "", readyTimeout: SSH_READY_TIMEOUT,
      hostVerifier: (key: Buffer) => { fingerprint = sshFingerprint(key); return false; },
    });
  });
}

export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  serverId?: string;
  /** Only a fingerprint explicitly confirmed in the enrollment UI. */
  trustedFingerprint?: string;
}

/** Default timeouts (milliseconds) */
const SSH_READY_TIMEOUT = 10_000;
export const SSH_COMMAND_TIMEOUT = 15_000;

/**
 * Create and connect an SSH session.
 * Host keys must match an explicit fingerprint or configured known-host entry.
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

  const port = config.port ?? 22;
  validateEndpoint(config.host, port);
  const fingerprint = config.trustedFingerprint ?? (config.serverId ? await getSSHIdentity(config.serverId, config.host, port) : null);
  if (fingerprint !== null && fingerprint !== undefined && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
    throw new Error("Invalid trusted SSH fingerprint");
  }
  const knownHostsPath = process.env.SSH_KNOWN_HOSTS_PATH;
  let knownHosts: string | undefined;
  if (knownHostsPath) {
    try { knownHosts = fs.readFileSync(knownHostsPath, "utf-8"); }
    catch { throw new Error("SSH known-host policy unavailable. Ask an administrator to check its configuration."); }
  }
  if (!fingerprint && knownHosts === undefined) {
    throw new Error("SSH identity is unverified. Test the server and explicitly trust its fingerprint before connecting.");
  }
  let rejectedIdentity = false;
  sshConfig.reconnect = false;
  // No hostHash: installed ssh2 passes the raw public-key Buffer.
  sshConfig.hostVerifier = (key: Buffer) => {
    const accepted = (!fingerprint || sshFingerprint(key) === fingerprint) &&
      (knownHosts === undefined || verifyKnownHost(knownHosts, config.host, port, key));
    rejectedIdentity = !accepted;
    return accepted;
  };

  if (config.password) sshConfig.password = config.password;
  if (config.privateKey) sshConfig.privateKey = config.privateKey;

  // ssh2-promise caches by username/host/port, which would bypass a fresh policy.
  const ssh = new SSH2Promise(sshConfig, true);
  try { await ssh.connect(); return ssh; }
  catch {
    await closeSSH(ssh);
    throw new Error(rejectedIdentity ? "SSH host key changed or verification failed. Do not retry until the fingerprint is checked." : "SSH connection or authentication failed. Check the connection settings.");
  }
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
