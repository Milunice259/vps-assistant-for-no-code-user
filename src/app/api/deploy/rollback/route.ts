/**
 * API: /api/deploy/rollback
 * Rollback execution is unavailable; retain authorization checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAccessServer } from "@/lib/server-access";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/safe-error";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Rollback requires an administrator and access to the deployment target.
    if (!can(session.role, "ADMIN")) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const body = await request.json();
    const { deploymentId } = body as { deploymentId: string };

    if (typeof deploymentId !== "string" || !deploymentId.trim()) {
      return NextResponse.json({ success: false, error: "deploymentId is required" }, { status: 400 });
    }

    // Find the deployment to rollback to
    const deployment = await prisma.deploymentLog.findUnique({
      where: { id: deploymentId },
    });

    if (!deployment) {
      return NextResponse.json({ success: false, error: "Deployment not found" }, { status: 404 });
    }

    if (!(await canAccessServer(session.sub as string, session.role as string, deployment.serverId || "local"))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const safetyBlock = requireSafeModeOff("deploy_git", body);
    if (safetyBlock) return safetyBlock;

    return NextResponse.json(
      { success: false, code: "ROLLBACK_UNAVAILABLE", error: "Rollback is not supported. No deployment was started." },
      { status: 503 }
    );
  } catch (error) {
    const msg = safeErrorMessage(error, "Rollback failed");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
