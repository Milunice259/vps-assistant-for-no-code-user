/**
 * Local server utility.
 *
 * Provides a virtual "local" server entry for the VPS where this app runs.
 * All APIs check `isLocalServer(id)` and use `execLocal()` instead of SSH.
 */

import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import type { ServerInfo } from "@/types";

/** The sentinel ID for the local server. */
export const LOCAL_SERVER_ID = "local";

/** Check whether a server ID refers to the local machine. */
export function isLocalServer(id: string | null | undefined): boolean {
  return id === LOCAL_SERVER_ID;
}

/**
 * Read the real host hostname.
 * Inside Docker, os.hostname() returns the container ID.
 * We try /etc/host_hostname (mounted from host) first, then os.hostname().
 */
function getHostHostname(): string {
  try {
    const hostname = fs.readFileSync("/etc/host_hostname", "utf-8").trim();
    if (hostname) return hostname;
  } catch {
    // Not mounted or not readable — fall back
  }
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
 * Uses double-quoted format string for cross-platform compatibility.
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
 * Get local systemd services (same format as getRemoteServices).
 */
export function getLocalServices() {
  try {
    const raw = execLocal(
      "systemctl list-units --type=service --all --no-pager --plain --no-legend",
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
  } catch (err) {
    console.warn(
      "[local-server] Service discovery failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

// ─── Local Quick Actions ───

const LOCAL_ACTION_COMMANDS: Record<string, string> = {
  "system-update":   "apt update -y && apt upgrade -y 2>&1",
  "docker-prune":    "docker system prune -af 2>&1",
  "restart-docker":  "systemctl restart docker 2>&1",
  "clear-apt-cache": "apt clean && apt autoclean 2>&1",
  "clear-logs":      "journalctl --vacuum-time=3d 2>&1",
  "check-disk":      "df -h 2>&1",
  "security-updates":"apt update -qq && apt list --upgradable 2>&1",
  "docker-stats":    "docker stats --no-stream --format \"table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\" 2>&1",
  "sync-time":       "timedatectl set-ntp true 2>&1; chronyc -a makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || echo 'NTP sync attempted'",
  "restart-server":  "reboot",
};

/**
 * Run a quick action locally using execLocal.
 * Returns { success, output }.
 */
export function localQuickAction(
  action: string
): { success: boolean; output: string } {
  const command = LOCAL_ACTION_COMMANDS[action];
  if (!command) {
    return { success: false, output: `Unknown action: ${action}` };
  }

  try {
    const output = execLocal(command, 120_000);
    return { success: true, output: output || "Done (no output)" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: msg };
  }
}
