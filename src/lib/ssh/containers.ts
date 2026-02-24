/**
 * SSH Containers — Docker container listing and actions via SSH.
 */

import type SSH2Promise from "ssh2-promise";
import { executeCommand, executeCommandSafe } from "./connection";

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
      const parts = line.trim().split(/\s+/);
      const name = (parts[0] || "").replace(".service", "");
      const loadState = parts[1] || "";
      const activeState = parts[2] || "";
      const subState = parts[3] || "";
      const description = parts.slice(4).join(" ");
      return { name, loadState, activeState, subState, description };
    });
}

// ─── Container Actions ───

const ALLOWED_CONTAINER_ACTIONS = ["start", "stop", "restart"] as const;
export type ContainerAction = (typeof ALLOWED_CONTAINER_ACTIONS)[number];

/**
 * Perform a Docker container action (start/stop/restart).
 * Container ID is sanitized to prevent command injection.
 */
export async function containerAction(
  ssh: SSH2Promise,
  containerId: string,
  action: ContainerAction
): Promise<{ success: boolean; message: string }> {
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
      30_000
    );
    return { success: true, message: output || `Container ${action} successful` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

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

  const safeLines = Math.min(Math.max(1, lines), 5000);

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
