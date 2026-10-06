import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execOnHost, execLocal, isLocalServer } from "@/lib/local-server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requireSafeModeOff } from "@/lib/operation-safety";
import { canAccessServer } from "@/lib/server-access";
import { checked, dockerPreflight, projectName, quote, readiness, validateDockerDeploy, type DeployRunner, type DockerInput } from "@/lib/deploy-preflight";
import type { DeploymentInfo } from "@/types";

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
    const block = requireSafeModeOff("deploy_docker", body);
    if (block) return block;
    const invalid = validateDockerDeploy(body);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
    let run: DeployRunner;
    if (isLocalServer(serverId)) run = async (command, timeout) => (body.type === "compose" || /df -P|MemTotal|ss -[ltu]/.test(command) ? execOnHost : execLocal)(command, timeout);
    else { const connection = await connectToServer(serverId); ssh = connection.ssh; run = (command, timeout) => executeCommand(connection.ssh, command, timeout); }
    let plan;
    try { plan = await dockerPreflight(run, body); }
    catch { return NextResponse.json({ success: false, error: "Final pre-flight failed. Check resources, ports and existing assets, then run pre-flight again." }, { status: 400 }); }
    return await deploy(run, body, serverId, plan.services);
  } catch {
    return NextResponse.json({ success: false, error: "Deployment could not be completed. Check the target connection and deployment history." }, { status: 500 });
  } finally { await closeSSH(ssh); }
}

async function deploy(run: DeployRunner, body: DockerInput, serverId: string, expectedServices: string[]) {
  const image = body.type === "image";
  const record = await prisma.deploymentLog.create({ data: {
    repoUrl: image ? `docker://${body.image}` : `compose://${body.projectPath}`, branch: image ? "latest" : "compose",
    detectedStack: image ? "docker-image" : "docker-compose", status: "BUILDING", serverId: isLocalServer(serverId) ? null : serverId,
    customPath: image ? null : body.projectPath, logs: "Final pre-flight passed. Starting deployment; secret values and command output are omitted.\n",
  } });
  let logs = record.logs || "";
  let status: "RUNNING" | "FAILED" | "UNVERIFIED" = "UNVERIFIED";
  let completed = false;
  try {
    if (image) {
      await checked(run, `docker pull ${quote(body.image!)}`, 120_000);
      logs += "Image pull completed.\n";
      const parts = ["docker run -d", `--label ${quote(`vps-panel.deployment=${record.id}`)}`];
      if (body.name) parts.push(`--name ${quote(body.name)}`);
      if (body.cpuLimit !== undefined) parts.push(`--cpus=${body.cpuLimit}`);
      if (body.memoryLimit !== undefined) parts.push(`--memory=${body.memoryLimit}m`);
      if (body.restartPolicy) parts.push(`--restart=${body.restartPolicy}`);
      for (const port of body.ports || []) parts.push(`-p ${quote(port)}`);
      for (const [key, value] of Object.entries(body.env || {})) parts.push(`-e ${quote(`${key}=${value}`)}`);
      parts.push(quote(body.image!));
      const containerId = await checked(run, parts.join(" "), 60_000);
      if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("Container ID could not be verified");
      completed = true;
      logs += `Container created: ${containerId}\n`;
      const inspected = JSON.parse(await checked(run, `docker inspect ${quote(containerId)}`));
      status = readiness(inspected, undefined, containerId);
      // Local is virtual; Apps discovers its containers as local::<Docker ID>.
      if (!isLocalServer(serverId)) await prisma.app.create({ data: {
        name: body.name || body.image!.split(":")[0].split("/").pop()!, containerId: containerId.slice(0, 12), containerName: body.name || null,
        image: body.image!, serverId, status: status === "RUNNING" ? "RUNNING" : status === "FAILED" ? "UNHEALTHY" : "UNKNOWN", cpuLimit: body.cpuLimit ?? null, memoryLimit: body.memoryLimit ?? null,
        restartPolicy: body.restartPolicy || null, ports: body.ports ? JSON.stringify(body.ports) : null,
      } });
    } else {
      const path = quote(body.projectPath!);
      const project = quote(projectName(body));
      // Exclusive mkdir preserves existing destinations. Partial assets stay for recovery.
      await checked(run, `mkdir ${path}`);
      logs += "Created new destination directory.\n";
      const encoded = Buffer.from(body.composeContent!).toString("base64");
      await checked(run, `umask 077; printf %s ${quote(encoded)} | base64 -d > ${quote(`${body.projectPath}/docker-compose.yml`)}`);
      logs += "Compose file written (private permissions).\n";
      await checked(run, `cd ${path} && docker compose -p ${project} up -d --no-recreate`, 120_000);
      completed = true;
      logs += "Compose up completed.\n";
      const ids = (await checked(run, `cd ${path} && docker compose -p ${project} ps -a -q`)).split(/\s+/).filter(Boolean);
      if (ids.length && ids.every(id => /^[a-f0-9]{12,64}$/.test(id))) status = readiness(JSON.parse(await checked(run, `docker inspect ${ids.map(quote).join(" ")}`)), expectedServices);
      logs += `Expected services: ${expectedServices.length}.\n`;
    }
  } catch {
    status = completed && status !== "FAILED" ? "UNVERIFIED" : "FAILED";
    logs += "Deployment or readback failed. Partial files/containers may remain on the target; no automatic rollback or deletion was attempted.\n";
  }
  logs += status === "RUNNING" ? "All expected containers are running and healthy.\n" : status === "FAILED" ? "Deployment failed. Inspect target state before retrying.\n" : "Readiness is unverified: containers may be absent, starting, or have no health check. Inspect the target before relying on this app.\n";
  const updated = await prisma.deploymentLog.update({ where: { id: record.id }, data: { status, logs } });
  return NextResponse.json({ success: status === "RUNNING", data: { ...updated, createdAt: updated.createdAt.toISOString() } as DeploymentInfo,
    ...(status !== "RUNNING" ? { error: status === "FAILED" ? "Deployment failed; partial assets may remain." : "Deployment command completed but application readiness is unverified." } : {}),
  }, { status: status === "FAILED" ? 500 : 201 });
}
