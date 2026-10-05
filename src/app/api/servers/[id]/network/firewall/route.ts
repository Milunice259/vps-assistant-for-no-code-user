import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { auditLog, getClientIp } from "@/lib/audit";
import { execOnHost, isLocalServer } from "@/lib/local-server";
import { canAccessServer } from "@/lib/server-access";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { operationResult, type OperationResult } from "@/lib/operation-result";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Body = { mode: "dry-run" | "apply"; action: "block-port" | "allow-port"; port: number; protocol: "tcp" | "udp"; safeModeOff?: boolean };
type FirewallRule = { number: number; action: string; target: string; from: string };

const CHECK_UFW = "command -v ufw >/dev/null 2>&1 || { echo 'ufw is not installed'; exit 3; }";

function parseRules(output: string): FirewallRule[] {
  return output.split("\n").map((line) => {
    const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
    return match ? { number: Number(match[1]), target: match[2].trim(), action: match[3].trim(), from: match[4].trim() } : null;
  }).filter((rule): rule is FirewallRule => Boolean(rule));
}

function planCommand({ action, port, protocol }: Body) {
  const ufw = action === "block-port" ? `ufw deny ${port}/${protocol}` : `ufw delete deny ${port}/${protocol} >/dev/null 2>&1 || true; ufw allow ${port}/${protocol}`;
  const rollback = action === "block-port" ? `ufw delete deny ${port}/${protocol}` : `ufw deny ${port}/${protocol}`;
  const label = action === "block-port" ? "Block public access" : "Allow public access";
  return { label, rollback, command: `${CHECK_UFW}; ${ufw} && ufw status numbered`, preview: `${label}: ${protocol.toUpperCase()} ${port}\nWould run: ${ufw}\nRollback: ${rollback}` };
}

async function runServerCommand(id: string, command: string, sshRef: { ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null }) {
  if (isLocalServer(id)) return execOnHost(command, 30_000);
  const result = await connectToServer(id);
  sshRef.ssh = result.ssh;
  return executeCommand(result.ssh, command, 30_000);
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<{ rules: FirewallRule[]; output: string }>>> {
  const sshRef: { ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null } = { ssh: null };
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const output = await runServerCommand(id, `${CHECK_UFW}; ufw status numbered`, sshRef);
    return NextResponse.json({ success: true, data: { rules: parseRules(output), output } });
  } catch (error) {
    if (isDisconnectedError(error)) return NextResponse.json({ success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" }, { status: 503 });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Firewall rules failed" }, { status: 500 });
  } finally {
    await closeSSH(sshRef.ssh);
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<OperationResult>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ success: false, error: "Expected a firewall action object" }, { status: 400 });
    }
    const body = input as Body;
    const { mode, action, protocol, port } = body;
    if (mode !== "dry-run" && mode !== "apply") return NextResponse.json({ success: false, error: "Mode must be dry-run or apply" }, { status: 400 });
    if (action !== "block-port" && action !== "allow-port") return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    if (protocol !== "tcp" && protocol !== "udp") return NextResponse.json({ success: false, error: "Protocol must be tcp or udp" }, { status: 400 });
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ success: false, error: "Port must be an integer from 1-65535" }, { status: 400 });
    if (body.safeModeOff !== undefined && typeof body.safeModeOff !== "boolean") return NextResponse.json({ success: false, error: "safeModeOff must be a boolean" }, { status: 400 });
    if (mode === "apply") {
      const safetyBlock = requireSafeModeOff(`firewall_${action}`, body);
      if (safetyBlock) return safetyBlock;
      if (action === "block-port") {
        if (port === 22) return NextResponse.json({ success: false, error: "Refusing to block SSH port 22 from the map" }, { status: 400 });
        // ponytail: local SSH may use includes/socket activation; block applies stay closed until reliable host management-port discovery exists.
        if (isLocalServer(id)) return NextResponse.json({ success: false, error: "Cannot safely determine local SSH ports; blocking is disabled" }, { status: 409 });
        const server = await prisma.server.findUnique({ where: { id }, select: { port: true } });
        if (!server || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535) {
          return NextResponse.json({ success: false, error: "Cannot safely determine the server SSH port; blocking is disabled" }, { status: 409 });
        }
        if (port === server.port) return NextResponse.json({ success: false, error: `Refusing to block configured SSH port ${server.port} from the map` }, { status: 400 });
      }
    }
    const { label, command, rollback, preview } = planCommand(body);

    let output = preview;
    if (mode === "apply") {
      const sshRef = { ssh };
      output = await runServerCommand(id, command, sshRef);
      ssh = sshRef.ssh;
    }

    await auditLog({
      action: "quick_action",
      userId: session.sub,
      username: session.username,
      ip: getClientIp(request),
      target: id,
      details: JSON.stringify({ mode, label, protocol, port, rollback, verified: mode === "apply" }),
    });

    return NextResponse.json({ success: true, data: operationResult({ message: mode === "apply" ? `${label} applied` : `${label} preview`, risk: mode === "apply" ? "danger" : "caution", verified: mode === "apply", rollback, output }) });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json({ success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Firewall action failed" }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
