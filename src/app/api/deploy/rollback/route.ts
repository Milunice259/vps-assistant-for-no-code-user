/**
 * API: /api/deploy/rollback
 * Re-deploy a previous successful deployment.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Only ADMIN can rollback
    if (session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }

    const body = await request.json();
    const { deploymentId } = body as { deploymentId: string };

    if (!deploymentId) {
      return NextResponse.json({ success: false, error: "deploymentId is required" }, { status: 400 });
    }

    // Find the deployment to rollback to
    const deployment = await prisma.deploymentLog.findUnique({
      where: { id: deploymentId },
      include: { server: true },
    });

    if (!deployment) {
      return NextResponse.json({ success: false, error: "Deployment not found" }, { status: 404 });
    }

    if (deployment.status !== "RUNNING") {
      return NextResponse.json(
        { success: false, error: "Can only rollback to successful deployments" },
        { status: 400 }
      );
    }

    // Create a new deployment log entry for the rollback
    const rollback = await prisma.deploymentLog.create({
      data: {
        repoUrl: deployment.repoUrl,
        branch: deployment.branch,
        detectedStack: deployment.detectedStack,
        status: "PENDING",
        logs: `Rollback to deployment ${deployment.id} (commit: ${deployment.commitHash || "unknown"})`,
        domain: deployment.domain,
        serverId: deployment.serverId,
        commitHash: deployment.commitHash,
        customPath: deployment.customPath,
        encryptedEnv: deployment.encryptedEnv,
      },
    });

    const ip = getClientIp(request);
    await auditLog({
      action: "deployment_rollback",
      userId: session.sub,
      username: session.username,
      target: deployment.repoUrl,
      details: `Rollback to deployment ${deployment.id}`,
      ip,
    });

    return NextResponse.json({
      success: true,
      data: {
        rollbackId: rollback.id,
        originalDeploymentId: deployment.id,
        repoUrl: deployment.repoUrl,
        branch: deployment.branch,
      },
      message: `Rollback initiated to deployment ${deployment.id}`,
    });
  } catch (error) {
    const msg = safeErrorMessage(error, "Rollback failed");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
