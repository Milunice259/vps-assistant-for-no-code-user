import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { passwordPolicyError } from "@/lib/password-policy";
import { getSecuritySettings } from "@/lib/security-settings";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session?.sub) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { displayName, email, currentPassword, newPassword } = await request.json();
    const data: { displayName?: string | null; email?: string | null; passwordHash?: string } = {};

    if (typeof displayName === "string") data.displayName = displayName.trim() || null;
    if (typeof email === "string") {
      const cleanEmail = email.trim().toLowerCase() || null;
      if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return NextResponse.json({ success: false, error: "Invalid email address" }, { status: 400 });
      }
      if (cleanEmail) {
        const existing = await prisma.user.findFirst({ where: { email: cleanEmail, NOT: { id: session.sub as string } } });
        if (existing) return NextResponse.json({ success: false, error: "Email already exists" }, { status: 409 });
      }
      data.email = cleanEmail;
    }

    if (newPassword) {
      if (!currentPassword) return NextResponse.json({ success: false, error: "Current password is required" }, { status: 400 });
      const user = await prisma.user.findUnique({ where: { id: session.sub as string }, select: { passwordHash: true } });
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return NextResponse.json({ success: false, error: "Current password is incorrect" }, { status: 400 });
      }
      const passwordError = passwordPolicyError(newPassword, await getSecuritySettings());
      if (passwordError) return NextResponse.json({ success: false, error: passwordError }, { status: 400 });
      data.passwordHash = await hashPassword(newPassword);
    }

    if (!Object.keys(data).length) return NextResponse.json({ success: false, error: "No updates provided" }, { status: 400 });

    const user = await prisma.user.update({
      where: { id: session.sub as string },
      data,
      select: { id: true, username: true, email: true, displayName: true, role: true, passcodeEnabled: true },
    });

    await auditLog({
      action: "user_updated",
      userId: session.sub as string,
      username: session.username as string,
      ip: getClientIp(request),
      details: Object.keys(data).filter((key) => key !== "passwordHash").join(", ") || "password",
    });

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to update profile") }, { status: 500 });
  }
}
