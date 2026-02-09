import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, getRemoteStats } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/[id]/stats - Fetch live system stats from a remote server via SSH.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  let ssh: Awaited<ReturnType<typeof createSSHConnection>> | null = null;

  try {
    const { id } = await context.params;

    const server = await prisma.server.findUnique({ where: { id } });

    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    // Decrypt credentials
    const password = server.encryptedPass
      ? decrypt(server.encryptedPass)
      : undefined;
    const privateKey = server.encryptedKey
      ? decrypt(server.encryptedKey)
      : undefined;

    // Connect via SSH
    ssh = await createSSHConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      password,
      privateKey,
    });

    const stats = await getRemoteStats(ssh);

    // Update last connected timestamp
    await prisma.server.update({
      where: { id },
      data: { lastConnected: new Date() },
    });

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch remote stats";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  } finally {
    await closeSSH(ssh);
  }
}
