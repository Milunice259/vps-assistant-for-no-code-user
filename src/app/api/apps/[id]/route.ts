import { authorizeApp } from "@/lib/app-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalAppId, execLocal, tryExecOnHost } from "@/lib/local-server";
import { inspectedAppDetail, projectAppConfiguration } from "@/lib/app-configuration-projection";
import type { ApiResponse, AppDetailInfo, AppStatusType, ContainerStats, AppMetricInfo } from "@/types";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

// Tracking metadata is not evidence of applied resource settings or current runtime state.
function toAppDetail(app: {
  id: string; name: string; containerId: string | null; containerName: string | null;
  image: string | null; serverId: string; status: string; domain: string | null;
  createdAt: Date; updatedAt: Date; server: { name: string };
}): AppDetailInfo {
  return {
    id: app.id, name: app.name, containerId: app.containerId, containerName: app.containerName,
    image: app.image, serverId: app.serverId, serverName: app.server.name, status: "UNKNOWN",
    domain: app.domain, cpuLimit: null, memoryLimit: null, storageLimit: null,
    restartPolicy: null, healthCheck: null, volumes: null, ports: null,
    createdAt: app.createdAt.toISOString(), updatedAt: app.updatedAt.toISOString(),
  };
}

function parseDockerStats(raw: string): ContainerStats | null {
  const lines = raw.trim().split("\n").filter(Boolean);
  if (!lines.length) return null;
  const parts = lines[0].split(/\s+/);
  if (parts.length < 6) return null;
  const cpuPercent = parseFloat(parts[0]) || 0;
  const memParts = parts[1].split("/");
  const memUsageMB = parseMem(memParts[0]?.trim() || "0");
  const memLimitMB = parseMem(memParts[1]?.trim() || "0");
  const memPercent = parseFloat(parts[2]) || 0;
  const netInOut = parts[3].split("/");
  const netIn = parseBytes(netInOut[0]?.trim() || "0");
  const netOut = parseBytes(netInOut[1]?.trim() || "0");
  const pids = parseInt(parts[5], 10) || 0;
  return { cpuPercent, memUsageMB, memLimitMB, memPercent, netIn, netOut, pids };
}
function parseMem(s: string): number {
  const n = parseFloat(s);
  if (s.includes("GiB")) return n * 1024;
  if (s.includes("MiB")) return n;
  if (s.includes("KiB")) return n / 1024;
  if (s.includes("B")) return n / (1024 * 1024);
  return n;
}
function parseBytes(s: string): number {
  const n = parseFloat(s);
  if (s.includes("GB")) return n * 1e9;
  if (s.includes("MB")) return n * 1e6;
  if (s.includes("kB")) return n * 1e3;
  return n;
}

