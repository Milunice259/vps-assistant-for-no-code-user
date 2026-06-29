import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getSession } from "@/lib/auth";
import { normalizeRole, scopedServerWhere } from "@/lib/server-access";
import { getLocalServerInfo } from "@/lib/local-server";
import type { ApiResponse, ServerInfo, CreateServerInput } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/servers - List all servers (without encrypted fields).
 * The local server is always injected as the first entry.
 */
export async function GET(): Promise<NextResponse<ApiResponse<ServerInfo[]>>> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const role = normalizeRole(session.role as string);
    const servers = await prisma.server.findMany({
      where: await scopedServerWhere(session.sub as string, role),
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        username: true,
        authMethod: true,
        isActive: true,
        lastConnected: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const dbServers: ServerInfo[] = servers.map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      authMethod: s.authMethod,
      isActive: s.isActive,
      lastConnected: s.lastConnected?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }));

    const data = role === "OWNER" || role === "ADMIN" ? [getLocalServerInfo(), ...dbServers] : dbServers;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list servers";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/servers - Create a new server.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<ServerInfo>>> {
  try {
    const body = (await request.json()) as CreateServerInput;
    const { name, host, port, username, authMethod, password, privateKey } =
      body;

    if (!name || !host || !username || !authMethod) {
      return NextResponse.json(
        {
          success: false,
          error: "name, host, username, and authMethod are required",
        },
        { status: 400 }
      );
    }

    // Encrypt sensitive credentials before storage
    const encryptedPass =
      password && authMethod === "PASSWORD" ? encrypt(password) : null;
    const encryptedKey =
      privateKey && authMethod === "KEY" ? encrypt(privateKey) : null;

    const server = await prisma.server.create({
      data: {
        name,
        host,
        port: port ?? 22,
        username,
        authMethod,
        encryptedPass,
        encryptedKey,
      },
    });

    const data: ServerInfo = {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: server.authMethod,
      isActive: server.isActive,
      lastConnected: server.lastConnected?.toISOString() ?? null,
      createdAt: server.createdAt.toISOString(),
    };

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create server";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
