/**
 * Shared helper to establish an SSH connection to a server by its ID.
 * Used by all /api/servers/[id]/* routes to avoid duplicating
 * the decrypt → connect → error-handle pattern.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, type SSHConnectionConfig } from "@/lib/ssh";
import type SSH2Promise from "ssh2-promise";

export interface ServerSSHResult {
  ssh: SSH2Promise;
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
  };
}

/**
 * Look up a server by ID, decrypt credentials, and open an SSH connection.
 * Throws descriptive errors that the caller can catch and format.
 */
export async function connectToServer(serverId: string): Promise<ServerSSHResult> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });

  if (!server) {
    const err = new Error("Server not found");
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  const password = server.encryptedPass
    ? decrypt(server.encryptedPass)
    : undefined;
  const privateKey = server.encryptedKey
    ? decrypt(server.encryptedKey)
    : undefined;

  const config: SSHConnectionConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    password,
    privateKey,
  };

  const ssh = await createSSHConnection(config);

  // Update last connected timestamp (fire and forget)
  prisma.server.update({
    where: { id: serverId },
    data: { lastConnected: new Date() },
  }).catch(() => { /* best-effort */ });

  return {
    ssh,
    server: {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
    },
  };
}

/**
 * Determine if an SSH error indicates the server is offline.
 */
export function isDisconnectedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("timed out") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("ehostunreach") ||
    msg.includes("econnreset")
  );
}
