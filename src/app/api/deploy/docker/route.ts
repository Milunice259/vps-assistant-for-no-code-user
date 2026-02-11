import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import {
  validateDockerImage,
  validateRestartPolicy,
  validateCpu,
  validateMemory,
  validateEnvKey,
  validateEnvValue,
  validatePath,
  validateComposeObject,
} from "@/lib/validation";
import yaml from "js-yaml";
import { sanitizeLogs } from "@/lib/sanitize";
import type { ApiResponse, DeploymentInfo, DeployStatus } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/deploy/docker - Deploy from Docker Image or Compose file.
 *
 * Body for image deploy:
 *   { type: "image", serverId, image, name?, ports?, env?, cpuLimit?, memoryLimit?, restartPolicy? }
 *
 * Body for compose deploy:
 *   { type: "compose", serverId, composeContent, projectPath, projectName? }
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<DeploymentInfo>>> {
  const logId: string | null = null;

  try {
    const body = await request.json();
    const { type, serverId } = body;

    if (!serverId) {
      return NextResponse.json(
        { success: false, error: "serverId is required" },
        { status: 400 }
      );
    }

    if (!type || !["image", "compose"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "type must be 'image' or 'compose'" },
        { status: 400 }
      );
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

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
      if (type === "image") {
        return await deployImage(ssh, body, serverId, server.name);
      } else {
        return await deployCompose(ssh, body, serverId, server.name);
      }
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docker deploy failed";

    if (logId) {
      try {
        await prisma.deploymentLog.update({
          where: { id: logId },
          data: { status: "FAILED", logs: sanitizeLogs(`Deploy failed: ${message}`) },
        });
      } catch { /* ok */ }
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ─── Docker Image Deploy ───

interface ImageDeployInput {
  image: string;
  name?: string;
  ports?: string[];        // ["8080:80", "443:443"]
  env?: Record<string, string>;
  cpuLimit?: number;
  memoryLimit?: number;
  restartPolicy?: string;
}

async function deployImage(
  ssh: Parameters<typeof executeCommand>[0],
  body: ImageDeployInput,
  serverId: string,
  _serverName: string,
): Promise<NextResponse<ApiResponse<DeploymentInfo>>> {
  const { image, name, ports, env, cpuLimit, memoryLimit, restartPolicy } = body;

  // ── Validate all inputs ──
  const imgCheck = validateDockerImage(image);
  if (!imgCheck.valid) {
    return NextResponse.json({ success: false, error: imgCheck.reason }, { status: 400 });
  }

  const policyCheck = validateRestartPolicy(restartPolicy);
  if (!policyCheck.valid) {
    return NextResponse.json({ success: false, error: policyCheck.reason }, { status: 400 });
  }

  const cpuCheck = validateCpu(cpuLimit);
  if (!cpuCheck.valid) {
    return NextResponse.json({ success: false, error: cpuCheck.reason }, { status: 400 });
  }

  const memCheck = validateMemory(memoryLimit);
  if (!memCheck.valid) {
    return NextResponse.json({ success: false, error: memCheck.reason }, { status: 400 });
  }

  // Validate env vars
  if (env && typeof env === "object") {
    for (const [key, value] of Object.entries(env)) {
      const keyCheck = validateEnvKey(key);
      if (!keyCheck.valid) {
        return NextResponse.json({ success: false, error: keyCheck.reason }, { status: 400 });
      }
      const valCheck = validateEnvValue(value);
      if (!valCheck.valid) {
        return NextResponse.json({ success: false, error: `Env var '${key}': ${valCheck.reason}` }, { status: 400 });
      }
    }
  }

  const safeImage = image;
  let allLogs = `Deploying Docker image: ${safeImage}\n`;

  // Create deployment log
  const logRecord = await prisma.deploymentLog.create({
    data: {
      repoUrl: `docker://${safeImage}`,
      branch: "latest",
      detectedStack: "docker-image",
      status: "CLONING",
      logs: allLogs,
      serverId,
    },
  });

  try {
    // Pull image
    allLogs += `Pulling ${safeImage}...\n`;
    const pullOutput = await executeCommand(ssh, `docker pull ${safeImage} 2>&1`, 120_000);
    allLogs += pullOutput + "\n";

    // Build run command with validated values
    const runParts = ["docker run -d"];

    if (cpuLimit != null) {
      runParts.push(`--cpus=${Number(cpuLimit)}`);
    }
    if (memoryLimit != null) {
      runParts.push(`--memory=${Number(memoryLimit)}m`);
    }
    if (restartPolicy) {
      runParts.push(`--restart=${restartPolicy}`);
    }

    if (name) {
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "");
      if (safeName) runParts.push(`--name ${safeName}`);
    }

    if (ports && Array.isArray(ports)) {
      for (const p of ports) {
        const safePort = p.replace(/[^0-9:/a-z]/g, "");
        if (safePort) runParts.push(`-p ${safePort}`);
      }
    }

    if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env)) {
        // Keys and values have been validated above
        runParts.push(`-e ${key}=${value}`);
      }
    }

    runParts.push(safeImage);

    allLogs += `Running: ${runParts.join(" ")}\n`;
    const runOutput = await executeCommand(ssh, runParts.join(" ") + " 2>&1", 60_000);
    allLogs += runOutput + "\n";

    const containerId = runOutput.trim().slice(0, 12);

    // Create app record
    await prisma.app.create({
      data: {
        name: name || safeImage.split(":")[0].split("/").pop() || safeImage,
        containerId,
        containerName: name || null,
        image: safeImage,
        serverId,
        status: "RUNNING",
        cpuLimit: cpuLimit != null ? Number(cpuLimit) : null,
        memoryLimit: memoryLimit != null ? Number(memoryLimit) : null,
        restartPolicy: restartPolicy || null,
        ports: ports ? JSON.stringify(ports) : null,
      },
    });

    allLogs += `Container started: ${containerId}\n`;

    const updated = await prisma.deploymentLog.update({
      where: { id: logRecord.id },
      data: { status: "RUNNING", logs: sanitizeLogs(allLogs) },
    });

    return NextResponse.json({
      success: true,
      data: toDeploymentInfo(updated),
    }, { status: 201 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Deploy failed";
    allLogs += `ERROR: ${msg}\n`;

    const updated = await prisma.deploymentLog.update({
      where: { id: logRecord.id },
      data: { status: "FAILED", logs: sanitizeLogs(allLogs) },
    });

    return NextResponse.json({
      success: false,
      data: toDeploymentInfo(updated),
      error: msg,
    }, { status: 500 });
  }
}

// ─── Docker Compose Deploy ───

interface ComposeDeployInput {
  composeContent: string;
  projectPath: string;
  projectName?: string;
}

async function deployCompose(
  ssh: Parameters<typeof executeCommand>[0],
  body: ComposeDeployInput,
  serverId: string,
  _serverName: string,
): Promise<NextResponse<ApiResponse<DeploymentInfo>>> {
  const { composeContent, projectPath, projectName } = body;

  if (!composeContent || !projectPath) {
    return NextResponse.json(
      { success: false, error: "composeContent and projectPath are required" },
      { status: 400 }
    );
  }

  // ── Validate projectPath ──
  const pathCheck = validatePath(projectPath);
  if (!pathCheck.valid) {
    return NextResponse.json({ success: false, error: pathCheck.reason }, { status: 400 });
  }

  // ── Validate compose YAML structure ──
  let parsed: unknown;
  try {
    parsed = yaml.load(composeContent);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid YAML in composeContent" },
      { status: 400 }
    );
  }

  const composeCheck = validateComposeObject(parsed);
  if (!composeCheck.valid) {
    return NextResponse.json({ success: false, error: composeCheck.reason }, { status: 400 });
  }

  const safePath = projectPath;
  let allLogs = `Deploying Docker Compose to ${safePath}\n`;

  const logRecord = await prisma.deploymentLog.create({
    data: {
      repoUrl: `compose://${safePath}`,
      branch: "compose",
      detectedStack: "docker-compose",
      status: "BUILDING",
      logs: allLogs,
      serverId,
    },
  });

  try {
    // Create project directory
    await executeCommand(ssh, `mkdir -p "${safePath}"`, 10_000);

    // Write compose file using base64 to avoid any shell interpretation
    const base64Content = Buffer.from(composeContent).toString("base64");
    await executeCommand(
      ssh,
      `echo "${base64Content}" | base64 -d > "${safePath}/docker-compose.yml"`,
      15_000
    );
    allLogs += "Uploaded docker-compose.yml\n";

    // Run docker compose up
    const nameFlag = projectName ? `-p ${projectName.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
    const upOutput = await executeCommand(
      ssh,
      `cd "${safePath}" && docker compose ${nameFlag} up -d 2>&1`,
      120_000
    );
    allLogs += upOutput + "\n";

    // List services started
    const psOutput = await executeCommand(
      ssh,
      `cd "${safePath}" && docker compose ${nameFlag} ps --format '{{.Name}}\t{{.Image}}\t{{.State}}' 2>&1`,
      15_000
    );
    allLogs += "Services:\n" + psOutput + "\n";

    const updated = await prisma.deploymentLog.update({
      where: { id: logRecord.id },
      data: { status: "RUNNING", logs: sanitizeLogs(allLogs), customPath: safePath },
    });

    return NextResponse.json({
      success: true,
      data: toDeploymentInfo(updated),
    }, { status: 201 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Compose deploy failed";
    allLogs += `ERROR: ${msg}\n`;

    const updated = await prisma.deploymentLog.update({
      where: { id: logRecord.id },
      data: { status: "FAILED", logs: sanitizeLogs(allLogs) },
    });

    return NextResponse.json({
      success: false,
      data: toDeploymentInfo(updated),
      error: msg,
    }, { status: 500 });
  }
}

// ─── Helper ───

function toDeploymentInfo(log: {
  id: string;
  repoUrl: string;
  branch: string;
  detectedStack: string | null;
  status: string;
  logs: string | null;
  domain: string | null;
  serverId: string | null;
  commitHash: string | null;
  customPath: string | null;
  createdAt: Date;
}): DeploymentInfo {
  return {
    id: log.id,
    repoUrl: log.repoUrl,
    branch: log.branch,
    detectedStack: log.detectedStack || "unknown",
    status: log.status as DeployStatus,
    logs: log.logs || "",
    domain: log.domain,
    serverId: log.serverId,
    commitHash: log.commitHash,
    customPath: log.customPath,
    createdAt: log.createdAt.toISOString(),
  };
}
