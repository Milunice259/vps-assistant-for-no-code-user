import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { closeSSH } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { detectLocalServer, detectRemoteServer, friendlyConnectionError, type ServerTestResult } from "@/lib/server-health";
import { isLocalServer } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<ServerTestResult>>> {
  let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    if (isLocalServer(id)) return NextResponse.json({ success: true, data: detectLocalServer() });

    const result = await connectToServer(id);
    ssh = result.ssh;
    return NextResponse.json({ success: true, data: await detectRemoteServer(ssh) });
  } catch (error) {
    return NextResponse.json({
      success: true,
      data: { ok: false, message: friendlyConnectionError(error) },
    });
  } finally {
    await closeSSH(ssh);
  }
}
