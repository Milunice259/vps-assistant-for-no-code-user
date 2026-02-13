import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import { isLocalAppId, parseLocalContainerId, execLocal } from "@/lib/local-server";
import type { ApiResponse, AppActionType } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const ALLOWED_ACTIONS: AppActionType[] = ["start", "stop", "restart", "pull", "recreate"];

/**
 * POST /api/apps/[id]/actions - Perform container actions.
 * Body: { action: "start" | "stop" | "restart" | "pull" | "recreate" }
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ output: string }>>> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = body.action as AppActionType;

    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}` },
        { status: 400 }
      );
    }

    // ── Local container: use Docker socket directly (no SSH) ──
    if (isLocalAppId(id)) {
      const containerId = parseLocalContainerId(id);
      const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
      if (!safeId) {
        return NextResponse.json(
          { success: false, error: "Invalid container ID" },
          { status: 400 }
        );
      }

      try {
        let output = "";
        switch (action) {
          case "start":
          case "stop":
          case "restart":
            output = execLocal(`docker ${action} ${safeId} 2>&1`, 30_000);
            break;
          case "pull": {
            // Get image name from container
            const image = execLocal(
              `docker inspect --format "{{.Config.Image}}" ${safeId}`,
              5_000
            ).trim();
            if (!image) {
              return NextResponse.json(
                { success: false, error: "No image found for this container" },
                { status: 400 }
              );
            }
            output = execLocal(`docker pull ${image} 2>&1`, 120_000);
            break;
          }
          default:
            return NextResponse.json(
              { success: false, error: `Action '${action}' not supported for local containers` },
              { status: 400 }
            );
        }
        return NextResponse.json({
          success: true,
          data: { output: output.trim() || `${action} completed` },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Action failed";
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
      }
    }

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
      return NextResponse.json(
        { success: false, error: "No container ID associated with this app" },
        { status: 400 }
      );
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
      if (!safeId) {
        return NextResponse.json(
          { success: false, error: "Invalid container ID" },
          { status: 400 }
        );
      }

      let output = "";

      switch (action) {
        case "start":
        case "stop":
        case "restart":
          output = await executeCommand(ssh, `docker ${action} ${safeId} 2>&1`, 30_000);
          break;

        case "pull":
          if (!app.image) {
            return NextResponse.json(
              { success: false, error: "No image associated with this app" },
              { status: 400 }
            );
          }
          const safeImage = app.image.replace(/[;&|`$(){}!#]/g, "");
          output = await executeCommand(ssh, `docker pull ${safeImage} 2>&1`, 120_000);
          break;

        case "recreate": {
          // Stop + remove + recreate with resource limits
          output = await executeCommand(ssh, `docker stop ${safeId} 2>&1 || true`, 30_000);
          output += "\n" + await executeCommand(ssh, `docker rm ${safeId} 2>&1 || true`, 15_000);

          // Build run command with resource limits
          const runParts = ["docker run -d"];

          if (app.cpuLimit) runParts.push(`--cpus=${app.cpuLimit}`);
          if (app.memoryLimit) runParts.push(`--memory=${app.memoryLimit}m`);
          if (app.restartPolicy) runParts.push(`--restart=${app.restartPolicy}`);
          if (app.containerName) {
            const safeName = app.containerName.replace(/[^a-zA-Z0-9_.-]/g, "");
            runParts.push(`--name ${safeName}`);
          }

          // Parse ports
          if (app.ports) {
            try {
              const ports: string[] = JSON.parse(app.ports);
              for (const p of ports) {
                const safePort = p.replace(/[^0-9:\/a-z]/g, "");
                runParts.push(`-p ${safePort}`);
              }
            } catch { /* ignore */ }
          }

          // Parse volumes
          if (app.volumes) {
            try {
              const volumes: string[] = JSON.parse(app.volumes);
              for (const v of volumes) {
                const safeVol = v.replace(/[;&|`$(){}!#]/g, "");
                runParts.push(`-v ${safeVol}`);
              }
            } catch { /* ignore */ }
          }

          if (app.image) {
            const safeImg = app.image.replace(/[;&|`$(){}!#]/g, "");
            runParts.push(safeImg);
          }

          output += "\n" + await executeCommand(ssh, runParts.join(" ") + " 2>&1", 60_000);
          break;
        }
      }

      // Update app status after action
      const newStatus = action === "stop" ? "STOPPED" : action === "start" || action === "restart" || action === "recreate" ? "RUNNING" : undefined;
      if (newStatus) {
        await prisma.app.update({
          where: { id },
          data: { status: newStatus },
        });
      }

      return NextResponse.json({
        success: true,
        data: { output: output.trim() || `${action} completed` },
      });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
