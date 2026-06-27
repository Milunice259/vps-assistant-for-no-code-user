import { NextRequest, NextResponse } from "next/server";
import { createSSHConnection, closeSSH } from "@/lib/ssh";
import { detectRemoteServer, friendlyConnectionError, type ServerTestResult } from "@/lib/server-health";
import type { ApiResponse, CreateServerInput } from "@/types";

export const dynamic = "force-dynamic";

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
      return NextResponse.json({ success: true, data: await detectRemoteServer(ssh) });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    return NextResponse.json({
      success: true,
      data: { ok: false, message: friendlyConnectionError(error) },
    });
  }
}
