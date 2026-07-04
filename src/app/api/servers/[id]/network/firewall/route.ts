import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { execLocal, isLocalServer } from "@/lib/local-server";
import { canAccessServer } from "@/lib/server-access";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Body = { mode?: "dry-run" | "apply"; action?: "block-port" | "allow-port"; port?: number; protocol?: "tcp" | "udp" };

const SELF_LOCKOUT_PORTS = new Set([22]);

function planCommand({ mode, action, port, protocol }: Required<Body>) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be 1-65535");
  if (!['tcp', 'udp'].includes(protocol)) throw new Error("Protocol must be tcp or udp");
  if (!['block-port', 'allow-port'].includes(action)) throw new Error("Invalid action");
  if (mode === "apply" && action === "block-port" && SELF_LOCKOUT_PORTS.has(port)) throw new Error("Refusing to block SSH port 22 from the map");

  const ufw = action === "block-port"
    ? `ufw deny ${port}/${protocol}`
    : `ufw allow ${port}/${protocol}`;
  const label = action === "block-port" ? "Block public access" : "Allow public access";
  const check = "command -v ufw >/dev/null 2>&1 || { echo 'ufw is not installed'; exit 3; }";
  if (mode === "dry-run") return { label, command: `${check}; echo '${label}: ${protocol.toUpperCase()} ${port}'; echo 'Would run: ${ufw}'` };
  return { label, command: `${check}; ${ufw} && ufw status numbered` };
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
    const { label, command } = planCommand({ mode, action, port, protocol });

    const output = isLocalServer(id)
      ? execLocal(command, 30_000)
      : await (async () => {
          const result = await connectToServer(id);
          ssh = result.ssh;
          return executeCommand(ssh, command, 30_000);
        })();

    await auditLog({
      action: "quick_action",
      userId: session.sub,
      username: session.username,
      ip: getClientIp(request),
      target: id,
      details: `${mode} ${label}: ${protocol}/${port}`,
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
