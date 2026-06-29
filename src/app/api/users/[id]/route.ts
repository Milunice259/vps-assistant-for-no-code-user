import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import { passwordPolicyError } from "@/lib/password-policy";
import { getSecuritySettings } from "@/lib/security-settings";
import { adminRoles, canManageRole, hasActiveOwner, normalizeRole } from "@/lib/server-access";
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
    if (!adminRoles.has(normalizeRole(session.role))) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await context.params;

    const body = await request.json();
    const { role, password, displayName, email, isActive, serverAccessMode, serverIds } = body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const updateData: { role?: "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"; passwordHash?: string; displayName?: string | null; email?: string | null; isActive?: boolean; serverAccessMode?: "ALL" | "SELECTED" } = {};
    if (!canManageRole(session.role as string, user.role) && id !== (session.sub as string)) {
      return NextResponse.json({ success: false, error: "You cannot manage this user" }, { status: 403 });
    }

    if (role) {
      const validRoles = session.role === "OWNER" ? ["ADMIN", "MANAGER", "VIEWER"] : ["MANAGER", "VIEWER"];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ success: false, error: "Invalid role for your account" }, { status: 400 });
      }
      if (user.role === "OWNER" && role !== "OWNER" && !(await hasActiveOwner(id))) {
        return NextResponse.json({ success: false, error: "At least one active owner is required" }, { status: 400 });
      }
      updateData.role = role;
    }

    if (typeof displayName === "string") updateData.displayName = displayName.trim() || null;

    if (typeof email === "string") {
      const cleanEmail = email.trim().toLowerCase() || null;
      if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return NextResponse.json(
          { success: false, error: "Invalid email address" },
          { status: 400 }
        );
      }
      if (cleanEmail) {
        const existingEmail = await prisma.user.findFirst({ where: { email: cleanEmail, NOT: { id } } });
        if (existingEmail) {
          return NextResponse.json(
            { success: false, error: "Email already exists" },
            { status: 409 }
          );
        }
      }
      updateData.email = cleanEmail;
    }

    if (typeof isActive === "boolean") {
      if (id === (session.sub as string) && !isActive) {
        return NextResponse.json(
          { success: false, error: "You cannot disable your own account" },
          { status: 400 }
        );
      }
      if (user.role === "OWNER" && !isActive && !(await hasActiveOwner(id))) {
        return NextResponse.json({ success: false, error: "At least one active owner is required" }, { status: 400 });
      }
      updateData.isActive = isActive;
    }

    if (serverAccessMode === "ALL" || serverAccessMode === "SELECTED") {
      updateData.serverAccessMode = role === "ADMIN" || user.role === "ADMIN" ? "ALL" : serverAccessMode;
    }

    if (password) {
      const passwordError = passwordPolicyError(password, await getSecuritySettings());
      if (passwordError) {
        return NextResponse.json(
          { success: false, error: passwordError },
          { status: 400 }
        );
      }
      updateData.passwordHash = await hashPassword(password);
    }

    const cleanServerIds = Array.isArray(serverIds) ? serverIds.filter((sid: unknown): sid is string => typeof sid === "string" ) : undefined;

    if (Object.keys(updateData).length === 0 && cleanServerIds === undefined) {
      return NextResponse.json({ success: false, error: "No updates provided" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (cleanServerIds !== undefined) {
        await tx.userServerAccess.deleteMany({ where: { userId: id } });
        if ((updateData.serverAccessMode ?? user.serverAccessMode) === "SELECTED") {
          await tx.userServerAccess.createMany({ data: [...new Set(cleanServerIds)].map((serverId) => ({ userId: id, serverId })) });
        }
      }
      return tx.user.update({
        where: { id },
        data: updateData,
        select: { id: true, username: true, email: true, displayName: true, role: true, serverAccessMode: true, isActive: true, createdAt: true, updatedAt: true, serverAccess: { select: { serverId: true } } },
      });
    });

    const ip = getClientIp(request);
    await auditLog({
      action: "user_updated",
      userId: session.sub as string,
      username: session.username as string,
      ip,
      details: `Updated user: ${user.username} (${Object.keys(updateData).filter((key) => key !== "passwordHash").join(", ")}${updateData.passwordHash ? ", password" : ""})`,
    });

    return NextResponse.json({ success: true, data: { ...updated, serverIds: updated.serverAccess.map((a) => a.serverId), serverAccess: undefined } });
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
    if (!adminRoles.has(normalizeRole(session.role))) {
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

    if (!canManageRole(session.role as string, user.role)) {
      return NextResponse.json({ success: false, error: "You cannot delete this user" }, { status: 403 });
    }
    if (user.role === "OWNER" && !(await hasActiveOwner(id))) {
      return NextResponse.json({ success: false, error: "At least one active owner is required" }, { status: 400 });
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
