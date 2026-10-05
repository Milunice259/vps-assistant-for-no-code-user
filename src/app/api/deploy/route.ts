import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import {
  prepareDeployment,
  cleanupDeployDir,
  pruneOldDeployments,
} from "@/lib/deployer";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { remoteDeployViaSSH, closeSSH } from "@/lib/ssh";
import { validateRepoUrl, validateBranch, validatePath } from "@/lib/validation";
import { sanitizeLogs } from "@/lib/sanitize";
import type { ApiResponse, DeploymentInfo, DeployInput } from "@/types";

import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAccessServer, scopedServerWhere } from "@/lib/server-access";
import { requireSafeModeOff } from "@/lib/operation-safety";

export const dynamic = "force-dynamic";

/**
 * Fetch recent deployments list.
 * Exported so the SSE stream endpoint can reuse this.
 */
export async function getDeployments(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<DeploymentInfo[]> {
  const serverScope = await scopedServerWhere(session.sub as string, session.role as string);
  const localAllowed = await canAccessServer(session.sub as string, session.role as string, "local");
  const logs = await prisma.deploymentLog.findMany({
    where: {
      OR: [
        { serverId: serverScope.id ?? { not: "local" } },
        ...(localAllowed ? [{ serverId: null }, { serverId: "local" }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return logs.map((log) => ({
    id: log.id,
    repoUrl: log.repoUrl,
    branch: log.branch,
    detectedStack: log.detectedStack,
    status: log.status,
    logs: log.logs,
    domain: log.domain,
    serverId: log.serverId,
    commitHash: log.commitHash,
    customPath: log.customPath,
    createdAt: log.createdAt.toISOString(),
  }));
}

/**
 * GET /api/deploy - List recent deployment logs.
 */
export async function GET(): Promise<
  NextResponse<ApiResponse<DeploymentInfo[]>>
> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const data = await getDeployments(session);
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
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
 *
 * When serverId is provided: Deploys to the remote server via SSH (git clone + docker compose).
 * When serverId is omitted:  Clones locally for stack detection (original behavior).
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<DeploymentInfo>>> {
  let logId: string | null = null;
  let projectDir: string | null = null;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!can(session.role as string, "OPERATOR")) return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    const body = (await request.json()) as DeployInput & { safeModeOff?: boolean };
    const targetId = body.serverId ?? "local";
    if (typeof targetId !== "string" || !targetId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, targetId))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    const { repoUrl, branch = "main", domain, customPath, envVars } = body;
    const serverId = targetId === "local" ? undefined : targetId;
    if (serverId) {
      const safetyBlock = requireSafeModeOff("deploy_git", body);
      if (safetyBlock) return safetyBlock;
    }

    // ── Validate inputs at API boundary ──
    const urlCheck = validateRepoUrl(repoUrl);
    if (!urlCheck.valid) {
      return NextResponse.json(
        { success: false, error: urlCheck.reason },
        { status: 400 }
      );
    }

    const branchCheck = validateBranch(branch);
    if (!branchCheck.valid) {
      return NextResponse.json(
        { success: false, error: branchCheck.reason },
        { status: 400 }
      );
    }

    // If serverId provided, verify it exists
    if (serverId) {
      const server = await prisma.server.findUnique({ where: { id: serverId } });
      if (!server) {
        return NextResponse.json(
          { success: false, error: "Target server not found" },
          { status: 404 }
        );
      }
    }

    // Encrypt env vars if provided
    const encryptedEnv = envVars ? encrypt(envVars) : null;

    // ─── Remote Deployment (SSH) ───
    if (serverId) {
      if (!customPath) {
        return NextResponse.json(
          { success: false, error: "customPath is required for remote deployments" },
          { status: 400 }
        );
      }

      const pathCheck = validatePath(customPath);
      if (!pathCheck.valid) {
        return NextResponse.json(
          { success: false, error: pathCheck.reason },
          { status: 400 }
        );
      }

      // Create initial log record
      const logRecord = await prisma.deploymentLog.create({
        data: {
          repoUrl,
          branch,
          detectedStack: "unknown",
          status: "CLONING",
          logs: `Starting remote deployment of ${repoUrl} (branch: ${branch})...\n` +
            `Target: Remote server (${serverId})\n` +
            `Custom path: ${customPath}\n`,
          domain: domain ?? null,
          serverId,
          customPath,
          encryptedEnv,
        },
      });
      logId = logRecord.id;

      let ssh = null;
      try {
        const conn = await connectToServer(serverId);
        ssh = conn.ssh;

        // Decrypt env vars for the remote .env file
        const envVarsDecrypted = encryptedEnv ? decrypt(encryptedEnv) : undefined;

        const result = await remoteDeployViaSSH(
          ssh,
          repoUrl,
          branch,
          customPath,
          envVarsDecrypted
        );

        const finalStatus = result.success ? "RUNNING" : "FAILED";
        const updated = await prisma.deploymentLog.update({
          where: { id: logId },
          data: {
            status: finalStatus,
            commitHash: result.commitHash || null,
            logs: sanitizeLogs(logRecord.logs + result.logs),
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
          serverId: updated.serverId,
          commitHash: updated.commitHash,
          customPath: updated.customPath,
          createdAt: updated.createdAt.toISOString(),
        };

        return NextResponse.json(
          { success: result.success, data },
          { status: result.success ? 201 : 500 }
        );
      } catch (error) {
        if (isDisconnectedError(error)) {
          // Update log to FAILED
          if (logId) {
            await prisma.deploymentLog.update({
              where: { id: logId },
              data: { status: "FAILED", logs: sanitizeLogs(logRecord.logs + "\nServer is offline or unreachable.") },
            }).catch(() => {});
          }
          return NextResponse.json(
            { success: false, error: "Server is offline or unreachable", code: "DISCONNECTED" },
            { status: 503 }
          );
        }
        throw error; // Re-throw for the outer catch
      } finally {
        await closeSSH(ssh);
      }
    }

    // ─── Local Deployment (stack detection) ───
    const logRecord = await prisma.deploymentLog.create({
      data: {
        repoUrl,
        branch,
        detectedStack: "unknown",
        status: "CLONING",
        logs: `Starting deployment of ${repoUrl} (branch: ${branch})...\n` +
          `Target: Local\n`,
        domain: domain ?? null,
        serverId: null,
        customPath: null,
        encryptedEnv,
      },
    });
    logId = logRecord.id;

    // Clone repo and detect stack
    const result = prepareDeployment(repoUrl, branch);
    projectDir = result.projectDir;

    // Update log with results
    const updated = await prisma.deploymentLog.update({
      where: { id: logId },
      data: {
        detectedStack: result.detectedStack,
        status: "BUILDING",
        logs: sanitizeLogs(
          logRecord.logs +
          `Cloned to ${result.projectDir}\n` +
          `Detected stack: ${result.detectedStack}\n` +
          `Default port: ${result.port}\n`),
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
      serverId: updated.serverId,
      commitHash: updated.commitHash,
      customPath: updated.customPath,
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
  } finally {
    // Clean up the cloned directory (detection is done, no need to keep it)
    if (projectDir) {
      cleanupDeployDir(projectDir);
      // Only prune after authorized local analysis, never on denied requests.
      pruneOldDeployments();
    }
  }
}
