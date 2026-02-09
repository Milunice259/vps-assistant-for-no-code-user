import { NextRequest } from "next/server";
import { getHostStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial snapshot immediately
      const initial = getHostStats();
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initial)}\n\n`)
      );

      // Push stats every 2 seconds
      const interval = setInterval(() => {
        // Stop if client disconnected
        if (request.signal.aborted) {
          clearInterval(interval);
          controller.close();
          return;
        }

        try {
          const stats = getHostStats();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(stats)}\n\n`)
          );
        } catch {
          // If stats collection fails, send an error event and continue
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: {"error":"Failed to collect stats"}\n\n`
            )
          );
        }
      }, 2000);

      // Clean up when the client disconnects
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
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
