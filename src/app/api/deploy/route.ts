import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { prepareDeployment } from "@/lib/deployer";
import type { ApiResponse, DeploymentInfo, DeployInput } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/deploy - List recent deployment logs.
 */
export async function GET(): Promise<
  NextResponse<ApiResponse<DeploymentInfo[]>>
> {
  try {
    const logs = await prisma.deploymentLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const data: DeploymentInfo[] = logs.map((log) => ({
      id: log.id,
      repoUrl: log.repoUrl,
      branch: log.branch,
      detectedStack: log.detectedStack,
      status: log.status,
      logs: log.logs,
      domain: log.domain,
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list deployments";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/deploy - Start a new deployment.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<DeploymentInfo>>> {
  let logId: string | null = null;

  try {
    const body = (await request.json()) as DeployInput;
    const { repoUrl, branch = "main", domain } = body;

    if (!repoUrl) {
      return NextResponse.json(
        { success: false, error: "repoUrl is required" },
        { status: 400 }
      );
    }

    // Create initial deployment log record
    const logRecord = await prisma.deploymentLog.create({
      data: {
        repoUrl,
        branch,
        detectedStack: "unknown",
        status: "CLONING",
        logs: `Starting deployment of ${repoUrl} (branch: ${branch})...\n`,
        domain: domain ?? null,
      },
    });
    logId = logRecord.id;

    // Clone repo and detect stack
    const result = prepareDeployment(repoUrl, branch);

    // Update log with results
    const updated = await prisma.deploymentLog.update({
      where: { id: logId },
      data: {
        detectedStack: result.detectedStack,
        status: "BUILDING",
        logs:
          logRecord.logs +
          `Cloned to ${result.projectDir}\n` +
          `Detected stack: ${result.detectedStack}\n` +
          `Default port: ${result.port}\n`,
      },
    });

    const data: DeploymentInfo = {
      id: updated.id,
      repoUrl: updated.repoUrl,
      branch: updated.branch,
      detectedStack: updated.detectedStack,
      status: updated.status,
      logs: updated.logs,
      domain: updated.domain,
      createdAt: updated.createdAt.toISOString(),
    };

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Deployment failed";

    // Update status to FAILED if we already created a record
    if (logId) {
      try {
        await prisma.deploymentLog.update({
          where: { id: logId },
          data: {
            status: "FAILED",
            logs: { set: `Deployment failed: ${message}\n` },
          },
        });
      } catch {
        // Ignore update errors during failure handling
      }
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
