import { NextRequest, NextResponse } from "next/server";
import { execLocal, execOnHost, isLocalServer } from "@/lib/local-server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type LogSource = "system" | "service" | "docker";

const MAX_LINES = 500;
const SAFE_NAME = /^[a-zA-Z0-9_.@/-]+$/;

function lineLimit(value: string | null) {
  const n = Number(value || 100);
  return Math.min(MAX_LINES, Math.max(20, Number.isFinite(n) ? n : 100));
}

function safeName(value: string | null) {
  if (!value || !SAFE_NAME.test(value)) return null;
  return value;
}

function redact(text: string) {
  return text
    .replace(/(password|passwd|pwd|token|secret|api[_-]?key|authorization|bearer)(\s*[:=]\s*)([^\s'"`]+)/gi, "$1$2[REDACTED]")
    .replace(/(https?:\/\/[^\s:]+:)([^@\s]+)(@)/gi, "$1[REDACTED]$3");
}

function buildCommand(source: LogSource, lines: number, name: string | null) {
  if (source === "system") return `journalctl -n ${lines} --no-pager --output=short-iso 2>&1`;
  if (!name) throw new Error(`${source} name is required`);
  if (source === "service") return `journalctl -u ${name} -n ${lines} --no-pager --output=short-iso 2>&1`;
  return `docker logs --tail ${lines} ${name} 2>&1`;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const source = (params.get("source") || "system") as LogSource;
    const lines = lineLimit(params.get("lines"));
    const name = safeName(params.get("name"));

    if (!["system", "service", "docker"].includes(source)) {
      return NextResponse.json({ success: false, error: "Invalid log source" }, { status: 400 });
    }

    const command = buildCommand(source, lines, name);
    const output = isLocalServer(id)
      ? source === "docker" ? execLocal(command, 20_000) : execOnHost(command, 20_000)
      : await (async () => {
          const result = await connectToServer(id);
          ssh = result.ssh;
          return executeCommand(ssh, command, 20_000);
        })();

    return NextResponse.json({ success: true, data: { output: redact(output || "No logs found.") } });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json({ success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Failed to read logs";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
