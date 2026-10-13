import { authorizeServer } from "@/lib/app-access";
import { getSession } from "@/lib/auth";
import { canAccessServer, scopedServerWhere } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { execLocal, execOnHost } from "@/lib/local-server";
import { projectAppConfiguration } from "@/lib/app-configuration-projection";
import type {
  ApiResponse,
  AppInfo,
  CreateAppInput,
} from "@/types";

export const dynamic = "force-dynamic";

import {
  cachedInventory, cacheInventory, mergeInventory, parseInventory,
  DOCKER_INVENTORY_COMMAND, SERVICE_INVENTORY_COMMAND,
  type InventoryApp, type InventorySnapshot,
} from "@/lib/apps-inventory";

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
  if (!/^[a-f0-9]{12,64}$/i.test(containerId)) return null;
  const safeId = containerId;

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

function mergeObservedInventory(stored: InventoryApp[], observed: InventoryApp[]): InventoryApp[] {
  const merged = mergeInventory(stored, observed);
  const sameRuntime = (a: InventoryApp, b: InventoryApp) => a.serverId === b.serverId && !!a.containerId && !!b.containerId && /^[a-f0-9]{12,64}$/.test(a.containerId) && /^[a-f0-9]{64}$/.test(b.containerId) && b.containerId.startsWith(a.containerId);
  return merged.map(app => {
    const matches = observed.filter(candidate => sameRuntime(app, candidate));
    const live = matches.length === 1 ? matches[0] : null;
    // Carry the full observed identity through legacy-prefix tracking; ambiguity stays unprojected.
    return live && merged.filter(candidate => sameRuntime(candidate, live)).length === 1
      ? { ...app, containerId: live.containerId, containerName: live.containerName } : app;
  });
}

