import { getSession } from "@/lib/auth";
import { canAccessServer, normalizeRole } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { closeSSH, probeSSHIdentity, getSSHIdentity, sshIdentitySettingKey } from "@/lib/ssh";
import { prisma } from "@/lib/db";
import { connectToServer } from "@/lib/server-ssh";
import { detectLocalServer, detectRemoteServer, friendlyConnectionError, type ServerTestResult } from "@/lib/server-health";
import { isLocalServer } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
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

    const body = await request.json().catch(() => ({}));
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ success: false, error: "Server not found" }, { status: 404 });
    if (body.trust === true) {
      if (!["OWNER", "ADMIN"].includes(normalizeRole(session.role as string))) return NextResponse.json({ success: false, error: "Administrator access required to trust an SSH identity" }, { status: 403 });
      if (typeof body.fingerprint !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(body.fingerprint) || !(body.previousFingerprint === null || typeof body.previousFingerprint === "string")) {
        return NextResponse.json({ success: false, error: "An explicitly confirmed fingerprint and previous fingerprint are required" }, { status: 400 });
      }
      const observed = await probeSSHIdentity(server);
      if (observed !== body.fingerprint) return NextResponse.json({ success: false, error: "SSH identity changed since the test. Test again and verify the fingerprint." }, { status: 409 });
      const key = sshIdentitySettingKey(id);
      await prisma.$transaction(async (tx) => {
        const current = await tx.server.findUnique({ where: { id } });
        const row = await tx.appSetting.findUnique({ where: { key } });
        let previous = null;
        if (row) {
          const identity = JSON.parse(row.value);
          if (identity.host === server.host && identity.port === server.port) previous = identity.fingerprint;
        }
        if (!current || current.host !== server.host || current.port !== server.port || previous !== body.previousFingerprint) throw new Error("SSH trust settings changed. Test again before trusting.");
        const value = JSON.stringify({ host: server.host, port: server.port, fingerprint: observed });
        await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }, { isolationLevel: "Serializable" });
      if (await getSSHIdentity(id, server.host, server.port) !== observed) throw new Error("SSH trust could not be confirmed. Test again.");
    }
    const fingerprint = await probeSSHIdentity(server);
    const previousFingerprint = await getSSHIdentity(id, server.host, server.port);
    if (fingerprint !== previousFingerprint) {
      return NextResponse.json({ success: true, data: { ok: false, fingerprint, previousFingerprint,
        identityStatus: previousFingerprint ? "changed" : "unverified",
        message: previousFingerprint ? "SSH host key changed. Verify the fingerprint with your provider before replacing trust." : "SSH identity is unverified. Verify the fingerprint independently, then explicitly trust it.",
      } });
    }
    const result = await connectToServer(id);
    ssh = result.ssh;
    return NextResponse.json({ success: true, data: { ...await detectRemoteServer(ssh), fingerprint, previousFingerprint, identityStatus: "verified" } });
  } catch (error) {
    return NextResponse.json({
      success: true,
      data: { ok: false, message: friendlyConnectionError(error) },
    });
  } finally {
    await closeSSH(ssh);
  }
}
