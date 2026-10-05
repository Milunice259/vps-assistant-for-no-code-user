import { authorizeApp } from "@/lib/app-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalServer, isLocalAppId, parseLocalContainerId, execLocal } from "@/lib/local-server";
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
 * GET /api/apps/[id]/health - Read Docker-native container health only.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<HealthResult>>> {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, false);
    if (denied) return denied;

    // ── Local container: run health check directly ──
    if (isLocalAppId(id)) {
      const containerId = parseLocalContainerId(id);
      const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");

      try {
        const stateOutput = execLocal(
          `docker inspect --format '{{.State.Status}}' ${safeId} 2>&1`,
          10_000
        );
        const containerState = stateOutput.trim();

        let status: HealthResult["status"] = "unknown";
        let output = "";

        if (containerState !== "running") {
          status = "unhealthy";
          output = `Container is ${containerState}`;
        } else {
          // Check Docker-native health
          const healthOutput = execLocal(
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
            status = "unknown";
            output = "Container is running (no health check configured)";
          }
        }

        return NextResponse.json({
          success: true,
          data: { status, output, checkedAt: new Date().toISOString(), containerState },
        });
      } catch {
        return NextResponse.json({
          success: true,
          data: {
            status: "unknown" as const,
            output: "Could not inspect container",
            checkedAt: new Date().toISOString(),
            containerState: "unknown",
          },
        });
      }
    }

    // ── DB-backed app ──
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

    const safeId = app.containerId.replace(/[^a-zA-Z0-9_.-]/g, "");

    // Helper to run a command locally or via SSH
    const runCmd = isLocalServer(app.serverId)
      ? (cmd: string, timeout?: number) => execLocal(cmd, timeout)
      : null;

    // If remote, set up SSH
    let ssh: Awaited<ReturnType<typeof createSSHConnection>> | null = null;
    if (!runCmd) {
      const server = app.server;
      const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
      const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;
      ssh = await createSSHConnection({
        host: server.host,
        port: server.port,
        username: server.username,
        password,
        privateKey,
      });
    }

    const exec = runCmd || ((cmd: string, timeout?: number) => executeCommand(ssh!, cmd, timeout));

    try {
      const stateOutput = await exec(
        `docker inspect --format '{{.State.Status}}' ${safeId} 2>&1`,
        10_000
      );
      const containerState = stateOutput.trim();

      let status: "healthy" | "unhealthy" | "unknown" = "unknown";
      let output = "";

      if (containerState !== "running") {
        status = "unhealthy";
        output = `Container is ${containerState}`;
      } else {
        const healthOutput = await exec(
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
          status = "unknown";
          output = `Container is ${containerState} (no health check configured)`;
        }
      }

      return NextResponse.json({
        success: true,
        data: { status, output, checkedAt: new Date().toISOString(), containerState },
      });
    } finally {
      if (ssh) await closeSSH(ssh);
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Health check failed" },
      { status: 500 }
    );
  }
}
