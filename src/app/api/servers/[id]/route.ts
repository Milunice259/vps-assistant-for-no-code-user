import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { isLocalServer, getLocalServerInfo } from "@/lib/local-server";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse, ServerInfo, UpdateServerInput } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Helper to map a Prisma Server to the safe ServerInfo shape.
 */
function toServerInfo(s: {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "PASSWORD" | "KEY";
  isActive: boolean;
  lastConnected: Date | null;
  createdAt: Date;
}): ServerInfo {
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authMethod: s.authMethod,
    isActive: s.isActive,
    lastConnected: s.lastConnected?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * GET /api/servers/[id] - Get a single server (without encrypted fields).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ServerInfo>>> {
  try {
    const { id } = await context.params;
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    // Virtual local server
    if (isLocalServer(id)) {
      return NextResponse.json({ success: true, data: getLocalServerInfo() });
    }

    const server = await prisma.server.findUnique({
      where: { id },
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
    });

    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: toServerInfo(server) });
  } catch (error) {
    const message = safeErrorMessage(error, "Failed to get server");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/servers/[id] - Update a server.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ServerInfo>>> {
  try {
    const { id } = await context.params;
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    if (isLocalServer(id)) {
      return NextResponse.json(
        { success: false, error: "Cannot modify the local server" },
        { status: 400 }
      );
    }

    const body = (await request.json()) as UpdateServerInput;

    // Verify the server exists
    const existing = await prisma.server.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    // Build update payload, encrypting sensitive fields if provided
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.host !== undefined) updateData.host = body.host;
    if (body.port !== undefined) updateData.port = body.port;
    if (body.username !== undefined) updateData.username = body.username;
    if (body.authMethod !== undefined) updateData.authMethod = body.authMethod;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    if (body.password !== undefined) {
      updateData.encryptedPass = body.password ? encrypt(body.password) : null;
    }
    if (body.privateKey !== undefined) {
      updateData.encryptedKey = body.privateKey
        ? encrypt(body.privateKey)
        : null;
    }

    const server = await prisma.server.update({
      where: { id },
      data: updateData,
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
    });

    return NextResponse.json({ success: true, data: toServerInfo(server) });
  } catch (error) {
    const message = safeErrorMessage(error, "Failed to update server");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/servers/[id] - Delete a server.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  try {
    const { id } = await context.params;
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    if (isLocalServer(id)) {
      return NextResponse.json(
        { success: false, error: "Cannot delete the local server" },
        { status: 400 }
      );
    }

    const existing = await prisma.server.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    await prisma.server.delete({ where: { id } });

    // Audit log
    auditLog({
      action: "server_delete",
      target: id,
      details: `Deleted server: ${existing.name} (${existing.host})`,
      ip: getClientIp(_request),
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = safeErrorMessage(error, "Failed to delete server");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
