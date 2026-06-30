import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, verifyPassword } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<{ unlocked: true }>>> {
  try {
    const session = await getSession();
    if (!session?.sub) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { passcode } = (await request.json()) as { passcode?: string };
    if (!passcode || passcode.length < 4 || passcode.length > 32) {
      return NextResponse.json({ success: false, error: "Invalid passcode" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.sub as string }, select: { id: true, username: true, passcodeEnabled: true, passcodeHash: true, isActive: true } });
    if (!user?.isActive || !user.passcodeEnabled || !user.passcodeHash) {
      return NextResponse.json({ success: false, error: "Passcode is not enabled" }, { status: 400 });
    }

    const ok = await verifyPassword(passcode, user.passcodeHash);
    if (!ok) {
      await auditLog({ action: "passcode_unlock_failed", userId: user.id, username: user.username, ip: getClientIp(request) });
      return NextResponse.json({ success: false, error: "Invalid passcode" }, { status: 401 });
    }

    await auditLog({ action: "passcode_unlock", userId: user.id, username: user.username, ip: getClientIp(request) });
    return NextResponse.json({ success: true, data: { unlocked: true } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to unlock") }, { status: 500 });
  }
}
