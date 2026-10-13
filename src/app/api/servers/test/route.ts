import { NextRequest, NextResponse } from "next/server";
import { probeSSHIdentity, getSSHIdentity } from "@/lib/ssh";
import { getSession } from "@/lib/auth";
import { canAccessServer, normalizeRole } from "@/lib/server-access";
import { friendlyConnectionError, type ServerTestResult } from "@/lib/server-health";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<ServerTestResult>>> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["OWNER", "ADMIN"].includes(normalizeRole(session.role as string))) return NextResponse.json({ success: false, error: "Administrator access required" }, { status: 403 });
    const body = await request.json();
    const { host, port = 22, serverId } = body;
    if (serverId && !(await canAccessServer(session.sub as string, session.role as string, serverId))) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    const fingerprint = await probeSSHIdentity({ host, port });
    const previousFingerprint = serverId ? await getSSHIdentity(serverId, host, port) : null;
    const identityStatus = previousFingerprint === fingerprint ? "verified" : previousFingerprint ? "changed" : "unverified";
    return NextResponse.json({ success: true, data: {
      ok: false, fingerprint, previousFingerprint, identityStatus,
      message: identityStatus === "changed" ? "SSH host key changed. Verify the new fingerprint with your provider before replacing trust." : "Fingerprint received; not authenticated yet. Verify it independently before trusting.",
    } });
  } catch (error) {
    return NextResponse.json({ success: true, data: { ok: false, message: friendlyConnectionError(error) } });
  }
}
