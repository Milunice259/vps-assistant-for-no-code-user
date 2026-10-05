import { decodeProfileVars, redactEnvVars, encodeProfileVars, mergeEnvVars } from "@/lib/env-profile";
import { authorizeApp } from "@/lib/app-access";
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
    const denied = await authorizeApp(appId, true);
    if (denied) return denied;

    const profiles = await prisma.envProfile.findMany({
      where: { appId },
      orderBy: { createdAt: "desc" },
    });

    const data: ProfileInfo[] = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      vars: redactEnvVars(decodeProfileVars(p.vars)),
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = "Failed to list profiles";
    return NextResponse.json({ success: false, error: message }, { status: (error as { statusCode?: number }).statusCode === 400 ? 400 : 500 });
  }
}

// ─── POST — Create a new profile ──────────────────────────────────────────

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ProfileInfo>>> {
  try {
    const { id: appId } = await context.params;
    const denied = await authorizeApp(appId, true);
    if (denied) return denied;
    const body = await request.json();
    if (body?.safeModeOff !== true) return NextResponse.json({ success: false, error: "Safe Mode is on. Turn it off before changing this app." }, { status: 423 });
    const { name, vars } = body as { name: string; vars: Record<string, string> };

    if (typeof name !== "string" || !name.trim()) {
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
        vars: encodeProfileVars(mergeEnvVars(vars ?? {})),
        isActive: false,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        name: profile.name,
        vars: redactEnvVars(decodeProfileVars(profile.vars)),
        isActive: profile.isActive,
        createdAt: profile.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = "Failed to create profile";
    return NextResponse.json({ success: false, error: message }, { status: (error as { statusCode?: number }).statusCode === 400 ? 400 : 500 });
  }
}
