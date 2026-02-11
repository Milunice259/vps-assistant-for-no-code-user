import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface HealthResult {
  status: "healthy" | "unhealthy" | "unknown";
  output: string;
  checkedAt: string;
  containerState: string;
}

/**
 * GET /api/apps/[id]/health - Run health check on the container.
 *
 * If app has a custom healthCheck command, runs it inside the container.
 * Otherwise checks container inspect health status.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<HealthResult>>> {
  try {
    const { id } = await context.params;

    const app = await prisma.app.findUnique({
      where: { id },
      include: { server: true },
    });

    if (!app) {
      return NextResponse.json(
        { success: false, error: "Application not found" },
        { status: 404 }
      );
    }

    if (!app.containerId) {
      return NextResponse.json({
        success: true,
        data: {
          status: "unknown",
          output: "No container ID",
          checkedAt: new Date().toISOString(),
          containerState: "unknown",
        },
      });
    }

    const server = app.server;
    const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
    const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;

    const ssh = await createSSHConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      password,
      privateKey,
    });

    try {
      const safeId = app.containerId.replace(/[^a-zA-Z0-9_.-]/g, "");

      // Get container state
      const stateOutput = await executeCommand(
        ssh,
        `docker inspect --format '{{.State.Status}}' ${safeId} 2>&1`,
        10_000
      );
      const containerState = stateOutput.trim();

      let status: "healthy" | "unhealthy" | "unknown" = "unknown";
      let output = "";

      if (containerState !== "running") {
        status = "unhealthy";
        output = `Container is ${containerState}`;
      } else if (app.healthCheck) {
        // Run custom health check inside container
        try {
          const escapedCmd = app.healthCheck.replace(/'/g, "'\\''");
          const checkOutput = await executeCommand(
            ssh,
            `docker exec ${safeId} sh -c '${escapedCmd}' 2>&1`,
            15_000
          );
          status = "healthy";
          output = checkOutput.trim() || "Health check passed";
        } catch {
          status = "unhealthy";
          output = "Health check command failed";
        }
      } else {
        // Check Docker's built-in health status
        const healthOutput = await executeCommand(
          ssh,
          `docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${safeId} 2>&1`,
          10_000
        );
        const dockerHealth = healthOutput.trim();

        if (dockerHealth === "healthy") {
          status = "healthy";
          output = "Docker health check: healthy";
        } else if (dockerHealth === "unhealthy") {
          status = "unhealthy";
          output = "Docker health check: unhealthy";
        } else {
          // No health check configured, just check if running
          status = containerState === "running" ? "healthy" : "unhealthy";
          output = `Container is ${containerState} (no health check configured)`;
        }
      }

      // Update app status based on health
      const appStatus = status === "healthy" ? "RUNNING" : status === "unhealthy" ? "UNHEALTHY" : "UNKNOWN";
      await prisma.app.update({
        where: { id },
        data: { status: appStatus },
      });

      return NextResponse.json({
        success: true,
        data: {
          status,
          output,
          checkedAt: new Date().toISOString(),
          containerState,
        },
      });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
