import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import { passwordPolicyError } from "@/lib/password-policy";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/users/[id] — Update user role or password (ADMIN only)
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await context.params;

    const body = await request.json();
    const { role, password } = body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const updateData: Record<string, string> = {};

    if (role) {
      const validRoles = ["ADMIN", "OPERATOR", "VIEWER"];
      if (!validRoles.includes(role)) {
        return NextResponse.json(
          { success: false, error: "Invalid role. Must be ADMIN, OPERATOR, or VIEWER" },
          { status: 400 }
        );
      }
      updateData.role = role;
    }

    if (password) {
      const passwordError = passwordPolicyError(password);
      if (passwordError) {
        return NextResponse.json(
          { success: false, error: passwordError },
          { status: 400 }
        );
      }
      updateData.passwordHash = await hashPassword(password);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: "No updates provided" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, role: true, createdAt: true },
    });

    const ip = getClientIp(request);
    await auditLog({
      action: "user_updated",
      userId: session.sub as string,
      username: session.username as string,
      ip,
      details: `Updated user: ${user.username} (${Object.keys(updateData).join(", ")})`,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Failed to update user") },
      { status: 500 }
    );
  }
}

// DELETE /api/users/[id] — Delete a user (ADMIN only)
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await context.params;

    // Prevent self-deletion
    if (id === (session.sub as string)) {
      return NextResponse.json(
        { success: false, error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id } });

    const ip = getClientIp(request);
    await auditLog({
      action: "user_deleted",
      userId: session.sub as string,
      username: session.username as string,
      ip,
      details: `Deleted user: ${user.username}`,
    });

    return NextResponse.json({ success: true, data: { deleted: user.username } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Failed to delete user") },
      { status: 500 }
    );
  }
}
