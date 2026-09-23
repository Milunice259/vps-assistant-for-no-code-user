import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { execOnHost, isLocalServer } from "@/lib/local-server";
import { canAccessServer } from "@/lib/server-access";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { requireSafeModeOff } from "@/lib/operation-safety";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Body = { mode?: "dry-run" | "apply"; action?: "block-port" | "allow-port"; port?: number; protocol?: "tcp" | "udp"; safeModeOff?: boolean };
type FirewallRule = { number: number; action: string; target: string; from: string };

const SELF_LOCKOUT_PORTS = new Set([22]);
const CHECK_UFW = "command -v ufw >/dev/null 2>&1 || { echo 'ufw is not installed'; exit 3; }";

function parseRules(output: string): FirewallRule[] {
  return output.split("\n").map((line) => {
    const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
    return match ? { number: Number(match[1]), target: match[2].trim(), action: match[3].trim(), from: match[4].trim() } : null;
  }).filter((rule): rule is FirewallRule => Boolean(rule));
}

function planCommand({ mode, action, port, protocol }: Required<Pick<Body, "mode" | "action" | "port" | "protocol">>) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be 1-65535");
  if (!["tcp", "udp"].includes(protocol)) throw new Error("Protocol must be tcp or udp");
  if (!["block-port", "allow-port"].includes(action)) throw new Error("Invalid action");
  if (mode === "apply" && action === "block-port" && SELF_LOCKOUT_PORTS.has(port)) throw new Error("Refusing to block SSH port 22 from the map");

  const ufw = action === "block-port" ? `ufw deny ${port}/${protocol}` : `ufw delete deny ${port}/${protocol} >/dev/null 2>&1 || true; ufw allow ${port}/${protocol}`;
  const rollback = action === "block-port" ? `ufw delete deny ${port}/${protocol}` : `ufw deny ${port}/${protocol}`;
  const label = action === "block-port" ? "Block public access" : "Allow public access";
  if (mode === "dry-run") return { label, rollback, command: `${CHECK_UFW}; echo '${label}: ${protocol.toUpperCase()} ${port}'; echo 'Would run: ${ufw}'; echo 'Rollback: ${rollback}'` };
  return { label, rollback, command: `${CHECK_UFW}; ${ufw} && ufw status numbered` };
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

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    const body = await request.json() as Body;
    const mode = body.mode || "dry-run";
    const action = body.action || "block-port";
    const protocol = body.protocol || "tcp";
    const port = Number(body.port);
    if (mode === "apply") {
      const safetyBlock = requireSafeModeOff(`firewall_${action}`, body);
      if (safetyBlock) return safetyBlock;
    }
    const { label, command, rollback } = planCommand({ mode, action, port, protocol });

    const sshRef = { ssh };
    const output = await runServerCommand(id, command, sshRef);
    ssh = sshRef.ssh;

    await auditLog({
      action: "quick_action",
      userId: session.sub,
      username: session.username,
      ip: getClientIp(request),
      target: id,
      details: `${mode} ${label}: ${protocol}/${port}; rollback: ${rollback}`,
    });

    return NextResponse.json({ success: true, data: { output } });
  } catch (error) {
    if (isDisconnectedError(error)) {
      return NextResponse.json({ success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Firewall action failed" }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
