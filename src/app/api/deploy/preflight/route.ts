import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execOnHost, execLocal } from "@/lib/local-server";
import { validateRepoUrl, validateBranch, validatePath, validateDomain } from "@/lib/validation";
import { checked, resourcePreflight, dockerPreflight, validateDockerDeploy, type DeployRunner } from "@/lib/deploy-preflight";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "Body must be an object" }, { status: 400 });
    const targetId = body.serverId === undefined ? "local" : body.serverId;
    if (typeof targetId !== "string" || !targetId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, targetId))) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    const type = body.type === undefined ? "git" : body.type;
    let invalid: string | null = null;
    if (type === "git") {
      for (const result of [validateRepoUrl(body.repoUrl), validateBranch(body.branch === undefined ? "main" : body.branch), ...(targetId === "local" ? [] : [validatePath(body.customPath), validateDomain(body.domain)])]) if (!result.valid) invalid = result.reason;
      if (body.envVars !== undefined && (typeof body.envVars !== "string" || body.envVars.includes("\0"))) invalid = "Invalid environment options";
    } else invalid = validateDockerDeploy(body);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
    let run: DeployRunner;
    if (targetId === "local") run = async (command, timeout) => (body.type === "compose" || /df -P|MemTotal|ss -[ltu]/.test(command) ? execOnHost : execLocal)(command, timeout);
    else { const conn = await connectToServer(targetId); ssh = conn.ssh; run = (command, timeout) => executeCommand(conn.ssh, command, timeout); }
    let ready = false;
    let detail = "Pre-flight passed. Final checks run again before execution.";
    try {
      if (type === "git") {
        await checked(run, "git --version >/dev/null");
        if (targetId !== "local") await resourcePreflight(run, true);
      } else await dockerPreflight(run, body);
      ready = true;
    } catch { detail = "Pre-flight failed: verify target connection, resources, ports and new destination/project names. No destination files were written."; }
    return NextResponse.json({ success: true, data: {
      target: targetId === "local" ? "local" : "remote", ready,
      checks: [{ id: "target", label: "Current input checks", status: ready ? "pass" : "fail", detail }],
      nextSteps: [ready ? "Review impact, then confirm execution." : "Fix inputs or target resources and run pre-flight again.", "Automatic rollback is unavailable. Check the deployment log and actual state after execution."],
    } });
  } catch { return NextResponse.json({ success: false, error: "Pre-flight unavailable. Check the selected target connection." }, { status: 503 }); }
  finally { await closeSSH(ssh); }
}
