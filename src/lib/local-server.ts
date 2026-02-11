/**
 * Local server utility.
 *
 * Provides a virtual "local" server entry for the VPS where this app runs.
 * All APIs check `isLocalServer(id)` and use `execLocal()` instead of SSH.
 */

import os from "os";
import { execSync } from "child_process";
import type { ServerInfo } from "@/types";

/** The sentinel ID for the local server. */
export const LOCAL_SERVER_ID = "local";

/** Check whether a server ID refers to the local machine. */
export function isLocalServer(id: string | null | undefined): boolean {
  return id === LOCAL_SERVER_ID;
}

/** Build a virtual ServerInfo for the local machine. */
export function getLocalServerInfo(): ServerInfo {
  return {
    id: LOCAL_SERVER_ID,
    name: `Local Server (${os.hostname()})`,
    host: "127.0.0.1",
    port: 0,
    username: os.userInfo().username,
    authMethod: "PASSWORD",
    isActive: true,
    lastConnected: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Execute a shell command locally. Equivalent to SSH executeCommand but local.
 * Returns stdout, throws on non-zero exit code.
 */
export function execLocal(command: string, timeoutMs = 30_000): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    // execSync throws on non-zero exit — extract stderr/stdout
    const e = error as { stderr?: string; stdout?: string; message?: string };
    const output = e.stderr || e.stdout || e.message || "Command failed";
    throw new Error(output.toString().trim());
  }
}

/**
 * Get local Docker containers (same format as getRemoteContainers).
 */
export function getLocalContainers() {
  try {
    const raw = execLocal(
      "docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.State}}' 2>/dev/null",
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
  } catch {
    return [];
  }
}

/**
 * Get local systemd services (same format as getRemoteServices).
 */
export function getLocalServices() {
  try {
    const raw = execLocal(
      "systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null",
      10_000
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
  } catch {
    return [];
  }
}