/** Fast cached inventory by default; remote execution requires literal liveRemote=true. */
export async function GET(request: NextRequest): Promise<NextResponse<ApiResponse<AppInfo[]>>> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const serverWhere = await scopedServerWhere(session.sub, session.role);
    const requestedServer = request.nextUrl.searchParams.get("serverId");
    if (requestedServer && !await canAccessServer(session.sub, session.role, requestedServer)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const canAccessLocal = (!requestedServer || requestedServer === "local") && await canAccessServer(session.sub, session.role, "local");
    const appWhere = requestedServer ? { serverId: requestedServer } : "id" in serverWhere
      ? { OR: [{ serverId: serverWhere.id }, ...(canAccessLocal ? [{ serverId: "local" }] : [])] } : {};
    const live = request.nextUrl.searchParams.get("liveRemote") === "true";
    const [dbApps, servers] = await Promise.all([
      prisma.app.findMany({ where: appWhere, include: { server: { select: { name: true } } } }),
      prisma.server.findMany({ where: requestedServer ? { AND: [serverWhere, { id: requestedServer }] } : serverWhere }),
    ]);
    let allApps: InventoryApp[] = dbApps.map((app) => ({
      id: app.id, name: app.name, appSource: app.containerId ? "docker" : "manual",
      containerId: app.containerId, containerName: app.containerName, image: app.image,
      serverId: app.serverId, serverName: app.server.name, status: "UNKNOWN",
      domain: app.domain, createdAt: app.createdAt.toISOString(), inventorySource: "stored", observedAt: null,
    }));
    const inventory: Array<{
      serverId: string; enabled: boolean; reachable: boolean | null;
      source: "live" | "cached" | "stored"; observedAt: string | null;
      docker: "available" | "unavailable"; systemd: "available" | "unavailable";
    }> = [];
    if (canAccessLocal) {
      const observedAt = new Date().toISOString();
      const local: InventorySnapshot = { apps: [], observedAt, reachable: null, docker: "unavailable", systemd: "unavailable" };
      for (const kind of ["docker", "systemd"] as const) {
        try {
          const raw = kind === "docker" ? execLocal(DOCKER_INVENTORY_COMMAND, 10_000) : execOnHost(SERVICE_INVENTORY_COMMAND, 10_000);
          const apps = parseInventory(raw, kind, "local", "This Server", observedAt);
          if (kind === "docker") for (const app of apps) app.domain = getLocalContainerDomain(app.containerId!);
          local.apps.push(...apps);
          local[kind] = "available";
        } catch { /* unavailable is not an empty successful observation */ }
      }
      allApps = mergeObservedInventory(allApps, local.apps);
      inventory.push({ serverId: "local", enabled: true, reachable: null, source: "live", observedAt,
        docker: local.docker, systemd: local.systemd });
    }
    // Sequential servers preserve the shared SSH connection policy and bound channel load.
    for (const server of servers) {
      if (server.id === "local") continue;
      const revision = server.updatedAt.toISOString();
      let snapshot = cachedInventory(server.id, revision);
      let source: "live" | "cached" | "stored" = snapshot ? "cached" : "stored";
      if (live && server.isActive) {
        let ssh = null;
        const observedAt = new Date().toISOString();
        const fresh: InventorySnapshot = { apps: [], observedAt, reachable: false, docker: "unavailable", systemd: "unavailable" };
        try {
          ssh = await createSSHConnection({ serverId: server.id, host: server.host, port: server.port,
            username: server.username, password: server.encryptedPass ? decrypt(server.encryptedPass) : undefined,
            privateKey: server.encryptedKey ? decrypt(server.encryptedKey) : undefined });
          fresh.reachable = true;
          // A command completion marker distinguishes silent nonzero exits from successful empty lists.
          for (const kind of ["docker", "systemd"] as const) {
            try {
              const command = kind === "docker" ? DOCKER_INVENTORY_COMMAND : SERVICE_INVENTORY_COMMAND;
              const output = await executeCommand(ssh, `${command} && printf '\\n__APPS_INVENTORY_OK__\\n'`, 10_000);
              const marker = "__APPS_INVENTORY_OK__";
              if (!(output === marker || output.endsWith(`\n${marker}`))) continue;
              fresh.reachable = true;
              fresh.apps.push(...parseInventory(output.slice(0, -marker.length).trim(), kind, server.id, server.name, observedAt));
              fresh[kind] = "available";
            } catch { /* preserve other independently successful sources */ }
          }
        } catch { /* cached identities remain visible, but never as current running observations */ }
        finally { try { await closeSSH(ssh); } catch { /* cleanup cannot discard successful readback */ } }
        if (snapshot) {
          const retained = snapshot.apps.filter((app) => fresh[app.appSource === "systemd" ? "systemd" : "docker"] === "unavailable")
            .map((app): InventoryApp => ({ ...app, status: "UNKNOWN", inventorySource: "cached" }));
          fresh.apps = mergeInventory(fresh.apps, retained);
        }
        snapshot = fresh;
        cacheInventory(server.id, revision, fresh);
        source = "live";
      }
      if (snapshot && server.isActive) allApps = mergeObservedInventory(allApps, snapshot.apps.map((app): InventoryApp => ({
        ...app, serverName: server.name, inventorySource: source === "cached" ? "cached" : app.inventorySource,
        // A cached observation is historical, not evidence that an app is currently running/stopped.
        status: source === "cached" ? "UNKNOWN" : app.status,
      })));
      inventory.push({ serverId: server.id, enabled: server.isActive,
        reachable: source === "live" ? snapshot!.reachable : null, source,
        observedAt: snapshot?.observedAt ?? null, docker: snapshot?.docker ?? "unavailable", systemd: snapshot?.systemd ?? "unavailable" });
    }
    allApps = await projectAppConfiguration(allApps);
    return NextResponse.json({ success: true, data: allApps, inventory }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to list applications" }, { status: 500 });
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
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["OWNER", "ADMIN", "MANAGER", "OPERATOR"].includes(session.role)) {
      return NextResponse.json({ success: false, error: "Operator access required" }, { status: 403 });
    }
    const body = (await request.json()) as CreateAppInput & { safeModeOff?: boolean };
    const { name, serverId, containerId, containerName, image, domain } = body;

    // Validate required fields
    if (typeof name !== "string" || !name.trim() || typeof serverId !== "string" || !serverId) {
      return NextResponse.json(
        { success: false, error: "name and serverId are required" },
        { status: 400 },
      );
    }

    const denied = await authorizeServer(serverId, true);
    if (denied) return denied;
    if (body?.safeModeOff !== true) return NextResponse.json({ success: false, error: "Safe Mode is on. Turn it off before changing this app." }, { status: 423 });

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
      status: app.status as AppInfo["status"],
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


