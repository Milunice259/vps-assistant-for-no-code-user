import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { adminRoles, canManageRole, normalizeRole } from "@/lib/server-access";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session?.sub) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const self = id === (session.sub as string);
    if (!self && !adminRoles.has(normalizeRole(session.role as string))) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const userBefore = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!userBefore) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    if (!self && !canManageRole(session.role as string, userBefore.role)) {
      return NextResponse.json({ success: false, error: "You cannot manage this user" }, { status: 403 });
    }

    const { enabled, passcode } = (await request.json()) as { enabled?: boolean; passcode?: string };
    const data: { passcodeEnabled: boolean; passcodeHash: string | null; passcodeUpdatedAt: Date | null } = {
      passcodeEnabled: Boolean(enabled),
      passcodeHash: null,
      passcodeUpdatedAt: null,
    };

    if (enabled) {
      if (!passcode || passcode.length < 4 || passcode.length > 32) {
        return NextResponse.json({ success: false, error: "Passcode must be 4-32 characters" }, { status: 400 });
      }
      data.passcodeHash = await hashPassword(passcode);
      data.passcodeUpdatedAt = new Date();
    }

    const user = await prisma.user.update({ where: { id }, data, select: { id: true, username: true, passcodeEnabled: true } });
    await auditLog({ action: enabled ? "passcode_enabled" : "passcode_disabled", userId: session.sub as string, username: session.username as string, target: user.username, ip: getClientIp(request) });
    return NextResponse.json({ success: true, data: { id: user.id, passcodeEnabled: user.passcodeEnabled } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to update passcode") }, { status: 500 });
  }
}
