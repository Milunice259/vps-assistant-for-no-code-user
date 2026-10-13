import { authorizeApp } from "@/lib/app-access";
import { verifySessionToken } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { createLogRedactor, redactLogs } from "@/lib/log-redaction";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { connectToServer } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalServer } from "@/lib/local-server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
type LogChannel = NodeJS.ReadableStream & { destroy?: () => void; stderr: NodeJS.ReadableStream };
const MAX_BUFFER_BYTES = 256 * 1024;
const MAX_BUFFER_LINES = 1000;

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Retain the login that opened this stream, not timer-time request cookies.
  const token = request.cookies.get("vps-session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!token || !session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const denied = await authorizeApp(id, false);
  if (denied) return denied;

  const discovered = id.startsWith("discovered::") || id.startsWith("local::");
  const parts = id.split("::");
  const app = discovered ? null : await prisma.app.findUnique({ where: { id } });
  const serverId = discovered ? (parts[0] === "local" ? "local" : parts[1]) : app?.serverId;
  const containerRef = discovered ? parts[parts.length - 1] : app?.containerId || app?.containerName;
  if (!serverId || !containerRef) return NextResponse.json({ success: false, error: "App or container not found" }, { status: 404 });
  if (!/^[a-zA-Z0-9_.-]+$/.test(containerRef)) return NextResponse.json({ success: false, error: "Invalid container reference" }, { status: 400 });
  const requested = Number(new URL(request.url).searchParams.get("lines") || 200);
  const tail = Number.isFinite(requested) ? Math.min(5000, Math.max(10, Math.floor(requested))) : 200;

  async function authorized() {
    const current = await verifySessionToken(token!);
    if (!current || current.sub !== session!.sub || !(await canAccessServer(current.sub, current.role, serverId!))) return false;
    if (!discovered) {
      const target = await prisma.app.findUnique({ where: { id }, select: { serverId: true, containerId: true, containerName: true } });
      if (!target || target.serverId !== serverId || (target.containerId || target.containerName) !== containerRef) return false;
    }
    return true;
  }
  if (!(await authorized())) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });

  let cleanup = () => {};
  let drain: () => Promise<void> = async () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const buffer: Uint8Array[] = [];
      let bufferedBytes = 0;
      let closed = false;
      let ended = false;
      let flushing: Promise<void> | null = null;
      let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;
      let stopSource = () => {};
      const listeners: (() => void)[] = [];
      function listen<T extends unknown[]>(source: NodeJS.EventEmitter, event: string, handler: (...args: T) => void) {
        source.on(event, handler);
        listeners.push(() => source.removeListener(event, handler));
      }
      const timer = setInterval(() => { void flush(); }, 500);
      timer.unref?.();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        request.signal.removeEventListener("abort", cleanup);
        for (const remove of listeners) remove();
        stopSource();
        if (ssh) { void closeSSH(ssh).catch(() => {}); ssh = null; }
        buffer.length = 0;
        bufferedBytes = 0;
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) { cleanup(); return; }

      function addLine(line: string) {
        if (closed) return;
        const payload = encoder.encode(`data: ${JSON.stringify(redactLogs(line))}\n\n`);
        buffer.push(payload);
        bufferedBytes += payload.byteLength;
        while (buffer.length > MAX_BUFFER_LINES || bufferedBytes > MAX_BUFFER_BYTES) bufferedBytes -= buffer.shift()!.byteLength;
      }
      const stdout = createLogRedactor(addLine);
      const stderr = createLogRedactor(addLine);
      async function flush() {
        if (closed) return;
        if (flushing) { await flushing; return flush(); }
        flushing = deliver();
        try { await flushing; } finally { flushing = null; }
      }
      drain = () => buffer.length || ended ? flush() : Promise.resolve();
      async function deliver() {
        try {
          // Also check an idle stream. Fail closed on DB/auth verification errors.
          if (!(await authorized())) { cleanup(); return; }
          if (closed) return;
          if (buffer.length && (controller.desiredSize || 0) > 0) {
            const payload = new Uint8Array(bufferedBytes);
            let offset = 0;
            for (const line of buffer) { payload.set(line, offset); offset += line.byteLength; }
            buffer.length = 0;
            bufferedBytes = 0;
            // One authorized emission containing the usual per-line SSE events.
            controller.enqueue(payload);
          }
          if (ended && !buffer.length) cleanup();
        } catch { cleanup(); }
      }
      function finish(error?: Error) {
        if (closed || ended) return;
        stdout.end(); stderr.end();
        if (error) addLine(`[ERROR] ${error.message}`);
        ended = true;
        void flush();
      }
      function follow(out: NodeJS.ReadableStream, err: NodeJS.ReadableStream, source: NodeJS.EventEmitter) {
        listen(out, "data", (chunk: Buffer) => { if (!closed) stdout.write(chunk); });
        listen(err, "data", (chunk: Buffer) => { if (!closed) stderr.write(chunk); });
        listen(source, "close", () => finish());
        listen(source, "error", (error: Error) => finish(error));
      }
      void (async () => {
        try {
          if (isLocalServer(serverId)) {
            const child = spawn("docker", ["logs", "-f", "--tail", String(tail), containerRef], { stdio: ["ignore", "pipe", "pipe"] });
            stopSource = () => { child.kill(); };
            follow(child.stdout!, child.stderr!, child);
          } else {
            const connected = await connectToServer(serverId);
            if (closed) { await closeSSH(connected.ssh); return; }
            ssh = connected.ssh;
            if (!(await authorized()) || closed) { cleanup(); return; }
            const raw = (ssh as unknown as { ssh?: { connection?: { exec: (cmd: string, callback: (error: Error | null, channel: LogChannel) => void) => void } } }).ssh;
            if (raw?.connection?.exec) {
              raw.connection.exec(`docker logs -f --tail ${tail} ${containerRef} 2>&1`, (error, channel) => {
                if (closed) { channel?.destroy?.(); return; }
                if (error) { finish(error); return; }
                stopSource = () => { channel.destroy?.(); };
                follow(channel, channel.stderr, channel);
              });
            } else {
              const output = await executeCommand(ssh, `docker logs --tail ${tail} ${containerRef} 2>&1`, 30_000);
              if (!closed) { stdout.write(encoder.encode(output)); finish(); }
            }
          }
        } catch (error) { finish(error instanceof Error ? error : new Error("Stream failed")); }
      })();
    },
    pull() { return drain(); },
    cancel() { cleanup(); },
  }, { highWaterMark: MAX_BUFFER_BYTES, size: chunk => chunk.byteLength });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-store, no-transform",
    "Vary": "Cookie",
    Connection: "keep-alive",
  } });
}
