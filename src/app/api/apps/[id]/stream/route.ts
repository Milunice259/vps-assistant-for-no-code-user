import { authorizeApp } from "@/lib/app-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isLocalAppId, parseLocalContainerId, execLocal, isLocalServer } from "@/lib/local-server";
import { computeDelta } from "@/lib/sse-stream";
import { verifySessionToken } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface AppStreamData {
  status: string;
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  netIn: number;
  netOut: number;
  pids: number;
}


export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const token = request.cookies.get("vps-session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!token || !session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id: appId } = await context.params;
  const denied = await authorizeApp(appId, false);
  if (denied) return denied;
  const isDiscoveredLocal = appId.startsWith("discovered::local::");
  const isLocal = isLocalAppId(appId) || isDiscoveredLocal;
  // ponytail: this stream uses local Docker only; remote streaming needs an SSH fetcher.
  const serverId = isLocal || appId.startsWith("discovered::local::") ? "local"
    : (await prisma.app.findUnique({ where: { id: appId }, select: { serverId: true } }))?.serverId;
  if (!serverId || !isLocalServer(serverId)) {
    return NextResponse.json({ success: false, error: "Live stats stream is only supported for local containers" }, { status: 400 });
  }

  async function authorized() {
    const current = await verifySessionToken(token!);
    if (!current || current.sub !== session!.sub || !(await canAccessServer(current.sub, current.role, serverId!))) return false;
    if (!isLocal) {
      const target = await prisma.app.findUnique({ where: { id: appId }, select: { serverId: true } });
      if (!target || target.serverId !== serverId) return false;
    }
    return true;
  }
  if (!(await authorized())) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
  return localStatsResponse(request, authorized,
    async () => {
      // Resolve container ID — from DB or from local:: prefix
      let containerId: string | null = null;
      let status = "UNKNOWN";

      if (isLocal) {
        containerId = isDiscoveredLocal ? appId.split("::")[2] : parseLocalContainerId(appId);
        try {
          const state = execLocal(
            `docker inspect --format "{{.State.Status}}" ${containerId.replace(/[^a-zA-Z0-9_.-]/g, "")}`,
            5_000
          ).trim();
          status = state === "running" ? "RUNNING" : state === "exited" ? "STOPPED" : state.toUpperCase();
        } catch {
          status = "UNKNOWN";
        }
      } else {
        const app = await prisma.app.findUnique({
          where: { id: appId },
          select: { containerId: true, status: true, serverId: true },
        });
        if (!app || !isLocalServer(app.serverId)) throw new Error("Application target changed");
        containerId = app.containerId;
        status = app?.status ?? "UNKNOWN";
      }

      if (!containerId) {
        return { status, cpuPercent: 0, memUsageMB: 0, memLimitMB: 0, netIn: 0, netOut: 0, pids: 0 };
      }

      // Get live container stats
      try {
        const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
        const raw = execLocal(
          `docker stats ${safeId} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.PIDs}}"`,
          10_000
        );
        const parts = raw.trim().split("|");

        const cpuPercent = parseFloat(parts[0]?.replace("%", "") || "0");

        // Parse memory: "123.4MiB / 512MiB"
        const memParts = (parts[1] || "").split("/");
        const memUsageMB = parseMem(memParts[0] || "0");
        const memLimitMB = parseMem(memParts[1] || "0");

        // Parse network: "1.23kB / 4.56kB"
        const netParts = (parts[2] || "").split("/");
        const netIn = parseBytes(netParts[0] || "0");
        const netOut = parseBytes(netParts[1] || "0");

        // Parse PIDs count
        const pids = parseInt(parts[3]?.trim() || "0", 10) || 0;

        const result: AppStreamData = { status, cpuPercent, memUsageMB, memLimitMB, netIn, netOut, pids };

        // History is written only by the independent monitoring scheduler.

        return result;
      } catch {
        return {
          status,
          cpuPercent: 0,
          memUsageMB: 0,
          memLimitMB: 0,
          netIn: 0,
          netOut: 0,
          pids: 0,
        };
      }
    },
    10_000,  // check every 10s
    30_000   // heartbeat every 30s
  );
}

// This retained local-only stream fails closed; the shared fleet helper retries errors.
function localStatsResponse(request: NextRequest, authorized: () => Promise<boolean>, fetchData: () => Promise<AppStreamData>, intervalMs: number, heartbeatMs: number) {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let busy = false;
      let previous: AppStreamData | null = null;
      let lastSend = Date.now();
      const timer = setInterval(() => { void tick(); }, intervalMs);
      timer.unref?.();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) { cleanup(); return; }
      async function tick() {
        if (closed || busy) return;
        busy = true;
        try {
          if (!(await authorized())) { cleanup(); return; }
          if (closed || (controller.desiredSize || 0) <= 0) return;
          const next = await fetchData();
          // Recheck authorization after the live fetch before delivery.
          if (!(await authorized())) { cleanup(); return; }
          if (closed) return;
          const delta = previous ? computeDelta(previous, next) : next;
          const event = !previous ? "snapshot" : delta ? "delta" : Date.now() - lastSend >= heartbeatMs ? "heartbeat" : null;
          if (event) {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(delta || {})}\n\n`));
            lastSend = Date.now();
          }
          previous = next;
        } catch { cleanup(); }
        finally { busy = false; }
      }
      void tick();
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-store, no-transform",
    Vary: "Cookie",
    Connection: "keep-alive",
  } });
}

// ── Helpers ──

function parseMem(s: string): number {
  const trimmed = s.trim();
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  if (trimmed.includes("GiB")) return num * 1024;
  if (trimmed.includes("MiB")) return num;
  if (trimmed.includes("KiB")) return num / 1024;
  return num;
}

function parseBytes(s: string): number {
  const trimmed = s.trim();
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  if (trimmed.includes("GB")) return num * 1e9;
  if (trimmed.includes("MB")) return num * 1e6;
  if (trimmed.includes("kB")) return num * 1e3;
  if (trimmed.includes("B")) return num;
  return num;
}
