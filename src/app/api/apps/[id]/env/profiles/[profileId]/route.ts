import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isLocalAppId,
  parseLocalContainerId,
  isLocalServer,
  execLocal,
} from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; profileId: string }> };

interface ProfileInfo {
  id: string;
  name: string;
  vars: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}

// ─── PUT — Update profile vars ──────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<ProfileInfo>>> {
  try {
    const { profileId } = await context.params;
    const body = await request.json();
    const { name, vars } = body as { name?: string; vars?: Record<string, string> };

    const update: Record<string, unknown> = {};
    if (vars !== undefined) update.vars = JSON.stringify(vars);
    if (name?.trim()) update.name = name.trim();

    const profile = await prisma.envProfile.update({
      where: { id: profileId },
      data: update,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        name: profile.name,
        vars: JSON.parse(profile.vars),
        isActive: profile.isActive,
        createdAt: profile.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── DELETE — Delete profile (if active → recreate with original env) ───

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ reverted: boolean }>>> {
  try {
    const { id: appId, profileId } = await context.params;

    const profile = await prisma.envProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    const wasActive = profile.isActive;

    // Delete the profile
    await prisma.envProfile.delete({ where: { id: profileId } });

    // If it was active → recreate container with original env
    if (wasActive) {
      try {
        await recreateContainer(appId, {});
      } catch (err) {
        // Profile deleted but recreation failed
        return NextResponse.json({
          success: true,
          data: { reverted: false },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: { reverted: wasActive },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete profile";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── Container recreation helper (shared with apply endpoint) ────────────

/**
 * Recreate a container with overridden env vars.
 * @param appId   The app or local container ID
 * @param overrides  Key-value overrides to merge on top of original env
 *                   Empty = revert to original
 */
export async function recreateContainer(
  appId: string,
  overrides: Record<string, string>
): Promise<{ newContainerId: string }> {
  let containerId: string;
  let exec: (cmd: string) => string;

  // Resolve container + exec
  if (isLocalAppId(appId)) {
    containerId = parseLocalContainerId(appId);
    exec = (cmd: string) => execLocal(cmd, 60_000);
  } else if (appId.startsWith("discovered::local::")) {
    containerId = appId.split("::")[2] || "";
    exec = (cmd: string) => execLocal(cmd, 60_000);
  } else {
    // DB-backed app
    const app = await prisma.app.findUnique({
      where: { id: appId },
      include: { server: true },
    });
    if (!app?.containerId) throw new Error("No container ID for this app");
    containerId = app.containerId;

    if (isLocalServer(app.serverId)) {
      exec = (cmd: string) => execLocal(cmd, 60_000);
    } else {
      throw new Error("Remote container recreation is not supported yet");
    }
  }

  const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeId) throw new Error("Invalid container ID");

  // 1. Inspect current container for full config
  const inspectRaw = exec(`docker inspect ${safeId}`);
  const inspect = JSON.parse(inspectRaw)[0];
  if (!inspect) throw new Error("Could not inspect container");

  const config = inspect.Config || {};
  const hostConfig = inspect.HostConfig || {};
  const containerName = (inspect.Name || "").replace(/^\//, "");
  const image = config.Image || "";

  // 2. Build original env map
  const originalEnv: Record<string, string> = {};
  for (const line of config.Env || []) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      originalEnv[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
    }
  }

  // 3. Merge: original + overrides
  const mergedEnv = { ...originalEnv, ...overrides };

  // 4. Build docker run command
  const parts: string[] = ["docker run -d"];

  // Name
  if (containerName) {
    parts.push(`--name "${containerName}"`);
  }

  // Env vars
  for (const [key, value] of Object.entries(mergedEnv)) {
    // Escape for shell
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  // Ports
  const portBindings = hostConfig.PortBindings || {};
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    for (const binding of (bindings as Array<{ HostIp: string; HostPort: string }>) || []) {
      const hostIp = binding.HostIp || "";
      const hostPort = binding.HostPort || "";
      const port = containerPort.replace("/tcp", "").replace("/udp", "");
      const proto = containerPort.includes("/udp") ? "/udp" : "";
      if (hostIp && hostIp !== "0.0.0.0") {
        parts.push(`-p ${hostIp}:${hostPort}:${port}${proto}`);
      } else {
        parts.push(`-p ${hostPort}:${port}${proto}`);
      }
    }
  }

  // Volumes
  for (const mount of inspect.Mounts || []) {
    if (mount.Type === "bind") {
      parts.push(`-v "${mount.Source}:${mount.Destination}${mount.RW ? "" : ":ro"}"`);
    } else if (mount.Type === "volume") {
      parts.push(`-v "${mount.Name}:${mount.Destination}${mount.RW ? "" : ":ro"}"`);
    }
  }

  // Restart policy
  const restartPolicy = hostConfig.RestartPolicy || {};
  if (restartPolicy.Name && restartPolicy.Name !== "no") {
    let policy = restartPolicy.Name;
    if (restartPolicy.MaximumRetryCount > 0) {
      policy += `:${restartPolicy.MaximumRetryCount}`;
    }
    parts.push(`--restart ${policy}`);
  }

  // Network mode
  const networkMode = hostConfig.NetworkMode || "bridge";
  if (networkMode && networkMode !== "default") {
    parts.push(`--network ${networkMode}`);
  }

  // Working dir
  if (config.WorkingDir) {
    parts.push(`-w "${config.WorkingDir}"`);
  }

  // Labels
  for (const [lk, lv] of Object.entries(config.Labels || {})) {
    const escaped = (lv as string).replace(/'/g, "'\\''");
    parts.push(`-l '${lk}=${escaped}'`);
  }

  // Entrypoint
  if (config.Entrypoint && config.Entrypoint.length > 0) {
    parts.push(`--entrypoint '${config.Entrypoint[0]}'`);
  }

  // Privileged / capabilities
  if (hostConfig.Privileged) {
    parts.push("--privileged");
  }

  // PID namespace
  if (hostConfig.PidMode) {
    parts.push(`--pid=${hostConfig.PidMode}`);
  }

  // Resource limits
  if (hostConfig.NanoCpus) {
    parts.push(`--cpus=${hostConfig.NanoCpus / 1e9}`);
  }
  if (hostConfig.Memory) {
    parts.push(`--memory=${hostConfig.Memory}`);
  }

  // Image + command
  parts.push(image);
  if (config.Cmd && config.Cmd.length > 0) {
    // Only add cmd if entrypoint is set (otherwise cmd IS the entrypoint)
    if (config.Entrypoint && config.Entrypoint.length > 0) {
      parts.push(config.Cmd.map((c: string) => `'${c}'`).join(" "));
    }
  }

  // 5. Stop + remove old container
  exec(`docker stop ${safeId}`);
  exec(`docker rm ${safeId}`);

  // 6. Create new container
  const newId = exec(parts.join(" ")).trim();

  // 7. Connect to additional networks (beyond the primary one)
  const networks = inspect.NetworkSettings?.Networks || {};
  const networkNames = Object.keys(networks);
  if (networkNames.length > 1) {
    for (const netName of networkNames.slice(1)) {
      try {
        exec(`docker network connect ${netName} ${newId}`);
      } catch { /* network might already be connected */ }
    }
  }

  // 8. Update DB if this is a DB-backed app
  if (!isLocalAppId(appId) && !appId.startsWith("discovered::")) {
    await prisma.app.update({
      where: { id: appId },
      data: { containerId: newId.slice(0, 12) },
    });
  }

  return { newContainerId: newId };
}
