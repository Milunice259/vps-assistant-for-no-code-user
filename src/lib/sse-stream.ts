/**
 * Server-side SSE stream utility with delta compression.
 *
 * Usage in a route handler:
 * ```ts
 * export async function GET() {
 *   return createSSEResponse(() => getMyData(), 10_000);
 * }
 * ```
 */

import { NextResponse } from "next/server";

export type DataFetcher<T> = () => Promise<T> | T;

/**
 * Deep-diff two objects and return only changed fields.
 * Returns `null` if objects are identical.
 */
export function computeDelta<T extends object>(
  prev: T,
  next: T
): Partial<T> | null {
  const delta: Record<string, unknown> = {};
  let hasChanges = false;

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(p), ...Object.keys(n)]);

  for (const key of allKeys) {
    const prevVal = p[key];
    const nextVal = n[key];

    // Both are objects — recurse
    if (
      prevVal !== null &&
      nextVal !== null &&
      typeof prevVal === "object" &&
      typeof nextVal === "object" &&
      !Array.isArray(prevVal) &&
      !Array.isArray(nextVal)
    ) {
      const nested = computeDelta(
        prevVal as Record<string, unknown>,
        nextVal as Record<string, unknown>
      );
      if (nested) {
        delta[key] = nested;
        hasChanges = true;
      }
      continue;
    }

    // Arrays — compare via JSON (simple but effective for small arrays)
    if (Array.isArray(prevVal) && Array.isArray(nextVal)) {
      if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
        delta[key] = nextVal;
        hasChanges = true;
      }
      continue;
    }

    // Primitives
    if (prevVal !== nextVal) {
      delta[key] = nextVal;
      hasChanges = true;
    }
  }

  return hasChanges ? (delta as Partial<T>) : null;
}

/**
 * Creates an SSE Response that streams data with delta compression.
 *
 * Protocol:
 * - `event: snapshot` — full data on first message
 * - `event: delta`    — only changed fields
 * - `event: heartbeat` — keepalive (every 30s if no data sent)
 */
export function createSSEResponse<T extends object>(
  fetchData: DataFetcher<T>,
  intervalMs: number = 10_000,
  heartbeatMs: number = 30_000
): NextResponse {
  let cancelled = false;
  let dataInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller closed
          cleanup();
        }
      }

      function cleanup() {
        cancelled = true;
        if (dataInterval) clearInterval(dataInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }

      // Send initial snapshot (retry up to 3 times on failure)
      let lastData: T;
      let snapshotSent = false;

      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          lastData = await fetchData();
          send("snapshot", lastData);
          snapshotSent = true;
          break;
        } catch (err) {
          if (attempt < 2) {
            // Wait before retry (1s, 2s)
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          } else {
            send("error", {
              message: err instanceof Error ? err.message : "Data fetch failed",
            });
          }
        }
      }

      if (!snapshotSent || cancelled) {
        cleanup();
        return;
      }

      let lastSendTime = Date.now();

      // Data polling interval — compute and send deltas
      dataInterval = setInterval(async () => {
        if (cancelled) return;

        try {
          const current = await fetchData();
          const delta = computeDelta(
            lastData as Record<string, unknown>,
            current as Record<string, unknown>
          );

          if (delta) {
            send("delta", delta);
            lastData = current;
            lastSendTime = Date.now();
          }
        } catch {
          // Swallow — keep stream alive
        }
      }, intervalMs);

      // Heartbeat — keep connection alive
      heartbeatInterval = setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastSendTime > heartbeatMs - 1000) {
          send("heartbeat", {});
          lastSendTime = Date.now();
        }
      }, heartbeatMs);
    },

    cancel() {
      cancelled = true;
      if (dataInterval) clearInterval(dataInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Nginx: disable proxy buffering
    },
  });
}
