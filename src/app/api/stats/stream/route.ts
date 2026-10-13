/** Local stats SSE: retain the opening login and check current local access. */
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { getHostStats, subscribeStats } from "@/lib/stats";
import type { SystemStats } from "@/lib/stats";
import { computeDelta } from "@/lib/sse-stream";

export const dynamic = "force-dynamic";
const INTERVAL_MS = 2_000;
const HEARTBEAT_MS = 30_000;

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.cookies.get("vps-session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!token || !session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessServer(session.sub, session.role, "local"))) return NextResponse.json({ success: false, error: "Local server access denied" }, { status: 403 });
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const unsubscribe = subscribeStats();
      let closed = false;
      let busy = false;
      let prev: SystemStats | null = null;
      let lastSend = Date.now();
      const interval = setInterval(() => { void tick(); }, INTERVAL_MS);
      interval.unref?.();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        request.signal.removeEventListener("abort", cleanup);
        unsubscribe();
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) { cleanup(); return; }
      async function tick() {
        if (closed || busy) return;
        busy = true;
        try {
          const current = await verifySessionToken(token!);
          if (!current || current.sub !== session!.sub || !(await canAccessServer(current.sub, current.role, "local"))) { cleanup(); return; }
          if (closed || (controller.desiredSize || 0) <= 0) return;
          let next: SystemStats;
          try { next = getHostStats(); } catch { return; }
          const delta = prev ? computeDelta(prev, next) : next;
          const event = !prev ? "snapshot" : delta ? "delta" : Date.now() - lastSend >= HEARTBEAT_MS ? "heartbeat" : null;
          if (event) {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(delta || {})}\n\n`));
            lastSend = Date.now();
          }
          prev = next;
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
