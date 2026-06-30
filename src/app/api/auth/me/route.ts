import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse, UserInfo } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResponse<UserInfo>>> {
  try {
    const session = await getSession();

    if (!session?.sub) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, username: true, email: true, displayName: true, role: true, isActive: true, passcodeEnabled: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { id: user.id, username: user.username, email: user.email, displayName: user.displayName, role: user.role, passcodeEnabled: user.passcodeEnabled },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Failed to get user") },
      { status: 500 }
    );
  }
}
