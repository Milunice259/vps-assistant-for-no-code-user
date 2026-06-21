import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, getRemoteContainers, closeSSH } from "@/lib/ssh";
import { execLocal } from "@/lib/local-server";
import type {
  ApiResponse,
  AppInfo,
  AppStatusType,
  CreateAppInput,
} from "@/types";

export const dynamic = "force-dynamic";

/**
 * Map Docker container state string to AppStatus.
 */
function mapContainerState(state: string): AppStatusType {
  const s = state.toLowerCase();
  if (s === "running") return "RUNNING";
  if (s === "exited" || s === "dead" || s === "created") return "STOPPED";
  if (s === "restarting") return "RESTARTING";
  if (s === "unhealthy" || s === "paused") return "UNHEALTHY";
  return "UNKNOWN";
}

function extractDomainFromLabels(labels: string): string | null {
  const traefikRules = labels
    .split("\n")
    .filter((line) => /^traefik\.http\.routers\.[^.]+\.rule=/.test(line));

  for (const rule of traefikRules) {
    const hosts = [...rule.matchAll(/Host\(([^)]*)\)/g)]
      .flatMap((match) => [...match[1].matchAll(/[`\"]([^`\"]+)[`\"]/g)].map((host) => host[1]))
      .filter((host) => !host.includes("/"));
    if (hosts.length > 0) return [...new Set(hosts)].join(", ");
  }

  const virtualHost = labels.match(/^VIRTUAL_HOST=([^\s\n]+)/m);
  return virtualHost?.[1] ?? null;
}

function getLocalContainerDomain(containerId: string): string | null {
  const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeId) return null;

  try {
    const labels = execLocal(
      `docker inspect --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\\n"}}{{end}}' ${safeId}`,
      5_000,
    );
    return extractDomainFromLabels(labels);
  } catch {
    return null;
  }
}

/**
 * Discover Docker containers on the local machine via `docker ps`.
 * Returns empty array if Docker is not available.
 */
function discoverLocalContainers(): AppInfo[] {
  try {
    // Use double-quoted format string for cross-platform compatibility
    // (single quotes fail on Windows PowerShell; 2>/dev/null fails on Windows)
    const fmt = "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Ports}}";
    const raw = execLocal(`docker ps -a --format "${fmt}"`, 10_000);

    if (!raw.trim()) return [];

    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line): AppInfo[] => {
        const [id, name, image, state] = line.split("\t");
        if (!id) return [];
        return [
          {
            id: `local::${id}`,
            name: name || image || id,
            appSource: "docker",
            containerId: id,
            containerName: name || null,
            image: image || null,
            serverId: "local",
            serverName: "This Server",
            status: mapContainerState(state || ""),
            domain: getLocalContainerDomain(id),
            createdAt: new Date().toISOString(),
          },
        ];
      });
  } catch (err) {
    console.warn(
      "[apps] Local Docker discovery failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

const SYSTEM_APP_PATTERN = /(hermes|9router|n8n|gooffi|leed|chat|node|pm2|uvicorn|gunicorn|traefik|nginx)/i;
const CORE_SERVICE_PATTERN = /^(systemd-|dbus|cron|ssh|docker|containerd|network|polkit|rsyslog|udev|apparmor|snapd)/i;

function discoverLocalSystemServices(): AppInfo[] {
  try {
    const raw = execLocal(
      "systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}'",
      10_000,
    );
    return raw
      .trim()
      .split("\n")
      .map((unit) => unit.trim())
      .filter(Boolean)
      .filter((unit) => SYSTEM_APP_PATTERN.test(unit) && !CORE_SERVICE_PATTERN.test(unit))
      .map((unit) => ({
        id: `local-service::${unit}`,
        name: unit.replace(/\.service$/, ""),
        appSource: "systemd" as const,
        containerId: null,
        containerName: null,
        image: unit,
        serverId: "local",
        serverName: "This Server",
        status: "RUNNING" as AppStatusType,
        domain: null,
        createdAt: new Date().toISOString(),
      }));
  } catch (err) {
    console.warn("[apps] Local systemd discovery failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * GET /api/apps - List all applications across all managed servers.
 *
 * This aggregates data from three sources:
 * 1. DB App records (manually tracked)
 * 2. Local Docker containers on the host machine
 * 3. Live Docker containers from each active server (discovered via SSH)
 *
 * DB records are merged with live data when container IDs match.
 * Containers not in the DB are included as "discovered" apps.
 */
export async function GET(): Promise<NextResponse<ApiResponse<AppInfo[]>>> {
  try {
    // Fetch all DB apps and all active servers in parallel
    const [dbApps, servers] = await Promise.all([
      prisma.app.findMany({ include: { server: true } }),
      prisma.server.findMany({ where: { isActive: true } }),
    ]);

    const allApps: AppInfo[] = [];
    const discoveredContainerIds = new Set<string>();

    // Add DB-tracked apps first
    for (const app of dbApps) {
      allApps.push({
        id: app.id,
        name: app.name,
        appSource: app.containerId ? "docker" : "manual",
        containerId: app.containerId,
        containerName: app.containerName,
        image: app.image,
        serverId: app.serverId,
        serverName: app.server.name,
        status: app.status as AppStatusType,
        domain: app.domain,
        createdAt: app.createdAt.toISOString(),
      });
      if (app.containerId) discoveredContainerIds.add(app.containerId);
    }

    // ── Discover LOCAL Docker containers (host machine) ──
    const localContainers = discoverLocalContainers();
    for (const lc of localContainers) {
      if (!lc.containerId) continue;

      const existing = allApps.find((app) => app.containerId === lc.containerId);
      if (existing) {
        existing.status = lc.status;
        existing.domain = existing.domain || lc.domain;
        continue;
      }

      allApps.push(lc);
      discoveredContainerIds.add(lc.containerId);
    }

    const localSystemServices = discoverLocalSystemServices();
    for (const serviceApp of localSystemServices) {
      const existing = allApps.find((app) => app.id === serviceApp.id || app.name === serviceApp.name);
      if (!existing) allApps.push(serviceApp);
    }

    // Discover live containers from each remote server
    for (const server of servers) {
      let ssh = null;
      try {
        const password = server.encryptedPass
          ? decrypt(server.encryptedPass)
          : undefined;
        const privateKey = server.encryptedKey
          ? decrypt(server.encryptedKey)
          : undefined;

        ssh = await createSSHConnection({
          host: server.host,
          port: server.port,
          username: server.username,
          password,
          privateKey,
        });

        const containers = await getRemoteContainers(ssh);

        for (const c of containers) {
          // Skip containers already tracked in DB
          if (discoveredContainerIds.has(c.id)) {
            // Update status for existing DB app
            const existing = allApps.find((a) => a.containerId === c.id);
            if (existing) {
              existing.status = mapContainerState(c.state);
            }
            continue;
          }

          allApps.push({
            id: `discovered::${server.id}::${c.id}`,
            name: c.name || c.image,
            appSource: "docker",
            containerId: c.id,
            containerName: c.name,
            image: c.image,
            serverId: server.id,
            serverName: server.name,
            status: mapContainerState(c.state),
            domain: null,
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        // Server is offline — mark its DB apps as UNKNOWN
        for (const app of allApps) {
          if (app.serverId === server.id && app.status !== "STOPPED") {
            app.status = "UNKNOWN";
          }
        }
      } finally {
        await closeSSH(ssh);
      }
    }

    return NextResponse.json({ success: true, data: allApps });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list applications";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/apps - Manually add a tracked application.
 * Body: { name, serverId, containerId?, containerName?, image?, domain? }
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<AppInfo>>> {
  try {
    const body = (await request.json()) as CreateAppInput;
    const { name, serverId, containerId, containerName, image, domain } = body;

    // Validate required fields
    if (!name || !serverId) {
      return NextResponse.json(
        { success: false, error: "name and serverId are required" },
        { status: 400 },
      );
    }

    // Verify the server exists
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 },
      );
    }

    // Create the app record
    const app = await prisma.app.create({
      data: {
        name,
        serverId,
        containerId: containerId ?? null,
        containerName: containerName ?? null,
        image: image ?? null,
        domain: domain ?? null,
        status: "UNKNOWN",
      },
      include: { server: true },
    });

    const data: AppInfo = {
      id: app.id,
      name: app.name,
      containerId: app.containerId,
      containerName: app.containerName,
      image: app.image,
      serverId: app.serverId,
      serverName: app.server.name,
      status: app.status as AppStatusType,
      domain: app.domain,
      createdAt: app.createdAt.toISOString(),
    };

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create application";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

