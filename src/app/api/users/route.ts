import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import { passwordPolicyError } from "@/lib/password-policy";
import { getSecuritySettings } from "@/lib/security-settings";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// GET /api/users — List all users (ADMIN only)
export async function GET(): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Failed to load users") },
      { status: 500 }
    );
  }
}

// POST /api/users — Create a new user (ADMIN only)
export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const body = await request.json();
    const { username, password, role, displayName, email } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Username and password are required" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { success: false, error: "Username must be between 3 and 50 characters" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { success: false, error: "Username can only contain letters, numbers, dots, dashes, and underscores" },
        { status: 400 }
      );
    }

    const cleanEmail = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
    if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      return NextResponse.json(
        { success: false, error: "Invalid email address" },
        { status: 400 }
      );
    }

    const passwordError = passwordPolicyError(password, await getSecuritySettings());
    if (passwordError) {
      return NextResponse.json(
        { success: false, error: passwordError },
        { status: 400 }
      );
    }

    const validRoles = ["ADMIN", "OPERATOR", "VIEWER"];
    const userRole = validRoles.includes(role) ? role : "VIEWER";

    // Check if username already exists
    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, ...(cleanEmail ? [{ email: cleanEmail }] : [])] } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Username or email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: { username, email: cleanEmail, displayName: displayName?.trim() || null, passwordHash, role: userRole },
      select: { id: true, username: true, email: true, displayName: true, role: true, isActive: true, createdAt: true, updatedAt: true },
    });

    const ip = getClientIp(request);
    await auditLog({
      action: "user_created",
      userId: session.sub as string,
      username: session.username as string,
      ip,
      details: `Created user: ${username} (${userRole})`,
    });

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Failed to create user") },
      { status: 500 }
    );
  }
}
