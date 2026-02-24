import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface ProfileInfo {
  id: string;
  name: string;
  vars: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}

// ─── GET — List all profiles for this app ─────────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ProfileInfo[]>>> {
  try {
    const { id: appId } = await context.params;

    const profiles = await prisma.envProfile.findMany({
      where: { appId },
      orderBy: { createdAt: "desc" },
    });

    const data: ProfileInfo[] = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      vars: JSON.parse(p.vars || "{}"),
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list profiles";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── POST — Create a new profile ──────────────────────────────────────────

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ProfileInfo>>> {
  try {
    const { id: appId } = await context.params;
    const body = await request.json();
    const { name, vars } = body as { name: string; vars: Record<string, string> };

    if (!name?.trim()) {
      return NextResponse.json(
        { success: false, error: "Profile name is required" },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = await prisma.envProfile.findUnique({
      where: { appId_name: { appId, name: name.trim() } },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Profile "${name}" already exists` },
        { status: 409 }
      );
    }

    const profile = await prisma.envProfile.create({
      data: {
        appId,
        name: name.trim(),
        vars: JSON.stringify(vars || {}),
        isActive: false,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        name: profile.name,
        vars: JSON.parse(profile.vars),
        isActive: profile.isActive,
        createdAt: profile.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create profile";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
