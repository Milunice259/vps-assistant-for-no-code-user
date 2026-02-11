import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH } from "@/lib/ssh";
import SSH2Promise from "ssh2-promise";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Maximum lines buffered before dropping oldest */
const MAX_BUFFER_LINES = 1000;
/** Batch interval in milliseconds */
const BATCH_INTERVAL_MS = 500;

/**
 * GET /api/apps/[id]/logs/stream - Stream container logs via SSE.
 * Query: ?lines=200 (tail lines, default 200)
 *
 * Uses `docker logs -f --tail <N>` via SSH, streaming each line as an SSE event.
 * Includes backpressure: buffers up to MAX_BUFFER_LINES, drops oldest on overflow,
 * and batches output every BATCH_INTERVAL_MS.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  const url = new URL(request.url);
  const tailLines = parseInt(url.searchParams.get("lines") || "200", 10);

  const app = await prisma.app.findUnique({
    where: { id },
    include: { server: true },
  });

  if (!app || !app.containerId) {
    return new Response(
      JSON.stringify({ success: false, error: "App or container not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const server = app.server;
  const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
  const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;

  let ssh: SSH2Promise | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // ── Backpressure buffer ──
      const lineBuffer: string[] = [];
      let batchTimer: ReturnType<typeof setInterval> | null = null;

      function flushBuffer() {
        if (lineBuffer.length === 0) return;
        const lines = lineBuffer.splice(0, lineBuffer.length);
        for (const line of lines) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
          } catch {
            // Stream closed
          }
        }
      }

      function addLine(line: string) {
        lineBuffer.push(line);
        // Drop oldest lines if buffer exceeds max
        while (lineBuffer.length > MAX_BUFFER_LINES) {
          lineBuffer.shift();
        }
      }

      function cleanup() {
        if (batchTimer) {
          clearInterval(batchTimer);
          batchTimer = null;
        }
      }

      try {
        ssh = await createSSHConnection({
          host: server.host,
          port: server.port,
          username: server.username,
          password,
          privateKey,
        });

        const safeId = app.containerId!.replace(/[^a-zA-Z0-9_.-]/g, "");
        const safeTail = Math.min(Math.max(tailLines, 10), 5000);

        // Start batch flush timer
        batchTimer = setInterval(flushBuffer, BATCH_INTERVAL_MS);

        // Use SSH exec to run docker logs -f
        const rawSSH = (ssh as unknown as { ssh: { connection: { exec: (cmd: string, cb: (err: Error | null, stream: NodeJS.ReadableStream & { stderr: NodeJS.ReadableStream }) => void) => void } } }).ssh;

        if (rawSSH?.connection?.exec) {
          rawSSH.connection.exec(
            `docker logs -f --tail ${safeTail} ${safeId} 2>&1`,
            (err: Error | null, execStream: NodeJS.ReadableStream & { stderr: NodeJS.ReadableStream }) => {
              if (err) {
                addLine(`[ERROR] ${err.message}`);
                flushBuffer();
                cleanup();
                try { controller.close(); } catch { /* ok */ }
                return;
              }

              execStream.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf-8");
                const lines = text.split("\n");
                for (const line of lines) {
                  if (line.trim()) {
                    addLine(line);
                  }
                }
              });

              execStream.stderr.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf-8");
                const lines = text.split("\n");
                for (const line of lines) {
                  if (line.trim()) {
                    addLine(line);
                  }
                }
              });

              execStream.on("close", () => {
                flushBuffer();
                cleanup();
                try { controller.close(); } catch { /* ok */ }
                if (ssh) closeSSH(ssh);
              });

              // Handle client disconnect
              request.signal.addEventListener("abort", () => {
                try {
                  execStream.removeAllListeners();
                  cleanup();
                  if (ssh) closeSSH(ssh);
                  controller.close();
                } catch { /* ok */ }
              });
            }
          );
        } else {
          // Fallback: use executeCommand for non-streaming
          const { executeCommand } = await import("@/lib/ssh");
          const output = await executeCommand(
            ssh,
            `docker logs --tail ${safeTail} ${safeId} 2>&1`,
            30_000
          );
          for (const line of output.split("\n")) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
            } catch { /* ok */ }
          }
          cleanup();
          controller.close();
          await closeSSH(ssh);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Stream failed";
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(`[ERROR] ${msg}`)}\n\n`));
        } catch { /* ok */ }
        cleanup();
        try { controller.close(); } catch { /* ok */ }
        if (ssh) await closeSSH(ssh);
      }
    },

    cancel() {
      if (ssh) closeSSH(ssh);
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
