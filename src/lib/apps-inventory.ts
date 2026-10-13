import type { AppInfo } from "@/types";

export type InventoryApp = AppInfo & {
  inventorySource?: "stored" | "live" | "cached";
  observedAt?: string | null;
};
export interface InventorySnapshot {
  apps: InventoryApp[];
  observedAt: string | null;
  reachable: boolean | null;
  docker: "available" | "unavailable";
  systemd: "available" | "unavailable";
}

// ponytail: process-local, bounded cache; persistence belongs with a future scheduler.
const snapshots = new Map<string, { revision: string; snapshot: InventorySnapshot }>();
export function cachedInventory(id: string, revision: string): InventorySnapshot | undefined {
  const entry = snapshots.get(id);
  return entry?.revision === revision ? entry.snapshot : undefined;
}
export function cacheInventory(id: string, revision: string, snapshot: InventorySnapshot): void {
  snapshots.delete(id);
  snapshots.set(id, { revision, snapshot });
  if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
}

/** Identity is server + runtime, never an app display name. Ambiguous prefixes stay separate. */
export function mergeInventory(stored: InventoryApp[], observed: InventoryApp[]): InventoryApp[] {
  const result = stored.map((app) => ({ ...app }));
  for (const app of observed) {
    const matches = result.filter((candidate) => candidate.serverId === app.serverId && (
      candidate.id === app.id || (candidate.containerId && app.containerId && (
        candidate.containerId === app.containerId || (/^[a-f0-9]{12,64}$/i.test(candidate.containerId) &&
          /^[a-f0-9]{12,64}$/i.test(app.containerId) &&
          (candidate.containerId.startsWith(app.containerId) || app.containerId.startsWith(candidate.containerId)))
      ))
    ));
    if (matches.length === 1) {
      Object.assign(matches[0], {
        status: app.status, domain: matches[0].domain || app.domain,
        inventorySource: app.inventorySource, observedAt: app.observedAt,
      });
    } else result.push({ ...app });
  }
  return result;
}

export function containerState(state: string): AppInfo["status"] {
  switch (state.toLowerCase()) {
    case "running": return "RUNNING";
    case "created": case "exited": case "dead": return "STOPPED";
    case "restarting": return "RESTARTING";
    case "paused": case "unhealthy": return "UNHEALTHY";
    default: return "UNKNOWN";
  }
}

export const DOCKER_INVENTORY_COMMAND = 'docker ps -a --no-trunc --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}"';
export const SERVICE_INVENTORY_COMMAND = "systemctl list-units --type=service --state=running --no-pager --no-legend --plain";
const SYSTEM_APP_PATTERN = /(hermes|9router|n8n|gooffi|leed|chat|node|pm2|uvicorn|gunicorn|traefik|nginx)/i;
const CORE_SERVICE_PATTERN = /^(systemd-|dbus|cron|ssh|docker|containerd|network|polkit|rsyslog|udev|apparmor|snapd)/i;

export function parseInventory(raw: string, kind: "docker" | "systemd", serverId: string, serverName: string, observedAt: string): InventoryApp[] {
  return raw.split("\n").filter((line) => line.trim()).flatMap((line): InventoryApp[] => {
    if (kind === "docker") {
      const fields = line.replace(/\r$/, "").split("\t");
      const [id, name, image, state] = fields;
      if (fields.length !== 4 || !/^[a-f0-9]{12,64}$/i.test(id) || !name || !image || !state) throw new Error("Malformed Docker inventory");
      return [{ id: serverId === "local" ? `local::${id}` : `discovered::${serverId}::${id}`, name,
        appSource: "docker", containerId: id, containerName: name, image, serverId, serverName,
        status: containerState(state), domain: null, createdAt: observedAt, inventorySource: "live", observedAt }];
    }
    const [unit, load, active, sub] = line.trim().replace(/^●\s*/, "").split(/\s+/);
    if (!unit?.endsWith(".service") || !load || !active || !sub) throw new Error("Malformed systemd inventory");
    if (!SYSTEM_APP_PATTERN.test(unit) || CORE_SERVICE_PATTERN.test(unit)) return [];
    return [{ id: serverId === "local" ? `local-service::${unit}` : `service::${serverId}::${unit}`,
      name: unit.replace(/\.service$/, ""), appSource: "systemd", containerId: null, containerName: null,
      image: unit, serverId, serverName, status: active === "active" ? "RUNNING" : "UNKNOWN",
      domain: null, createdAt: observedAt, inventorySource: "live", observedAt }];
  });
}
