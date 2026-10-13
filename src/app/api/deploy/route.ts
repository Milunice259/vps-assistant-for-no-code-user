import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

import { execOnHost } from "@/lib/local-server";
import { deployGitCompose, readGitSource } from "@/lib/git-deployment";
import { readDeploymentDefinition } from "@/lib/deployment-state";
import { validateGitDeploy, type GitDeployInput } from "@/lib/ssh/deploy";
import type { DockerInput } from "@/lib/deploy-preflight";
import {
  prepareDeployment,
  cleanupDeployDir,
  pruneOldDeployments,
} from "@/lib/deployer";
import { connectToServer } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { validateRepoUrl, validateBranch, validateDomain } from "@/lib/validation";
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
      { success: false, error: sanitizeLogs(message) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/deploy - Analyze locally or deploy to a remote server.
 *
 * When serverId is provided: Deploys to the remote server via SSH (git clone + docker compose).
 * When serverId is omitted/local: Clones for stack detection only; no build or deployment.
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
    let body: DeployInput & { safeModeOff?: boolean };
    try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "Body must be an object" }, { status: 400 });
    const action = (body as DeployInput & { action?: string }).action;
    if (action !== undefined && action !== "analyze" && action !== "deploy") return NextResponse.json({ success: false, error: "Unknown repository action" }, { status: 400 });
    const options = body as DeployInput & GitDeployInput & { revision?: string; compose?: DockerInput };
    if ((options.composeDeploymentId !== undefined || options.compose?.composeMode === "update" || options.compose?.composeDeploymentId !== undefined) && !can(session.role as string, "ADMIN")) return NextResponse.json({ success: false, error: "Managed Git updates require Admin" }, { status: 403 });
    const targetId = body.serverId ?? "local";
    if (typeof targetId !== "string" || !targetId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, targetId))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }

    const { repoUrl, branch = "main", domain, customPath } = body;
    const serverId = action === "analyze" || targetId === "local" ? undefined : targetId;
    if (action === "deploy" || serverId) {
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

    // Validate the authorized target even for a read-only analysis request.
    if (targetId !== "local") {
      const server = await prisma.server.findUnique({ where: { id: targetId } });
      if (!server) {
        return NextResponse.json(
          { success: false, error: "Target server not found" },
          { status: 404 }
        );
      }
    }

    if (action === "deploy" || serverId) {
      if (!validateDomain(domain).valid || domain) return NextResponse.json({success:false,error:"Git domain routing requires a separately reviewed routing operation"},{status:400});
      const compose = options.compose || {type:"compose" as const,projectPath:customPath,serverId:targetId};
      if (compose.type !== "compose" || compose.projectPath !== customPath || (compose.serverId || "local") !== targetId || compose.composeDeploymentId !== options.composeDeploymentId || (compose.composeMode === "update") !== !!options.composeDeploymentId) return NextResponse.json({success:false,error:"Git and reviewed Compose targets/managed identities must match"},{status:400});
      const input = {...options,repoUrl,branch,customPath:customPath || "",serverId:targetId,compose};
      try { validateGitDeploy(input); } catch { return NextResponse.json({success:false,error:"Invalid Git source target or revision"},{status:400}); }
      if (!input.commitHash || !/^[a-f0-9]{64}$/.test(input.revision || "")) return NextResponse.json({success:false,error:"Run Git/Compose pre-flight before execution"},{status:409});
      const record = await prisma.deploymentLog.create({data:{repoUrl,branch,detectedStack:"git-compose",status:"CLONING",logs:"Canonical Git/Compose execution requested",serverId:targetId === "local" ? null : targetId,customPath:input.customPath}});
      logId = record.id;
      let connection:Awaited<ReturnType<typeof connectToServer>> | null = null;
      try {
        if (targetId !== "local") connection = await connectToServer(targetId);
        const conn = connection;
        const run = conn ? (command:string,timeout?:number)=>executeCommand(conn.ssh,command,timeout) : async (command:string,timeout?:number)=>execOnHost(command,timeout);
        const result = await deployGitCompose(run,input,record.id);
        const updated = await prisma.deploymentLog.update({where:{id:record.id},data:{status:result.status,commitHash:result.commitHash,logs:sanitizeLogs(result.logs)}});
        let completed = false;
        try {
          const source = await readGitSource(record.id,targetId);
          const definition = await readDeploymentDefinition(record.id);
          completed = source?.pending === false && source.source.commitHash === result.commitHash && source.source.customPath === input.customPath && definition?.state.serverId === targetId && !definition.state.pending;
        } catch { /* Readback failure is uncertain, not evidence that execution failed. */ }
        return NextResponse.json({success:result.success,data:{id:updated.id,repoUrl:updated.repoUrl,branch:updated.branch,detectedStack:updated.detectedStack,status:updated.status,logs:updated.logs,domain:updated.domain,serverId:updated.serverId,commitHash:updated.commitHash,customPath:updated.customPath,createdAt:updated.createdAt.toISOString(),pending:!completed,uncertain:!completed}},{status:result.success ? 201 : 202});
      } finally {if(connection) await closeSSH(connection.ssh);}
    }

    // ─── Local Repository Analysis (no build or deployment) ───
    const logRecord = await prisma.deploymentLog.create({
      data: {
        repoUrl,
        branch,
        detectedStack: "unknown",
        status: "CLONING",
        logs: `Starting repository analysis of ${repoUrl} (branch: ${branch})...\n` +
          `Target: Local analysis only\n`,
        domain: null,
        serverId: targetId === "local" ? null : targetId,
        customPath: null,
        encryptedEnv: null,
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
        status: "ANALYZED",
        logs: sanitizeLogs(
          logRecord.logs +
          `Temporary repository copy inspected; cleanup runs after analysis.\n` +
          `Detected stack: ${result.detectedStack}\n` +
          `Suggested port: ${result.port} (not published)\n` +
          `Repository analysis complete. Application not deployed; no build, containers or ports were created.\n`),
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
            logs: { set: sanitizeLogs(`Deployment failed: ${message}\n`) },
          },
        });
      } catch {
        // Ignore update errors during failure handling
      }
    }

    return NextResponse.json(
      { success: false, error: sanitizeLogs(message) },
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
