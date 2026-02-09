import { NextRequest } from "next/server";
import { getHostStats, subscribeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

// ─── Shared broadcaster ───
// Instead of N independent setInterval timers (one per client),
// we use a single broadcaster that collects stats once every 2 s
// and fans out the JSON payload to all connected clients.

type Client = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

const clients = new Set<Client>();
let broadcastTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeStats: (() => void) | null = null;

function broadcast(): void {
  if (clients.size === 0) return;

  try {
    const stats = getHostStats();
    const payload = `data: ${JSON.stringify(stats)}\n\n`;

    for (const client of clients) {
      try {
        client.controller.enqueue(client.encoder.encode(payload));
      } catch {
        // Client probably disconnected — will be cleaned up by abort handler
        clients.delete(client);
      }
    }
  } catch {
    // Stats collection failed — send error event to all
    const errorPayload = `event: error\ndata: {"error":"Failed to collect stats"}\n\n`;
    for (const client of clients) {
      try {
        client.controller.enqueue(client.encoder.encode(errorPayload));
      } catch {
        clients.delete(client);
      }
    }
  }
}

function startBroadcaster(): void {
  if (broadcastTimer) return;
  // Register with the CPU sampler so it starts collecting
  unsubscribeStats = subscribeStats();
  broadcastTimer = setInterval(broadcast, 2000);
  if (broadcastTimer && typeof broadcastTimer === "object" && "unref" in broadcastTimer) {
    broadcastTimer.unref();
  }
}

function stopBroadcasterIfEmpty(): void {
  if (clients.size > 0) return;
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
  if (unsubscribeStats) {
    unsubscribeStats();
    unsubscribeStats = null;
  }
}

// ─── Route handler ───

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const client: Client = { controller, encoder };

      // Send initial snapshot immediately
      try {
        const initial = getHostStats();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initial)}\n\n`)
        );
      } catch {
        // Non-critical — the next broadcast will send data
      }

      // Register this client
      clients.add(client);
      startBroadcaster();

      // Clean up when the client disconnects
      request.signal.addEventListener("abort", () => {
        clients.delete(client);
        stopBroadcasterIfEmpty();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
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