function getLocalServiceDetail(id: string, unit: string): AppDetailInfo | null {
  const safeUnit = unit.replace(/[^a-zA-Z0-9_.@-]/g, "");
  if (!safeUnit) return null;
  const raw = tryExecOnHost(`systemctl show ${safeUnit} --property=Id,Description,ActiveState,SubState,LoadState,UnitFileState,MainPID,ExecMainStartTimestamp,FragmentPath --no-pager`, 10_000);
  if (!raw.trim() || raw.includes("LoadState=not-found")) return null;
  const props = Object.fromEntries(raw.split("\n").map(line => {
    const idx = line.indexOf("=");
    return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
  }));
  const activeState = props.ActiveState || "unknown";
  return {
    id, name: unit.replace(/\.service$/, ""), appSource: "systemd", containerId: null,
    containerName: null, image: unit, serverId: "local", serverName: "This Server",
    status: activeState === "active" ? "RUNNING" : activeState === "inactive" ? "STOPPED" : "UNKNOWN",
    domain: null, cpuLimit: null, memoryLimit: null, storageLimit: null,
    restartPolicy: props.UnitFileState || null,
    healthCheck: `${props.ActiveState || "unknown"} / ${props.SubState || "unknown"}`,
    volumes: props.FragmentPath || null, ports: props.MainPID && props.MainPID !== "0" ? `Main PID: ${props.MainPID}` : null,
    createdAt: props.ExecMainStartTimestamp ? new Date(props.ExecMainStartTimestamp).toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** GET detail always inspects Docker before claiming runtime resource configuration. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<AppDetailInfo & { liveStats?: ContainerStats | null; metrics?: AppMetricInfo[] }>>> {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, false);
    if (denied) return denied;
    const url = new URL(request.url);
    const includeStats = url.searchParams.get("stats") === "true";
    const includeMetrics = url.searchParams.get("metrics") === "true";
    if (id.startsWith("local-service::")) {
      const detail = getLocalServiceDetail(id, decodeURIComponent(id.replace(/^local-service::/, "")));
      if (!detail) return NextResponse.json({ success: false, error: "System service not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: { ...detail, liveStats: null, metrics: [] } });
    }

    const virtual = isLocalAppId(id) || id.startsWith("discovered::");
    const app = virtual ? null : await prisma.app.findUnique({ where: { id }, include: { server: true } });
    if (!virtual && !app) return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
    let detail: AppDetailInfo;
    if (virtual || app?.containerId) {
      const { envTarget } = await import("@/lib/container-recreate");
      const target = await envTarget(id);
      try {
        const c = target.inspect;
        const initial = app ? toAppDetail(app) : {
          id, name: c.Name.slice(1), containerId: c.Id, containerName: c.Name.slice(1), image: c.Config.Image,
          serverId: target.serverId, serverName: target.serverId === "local" ? "This Server" : target.app?.server?.name || target.serverId,
          status: "UNKNOWN" as AppStatusType, domain: null, cpuLimit: null, memoryLimit: null, storageLimit: null,
          restartPolicy: null, healthCheck: null, volumes: null, ports: null, createdAt: c.Created, updatedAt: c.Created,
        };
        [detail] = await projectAppConfiguration([inspectedAppDetail(initial, c)]);
      } finally { await target.api.close(); }
    } else detail = toAppDetail(app!);

    let liveStats: ContainerStats | null = null;
    let metrics: AppMetricInfo[] | undefined;
    if (includeStats && detail.containerId) {
      const safeId = detail.containerId;
      const command = `docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}} {{.MemPerc}} {{.NetIO}} {{.PIDs}}' ${safeId} 2>/dev/null`;
      try {
        if (detail.serverId === "local") {
          liveStats = parseDockerStats(execLocal(command, 10_000).replace(/%/g, ""));
        } else if (app) {
          const server = app.server;
          const ssh = await createSSHConnection({ serverId: server.id, host: server.host, port: server.port,
            username: server.username, password: server.encryptedPass ? decrypt(server.encryptedPass) : undefined,
            privateKey: server.encryptedKey ? decrypt(server.encryptedKey) : undefined });
          try { liveStats = parseDockerStats((await executeCommand(ssh, command, 10_000)).replace(/%/g, "")); }
          finally { await closeSSH(ssh); }
        }
      } catch { /* Optional live stats unavailable. */ }
    }
    if (includeMetrics && app) {
      const dbMetrics = await prisma.appMetric.findMany({ where: { appId: id }, orderBy: { timestamp: "desc" }, take: 60 });
      metrics = dbMetrics.reverse().map(m => ({ id: m.id, cpuUsage: m.cpuUsage, memUsage: m.memUsage,
        netIn: m.netIn, netOut: m.netOut, timestamp: m.timestamp.toISOString() }));
    }
    return NextResponse.json({ success: true, data: { ...detail, liveStats, metrics: virtual ? [] : metrics } });
  } catch {
    // Executor/inspect errors can contain credentials; unavailable readback must not fall back to stored limits.
    return NextResponse.json({ success: false, error: "Application runtime inspection is unavailable. Reload the canonical configuration view before changing this app." }, { status: 503 });
  }
}

/** PATCH retains display-name tracking only; runtime edits require canonical preview/apply. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<AppDetailInfo>>> {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, true);
    if (denied) return denied;
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "Invalid app settings" }, { status: 400 });
    if (body.safeModeOff !== true) return NextResponse.json({ success: false, error: "Safe Mode is on. Turn it off before changing this app." }, { status: 423 });
    const runtimeFields = ["domain", "cpuLimit", "memoryLimit", "storageLimit", "restartPolicy", "healthCheck", "ports", "networks", "logDriver", "logMaxSize", "logMaxFiles", "maximumRetryCount", "routing"];
    if (runtimeFields.some(field => Object.hasOwn(body, field))) return NextResponse.json({ success: false,
      error: `Metadata-only resource/domain updates are not supported. Inspect GET /api/apps/${encodeURIComponent(id)}/configuration, then POST /api/apps/${encodeURIComponent(id)}/configuration with mode=preview, followed by mode=apply with the preview token and typed confirmation. No runtime change was applied.` }, { status: 409 });
    if (Object.keys(body).some(key => !["name", "safeModeOff"].includes(key)) || typeof body.name !== "string" || !body.name.trim() || body.name.length > 100 || /[\x00-\x1f]/.test(body.name)) return NextResponse.json({ success: false, error: "Provide a display name only (1–100 characters)" }, { status: 400 });
    const existing = await prisma.app.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
    if (existing.containerId) return NextResponse.json({ success: false, error: `POST /api/apps/${encodeURIComponent(id)}/configuration with mode=preview, then mode=apply to change this container's display name; adopted configuration is authoritative. No metadata or runtime change was applied.` }, { status: 409 });
    const app = await prisma.app.update({ where: { id }, data: { name: body.name.trim() }, include: { server: true } });
    return NextResponse.json({ success: true, data: toAppDetail(app) });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to update app display name" }, { status: 500 });
  }
}

/** DELETE removes only the app tracking record. */
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse>> {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, true);
    if (denied) return denied;
    if (request.headers.get("X-Safe-Mode-Off") !== "true") return NextResponse.json({ success: false, error: "Safe Mode is on. Turn it off before changing this app." }, { status: 423 });
    const existing = await prisma.app.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
    await prisma.app.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete app";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
