/**
 * SSE stream for system stats — uses the shared SSE protocol.
 * Sends full snapshot on connect, then delta changes every 2s.
 *
 * The CPU sampler is subscribed/unsubscribed per-connection
 * so it only runs while at least one client is listening.
 */

import { NextRequest } from "next/server";
import { getHostStats, subscribeStats } from "@/lib/stats";
import type { SystemStats } from "@/lib/stats";
import { computeDelta } from "@/lib/sse-stream";

export const dynamic = "force-dynamic";

const INTERVAL_MS = 2_000;
const HEARTBEAT_MS = 30_000;

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to the CPU sampler
      unsubscribe = subscribeStats();

      let prev: SystemStats | null = null;
      let lastSendTime = Date.now();

      function send(event: string, data: unknown) {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
          lastSendTime = Date.now();
        } catch {
          // Controller closed
        }
      }

      // Send initial snapshot
      try {
        const initial = getHostStats();
        send("snapshot", initial);
        prev = initial;
      } catch {
        send("snapshot", getHostStats());
      }

      // Periodic delta updates
      const dataInterval = setInterval(() => {
        try {
          const next = getHostStats();
          if (!prev) {
            send("snapshot", next);
          } else {
            const delta = computeDelta(prev, next);
            if (delta) {
              send("delta", delta);
            }
          }
          prev = next;
        } catch {
          // Stats collection failed — skip this tick
        }
      }, INTERVAL_MS);

      // Heartbeat keepalive
      const heartbeatInterval = setInterval(() => {
        if (Date.now() - lastSendTime >= HEARTBEAT_MS) {
          send("heartbeat", {});
        }
      }, HEARTBEAT_MS);

      // Prevent timers from keeping process alive
      if (dataInterval && typeof dataInterval === "object" && "unref" in dataInterval) {
        dataInterval.unref();
      }
      if (heartbeatInterval && typeof heartbeatInterval === "object" && "unref" in heartbeatInterval) {
        heartbeatInterval.unref();
      }

      // Clean up on disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(dataInterval);
        clearInterval(heartbeatInterval);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
