/**
 * SSH Connection Pool — reuse SSH connections with TTL-based eviction.
 *
 * Pools SSH connections by serverId to avoid reconnecting on every API request.
 * Connections are automatically evicted after 5 minutes of inactivity.
 * Maximum 10 concurrent connections to prevent resource exhaustion.
 */

import SSH2Promise from "ssh2-promise";
import { createSSHConnection, closeSSH, type SSHConnectionConfig } from "./connection";

interface PooledConnection {
  ssh: SSH2Promise;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout>;
}

const pool = new Map<string, PooledConnection>();

/** How long an idle connection lives before eviction (ms) */
const TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum concurrent pooled connections */
const MAX_POOL_SIZE = 10;

/**
 * Get or create a pooled SSH connection for a server.
 */
export async function getPooledConnection(
  serverId: string,
  config: SSHConnectionConfig
): Promise<SSH2Promise> {
  const existing = pool.get(serverId);

  if (existing) {
    // Refresh TTL
    clearTimeout(existing.timer);
    existing.lastUsed = Date.now();
    existing.timer = setTimeout(() => evictConnection(serverId), TTL_MS);
    return existing.ssh;
  }

  // Evict oldest if at capacity
  if (pool.size >= MAX_POOL_SIZE) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [key, conn] of pool) {
      if (conn.lastUsed < oldestTime) {
        oldestTime = conn.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) await evictConnection(oldestKey);
  }

  // Create new connection
  const ssh = await createSSHConnection(config);
  const timer = setTimeout(() => evictConnection(serverId), TTL_MS);

  pool.set(serverId, { ssh, lastUsed: Date.now(), timer });
  return ssh;
}

/**
 * Release (evict) a specific connection from the pool.
 */
export async function releaseConnection(serverId: string): Promise<void> {
  await evictConnection(serverId);
}

/**
 * Evict a connection from the pool and close it.
 */
async function evictConnection(serverId: string): Promise<void> {
  const entry = pool.get(serverId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pool.delete(serverId);
  await closeSSH(entry.ssh);
}

/**
 * Close all pooled connections. Called on graceful shutdown.
 */
export async function drainPool(): Promise<void> {
  const keys = [...pool.keys()];
  await Promise.allSettled(keys.map((k) => evictConnection(k)));
}

/**
 * Get pool statistics (for diagnostics).
 */
export function getPoolStats() {
  return {
    size: pool.size,
    maxSize: MAX_POOL_SIZE,
    ttlMs: TTL_MS,
    connections: [...pool.entries()].map(([id, c]) => ({
      serverId: id,
      idleMs: Date.now() - c.lastUsed,
    })),
  };
}

// Drain pool on process exit
if (typeof process !== "undefined") {
  const shutdown = () => { drainPool().catch(() => {}); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
