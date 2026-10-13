import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execOnHost, execLocal } from "@/lib/local-server";
import { validateRepoUrl, validateBranch, validatePath, validateDomain } from "@/lib/validation";
import { dockerPreflight, validateDockerDeploy, type DeployRunner } from "@/lib/deploy-preflight";
import { gitPreflight } from "@/lib/ssh/deploy";
import { gitComposePreflight, readGitSource } from "@/lib/git-deployment";
import { can } from "@/lib/permissions";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "Body must be an object" }, { status: 400 });
    const type = body.type === undefined ? "git" : body.type;
    if (type === "git" && (body.composeDeploymentId !== undefined || body.compose?.composeMode === "update" || body.compose?.composeDeploymentId !== undefined) && !can(session.role as string, "ADMIN")) return NextResponse.json({ success: false, error: "Managed Git updates require Admin" }, { status: 403 });
    const targetId = body.serverId === undefined ? "local" : body.serverId;
    if (typeof targetId !== "string" || !targetId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, targetId))) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    let invalid: string | null = null;
    if (type === "git") {
      for (const result of [validateRepoUrl(body.repoUrl), validateBranch(body.branch === undefined ? "main" : body.branch), ...(targetId === "local" ? [] : [validatePath(body.customPath), validateDomain(body.domain)])]) if (!result.valid) invalid = result.reason;
      if (body.envVars !== undefined && (typeof body.envVars !== "string" || body.envVars.includes("\0"))) invalid = "Invalid environment options";
    } else invalid = validateDockerDeploy(body);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
    let run: DeployRunner;
    if (targetId === "local") run = async (command, timeout) => (type === "git" || body.type === "compose" || /df -P|MemTotal|ss -[ltu]/.test(command) ? execOnHost : execLocal)(command, timeout);
    else { const conn = await connectToServer(targetId); ssh = conn.ssh; run = (command, timeout) => executeCommand(conn.ssh, command, timeout); }
    let gitPlan;
    let ready = false;
    let detail = "Pre-flight passed. Final checks run again before execution.";
    try {
      if (type === "git") {
        const input = {...body,branch:body.branch || "main",serverId:targetId,compose:body.compose || {type:"compose",projectPath:body.customPath,serverId:targetId}};
        if (input.compose.type !== "compose" || input.compose.projectPath !== input.customPath || (input.compose.serverId || "local") !== targetId || input.compose.composeDeploymentId !== input.composeDeploymentId || (input.compose.composeMode === "update") !== !!input.composeDeploymentId) throw Error("Git/Compose target or identity mismatch");
        const managed = input.composeDeploymentId ? await readGitSource(input.composeDeploymentId,targetId) : null;
        if (input.composeDeploymentId && (!managed || managed.pending || managed.source.repoUrl !== input.repoUrl || managed.source.branch !== input.branch || managed.source.customPath !== input.customPath)) throw Error("Managed Git source binding changed");
        const pinnedInput = {...input,expectedCommit:managed?.source.commitHash || input.expectedCommit};
        const pin = await gitPreflight(run,pinnedInput);
        const plan = await gitComposePreflight(run,{...pinnedInput,commitHash:pin.commitHash,expectedCommit:pin.expectedCommit});
        gitPlan = {commitHash:plan.commitHash,...(plan.expectedCommit ? {expectedCommit:plan.expectedCommit} : {}),revision:plan.revision,composeRevision:plan.composeRevision,services:plan.services,risks:plan.risks,composeMode:input.compose.composeMode || "create",...(input.composeDeploymentId ? {composeDeploymentId:input.composeDeploymentId} : {})};
        detail = `Pinned Git/Compose plan verified. Services: ${plan.services.join(", ")}. Builds: ${plan.risks.builds.join(", ") || "none"}. Explicit Compose risk consent is required before execution.`;
      } else await dockerPreflight(run, body);
      ready = true;
    } catch { detail = "Pre-flight failed: verify target connection, resources, ports and new destination/project names. No destination files were written."; }
    return NextResponse.json({ success: true, data: {
      target: targetId === "local" ? "local" : "remote", ready, ...(gitPlan ? {gitPlan} : {}),
      checks: [{ id: "target", label: "Current input checks", status: ready ? "pass" : "fail", detail }],
      nextSteps: [ready ? "Review impact, then confirm execution." : "Fix inputs or target resources and run pre-flight again.", "Automatic rollback is unavailable. Check the deployment log and actual state after execution."],
    } });
  } catch { return NextResponse.json({ success: false, error: "Pre-flight unavailable. Check the selected target connection." }, { status: 503 }); }
  finally { await closeSSH(ssh); }
}
