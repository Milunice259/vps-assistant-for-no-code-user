import { NextRequest, NextResponse } from "next/server";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse, CreateServerInput } from "@/types";

export const dynamic = "force-dynamic";

interface ServerTestResult {
  ok: boolean;
  message: string;
  os?: string;
  docker?: boolean;
  systemd?: boolean;
}

function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();
  if (msg.includes("timed out") || msg.includes("etimedout")) return "Connection timed out. Check host, port, firewall, and whether SSH is open.";
  if (msg.includes("econnrefused")) return "SSH refused the connection. Check the SSH port and whether sshd is running.";
  if (msg.includes("authentication") || msg.includes("all configured authentication methods failed")) return "SSH authentication failed. Check username, password, or private key.";
  if (msg.includes("enotfound")) return "Host was not found. Check the server IP or domain.";
  return raw.replace(/password|private key|secret/gi, "credential");
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<ServerTestResult>>> {
  try {
    const body = (await request.json()) as CreateServerInput;
    const { host, port = 22, username, authMethod, password, privateKey } = body;

    if (!host || !username || !authMethod) {
      return NextResponse.json({ success: false, error: "host, username, and authMethod are required" }, { status: 400 });
    }
    if (authMethod === "PASSWORD" && !password) {
      return NextResponse.json({ success: false, error: "Password is required for password auth" }, { status: 400 });
    }
    if (authMethod === "KEY" && !privateKey) {
      return NextResponse.json({ success: false, error: "Private key is required for key auth" }, { status: 400 });
    }

    const ssh = await Promise.race([
      createSSHConnection({
        host,
        port,
        username,
        password: authMethod === "PASSWORD" ? password : undefined,
        privateKey: authMethod === "KEY" ? privateKey : undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSH test timed out after 12s")), 12_000)
      ),
    ]);

    try {
      const [os, dockerRaw, systemdRaw] = await Promise.all([
        executeCommand(ssh, "(source /etc/os-release 2>/dev/null && echo ${PRETTY_NAME:-$NAME}) || uname -s", 10_000),
        executeCommand(ssh, "command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1 && echo yes || echo no", 10_000),
        executeCommand(ssh, "command -v systemctl >/dev/null 2>&1 && echo yes || echo no", 10_000),
      ]);
      return NextResponse.json({
        success: true,
        data: {
          ok: true,
          message: "SSH connection works. Server checks completed.",
          os: os.trim() || "Linux",
          docker: dockerRaw.trim() === "yes",
          systemd: systemdRaw.trim() === "yes",
        },
      });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    return NextResponse.json({
      success: true,
      data: { ok: false, message: friendlyError(error) },
    });
  }
}
