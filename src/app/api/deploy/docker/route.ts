import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execOnHost, execLocal, isLocalServer } from "@/lib/local-server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { canAccessServer } from "@/lib/server-access";
import { dockerPreflight, validateDockerDeploy, type DeployRunner, type DockerInput } from "@/lib/deploy-preflight";
import { composePreflight, deployCompose } from "@/lib/compose-deployment";
import type { DeploymentInfo } from "@/types";
import { deployImage, validateImageInput, type ImageInput } from "@/lib/image-deployment";
import { ADVANCED_COOKIE, verifyAdvancedToken } from "@/lib/operation-safety";
import { readDeploymentDefinition } from "@/lib/deployment-state";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!can(session.role as string, "OPERATOR")) return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "Body must be an object" }, { status: 400 });
    const serverId = body.serverId === undefined ? "local" : body.serverId;
    if (typeof serverId !== "string" || !serverId.trim()) return NextResponse.json({ success: false, error: "Invalid serverId" }, { status: 400 });
    if (!(await canAccessServer(session.sub as string, session.role as string, serverId))) return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    if (body.mode !== undefined && !["preview", "apply"].includes(body.mode)) return NextResponse.json({success:false,error:"Invalid deployment mode"},{status:400});
    if (body.type === "compose" && body.composeMode === "update" && !can(session.role as string,"ADMIN")) return NextResponse.json({success:false,error:"Insufficient permissions"},{status:403});
    const preview = body.type === "compose" && body.mode === "preview";
    if (!preview) {
      const block = requireSafeModeOff("deploy_docker", body);
      if (block) return block;
      if (body.safeModeOff !== true || !await verifyAdvancedToken(request.cookies.get(ADVANCED_COOKIE)?.value,session)) return NextResponse.json({success:false,error:"Signed Advanced access and literal Safe Mode acknowledgment are required"},{status:423});
    }
    const invalid = validateDockerDeploy(body.type === "image" ? {...body,image:"validated:latest"} : body);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
    if (body.type === "image") {
      try { validateImageInput(body); }
      catch { return NextResponse.json({ success: false, error: "Invalid image deployment input" }, { status: 400 }); }
    }
    if (body.type === "compose") {
      // Request gates are not definition inputs: preview/apply must hash the same reviewed content.
      delete body.mode;
      delete body.safeModeOff;
      if (!preview && (typeof body.composeRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.composeRevision))) return NextResponse.json({success:false,error:"An exact reviewed Compose preview is required"},{status:400});
    }
    let run: DeployRunner;
    if (isLocalServer(serverId)) run = async (command, timeout) => (body.type === "compose" || /df -P|MemTotal|ss -[ltu]|readlink -f/.test(command) ? execOnHost : execLocal)(command, timeout);
    else { const connection = await connectToServer(serverId); ssh = connection.ssh; run = (command, timeout) => executeCommand(connection.ssh, command, timeout); }
    let plan;
    try { plan = body.type === "compose" ? await composePreflight(run, body, serverId) : await dockerPreflight(run, body); }
    catch { return NextResponse.json({ success: false, error: "Final pre-flight failed. Check resources, ports and existing assets, then run pre-flight again." }, { status: 400 }); }
    if (preview) return NextResponse.json({success:true,data:plan});
    return await deploy(run, body, serverId);
  } catch {
    return NextResponse.json({ success: false, error: "Deployment could not be completed. Check the target connection and deployment history." }, { status: 500 });
  } finally { await closeSSH(ssh); }
}

async function deploy(run: DeployRunner, body: DockerInput, serverId: string) {
  const image = body.type === "image";
  const record = await prisma.deploymentLog.create({ data: {
    repoUrl: image ? `docker://${body.image}` : `compose://${body.projectPath}`, branch: image ? "latest" : "compose",
    detectedStack: image ? "docker-image" : "docker-compose", status: "BUILDING", serverId: isLocalServer(serverId) ? null : serverId,
    customPath: image ? null : body.projectPath, logs: "Final pre-flight passed. Starting deployment; secret values and command output are omitted.\n",
  } });
  let logs = record.logs || "";
  let status: "RUNNING" | "FAILED" | "UNVERIFIED" = "UNVERIFIED";
  let uncertain = false;
  let pending: boolean | null = false;
  let routing: Awaited<ReturnType<typeof deployImage>>["routing"] = null;
  try {
    if (image) {
      const result = await deployImage(body as ImageInput, serverId, record.id, run);
      routing = result.routing;
      status = result.status as typeof status;
      logs += `Native container configuration saved with immutable image digest: ${result.containerId}. Readiness: ${result.readiness}.\n`;
    } else {
      const result = await deployCompose(run, body, serverId, record.id);
      status = result.status;
      logs += `Native Compose configuration and encrypted definition saved. Containers: ${result.containerIds.length}. Readiness: ${result.status}.\n`;
    }
  } catch {
    try {
      const saved = await readDeploymentDefinition(record.id);
      if (saved && saved.state.serverId !== serverId) throw new Error("Target changed");
      pending = saved ? !!saved.state.pending : null;
    } catch { pending = null; }
    uncertain = pending !== false;
    status = uncertain ? "UNVERIFIED" : "FAILED";
    logs += "Deployment or readback failed. Partial files/containers may remain on the target; no automatic rollback or deletion was attempted.\n";
  }
  logs += status === "RUNNING" ? "All expected containers are running and healthy; public routing and TLS are separate checks.\n" : status === "FAILED" ? "Deployment failed. Inspect target state before retrying.\n" : "Readiness is unverified: containers may be absent, starting, or have no health check. Inspect the target before relying on this app.\n";
  let updated: typeof record = { ...record, status, logs };
  try { updated = await prisma.deploymentLog.update({ where: { id: record.id }, data: { status, logs } }); }
  catch { uncertain = true; status = "UNVERIFIED"; updated = { ...record, status, logs }; }
  return NextResponse.json({ success: !uncertain && status === "RUNNING", data: { ...updated, createdAt: updated.createdAt.toISOString() } as DeploymentInfo,
    uncertain, pending, recovery: { deploymentId: record.id, serverId, readOnly: true, url: `/api/deploy/${record.id}` }, routing,
    ...(status !== "RUNNING" ? { error: uncertain ? "Deployment outcome is uncertain. Inspect retained recovery and target state; do not retry automatically." : status === "FAILED" ? "Deployment failed; partial assets may remain." : "Deployment command completed but application readiness is unverified." } : {}),
  }, { status: uncertain || status === "FAILED" ? 500 : 201 });
}
