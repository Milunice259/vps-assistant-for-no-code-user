import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recreateContainer } from "../profiles/[profileId]/route";
import {
  isLocalAppId,
  parseLocalContainerId,
  execLocal,
  isLocalServer,
} from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface ApplyResult {
  applied: boolean;
  profileName: string | null;
  newContainerId: string | null;
  mergedCount: number;
}

// ─── POST — Apply or deactivate a profile ────────────────────────────────
//
//  { profileId: "xxx" }  → apply that profile (merge env + recreate)
//  { profileId: null }   → deactivate all profiles (revert to original)
//

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ApplyResult>>> {
  try {
    const { id: appId } = await context.params;
    const body = await request.json();
    const { profileId } = body as { profileId: string | null };

    // 1. Get runtime env (original)
    const runtimeEnv = await getRuntimeEnv(appId);

    if (!profileId) {
      // ── Deactivate all profiles → revert to original env ──
      await prisma.envProfile.updateMany({
        where: { appId },
        data: { isActive: false },
      });

      const result = await recreateContainer(appId, {});

      return NextResponse.json({
        success: true,
        data: {
          applied: true,
          profileName: null,
          newContainerId: result.newContainerId,
          mergedCount: Object.keys(runtimeEnv).length,
        },
      });
    }

    // ── Apply a specific profile ──
    const profile = await prisma.envProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    const profileVars: Record<string, string> = JSON.parse(profile.vars || "{}");

    // Deactivate all, then activate this one
    await prisma.$transaction([
      prisma.envProfile.updateMany({
        where: { appId },
        data: { isActive: false },
      }),
      prisma.envProfile.update({
        where: { id: profileId },
        data: { isActive: true },
      }),
    ]);

    // Recreate container with merged env
    const result = await recreateContainer(appId, profileVars);
    const mergedCount = Object.keys({ ...runtimeEnv, ...profileVars }).length;

    return NextResponse.json({
      success: true,
      data: {
        applied: true,
        profileName: profile.name,
        newContainerId: result.newContainerId,
        mergedCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply profile";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── Helper: Get runtime env from current container ──────────────────────

async function getRuntimeEnv(appId: string): Promise<Record<string, string>> {
  let containerId: string;

  if (isLocalAppId(appId)) {
    containerId = parseLocalContainerId(appId);
  } else if (appId.startsWith("discovered::local::")) {
    containerId = appId.split("::")[2] || "";
  } else {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      select: { containerId: true, serverId: true },
    });
    if (!app?.containerId) return {};
    containerId = app.containerId;
    if (!isLocalServer(app.serverId)) return {};
  }

  const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
  try {
    const raw = execLocal(`docker exec ${safeId} env 2>/dev/null`, 10_000);
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        env[line.slice(0, eqIdx)] = line.slice(eqIdx + 1).trim();
      }
    }
    return env;
  } catch {
    return {};
  }
}
