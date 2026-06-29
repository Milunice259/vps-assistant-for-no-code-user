import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { execLocal, execOnHost, isLocalServer } from "@/lib/local-server";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type LogSource = "system" | "service" | "docker";

const MAX_LINES = 1000;
const SAFE_NAME = /^[a-zA-Z0-9_.@/-]+$/;
const SINCE_VALUES = new Set(["15m", "1h", "6h", "24h", "7d"]);

function lineLimit(value: string | null) {
  const n = Number(value || 100);
  return Math.min(MAX_LINES, Math.max(20, Number.isFinite(n) ? n : 100));
}

function safeName(value: string | null) {
  if (!value || !SAFE_NAME.test(value)) return null;
  return value;
}

function sinceValue(value: string | null) {
  return value && SINCE_VALUES.has(value) ? value : "1h";
}

function dockerSince(value: string) {
  const amount = Number.parseInt(value, 10) || 1;
  if (value.endsWith("m")) return `${amount}m`;
  if (value.endsWith("d")) return `${amount * 24}h`;
  return `${amount}h`;
}

function journalSince(value: string) {
  if (value.endsWith("m")) return `${Number.parseInt(value, 10)} minutes ago`;
  if (value.endsWith("h")) return `${Number.parseInt(value, 10)} hours ago`;
  return `${Number.parseInt(value, 10)} days ago`;
}

function redact(text: string) {
  return text
    .replace(/(password|passwd|pwd|token|secret|api[_-]?key|authorization|bearer)(\s*[:=]\s*)([^\s'"`]+)/gi, "$1$2[REDACTED]")
    .replace(/(https?:\/\/[^\s:]+:)([^@\s]+)(@)/gi, "$1[REDACTED]$3");
}

function buildCommand(source: LogSource, lines: number, name: string | null, since: string) {
  if (source === "system") return `journalctl --since '${journalSince(since)}' -n ${lines} --no-pager --output=short-iso 2>&1`;
  if (!name) throw new Error(`${source} name is required`);
  if (source === "service") return `journalctl -u ${name} --since '${journalSince(since)}' -n ${lines} --no-pager --output=short-iso 2>&1`;
  return `docker logs --since ${dockerSince(since)} --tail ${lines} ${name} 2>&1`;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    const source = (params.get("source") || "system") as LogSource;
    const lines = lineLimit(params.get("lines"));
    const since = sinceValue(params.get("since"));
    const name = safeName(params.get("name"));

    if (!["system", "service", "docker"].includes(source)) {
      return NextResponse.json({ success: false, error: "Invalid log source" }, { status: 400 });
    }

    const command = buildCommand(source, lines, name, since);
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
