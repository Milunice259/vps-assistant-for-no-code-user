import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/apps/[id]/env - Get decrypted environment variables.
 * Returns: { vars: Record<string, string> }
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ vars: Record<string, string> }>>> {
  try {
    const { id } = await context.params;

    const app = await prisma.app.findUnique({
      where: { id },
      select: { encryptedEnv: true },
    });

    if (!app) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    let vars: Record<string, string> = {};
    if (app.encryptedEnv) {
      try {
        vars = JSON.parse(decrypt(app.encryptedEnv));
      } catch {
        vars = {};
      }
    }

    return NextResponse.json({ success: true, data: { vars } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get env vars";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/apps/[id]/env - Update environment variables.
 * Body: { vars: Record<string, string> }
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse>> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const vars = body.vars as Record<string, string>;

    if (!vars || typeof vars !== "object") {
      return NextResponse.json(
        { success: false, error: "vars must be an object" },
        { status: 400 }
      );
    }

    const existing = await prisma.app.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    // Encrypt and store
    const encryptedEnv = Object.keys(vars).length > 0
      ? encrypt(JSON.stringify(vars))
      : null;

    await prisma.app.update({
      where: { id },
      data: { encryptedEnv },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update env vars";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
