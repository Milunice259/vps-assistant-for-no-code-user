import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
import {
  isLocalAppId,
  parseLocalContainerId,
  isLocalServer,
  execLocal,
} from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Common .env file locations to probe inside a container. */
const ENV_SEARCH_PATHS = [".env", "/app/.env", "/opt/.env", "/home/.env"];

// ─── Helpers ────────────────────────────────────────────────────────────

/** Resolve container ID + exec function from an app ID. */
async function resolveExec(id: string): Promise<{
  containerId: string;
  exec: (cmd: string) => Promise<string>;
  cleanup?: () => Promise<void>;
}> {
  // ── Local container ──
  if (isLocalAppId(id)) {
    const containerId = parseLocalContainerId(id);
    return {
      containerId,
      exec: async (cmd: string) => execLocal(cmd, 30_000),
    };
  }

  // ── Remote container (via terminal route pattern) ──
  // First check if it's a "discovered::local::" ID
  if (id.startsWith("discovered::local::")) {
    const containerId = id.split("::")[2] || "";
    return {
      containerId,
      exec: async (cmd: string) => execLocal(cmd, 30_000),
    };
  }

  // DB-backed app
  const app = await prisma.app.findUnique({
    where: { id },
    include: { server: true },
  });

  if (!app) throw new Error("Application not found");
  if (!app.containerId) throw new Error("No container ID for this app");

  // If the server is local
  if (isLocalServer(app.serverId)) {
    return {
      containerId: app.containerId,
      exec: async (cmd: string) => execLocal(cmd, 30_000),
    };
  }

  // Remote server — need SSH
  const server = app.server;
  if (!server) throw new Error("Server not found");

  const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
  const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;

  const ssh = await createSSHConnection({
    host: server.host,
    port: server.port,
    username: server.username,
    password,
    privateKey,
  });

  return {
    containerId: app.containerId,
    exec: async (cmd: string) => executeCommand(ssh, cmd, 30_000),
    cleanup: async () => closeSSH(ssh),
  };
}

// ─── GET — Read .env from container ─────────────────────────────────────

interface EnvReadResult {
  vars: Record<string, string>;
  envPath: string | null;
  source: "file" | "not-found";
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<EnvReadResult>>> {
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const { id } = await context.params;
    const { containerId, exec, cleanup: cl } = await resolveExec(id);
    cleanup = cl;

    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");

    // 1. Detect WorkingDir
    let workDir = "/app";
    try {
      const wd = await exec(
        `docker inspect --format "{{.Config.WorkingDir}}" ${safeId}`
      );
      if (wd.trim()) workDir = wd.trim();
    } catch { /* use default */ }

    // 2. Try to read .env from workDir first, then fallback locations
    const pathsToTry = [
      `${workDir}/.env`,
      ...ENV_SEARCH_PATHS.filter((p) => p !== ".env" && p !== `${workDir}/.env`),
    ];

    for (const envPath of pathsToTry) {
      try {
        const content = await exec(
          `docker exec ${safeId} cat ${envPath} 2>/dev/null`
        );
        // Successfully read the file
        const vars = parseEnvContent(content);
        return NextResponse.json({
          success: true,
          data: { vars, envPath, source: "file" },
        });
      } catch {
        // File not found at this path, try next
      }
    }

    // 3. No .env file found anywhere
    return NextResponse.json({
      success: true,
      data: { vars: {}, envPath: `${workDir}/.env`, source: "not-found" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read env";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  } finally {
    if (cleanup) await cleanup();
  }
}

// ─── PUT — Save .env → backup → restart ─────────────────────────────────

interface EnvSaveResult {
  backed_up: boolean;
  saved: boolean;
  restarted: boolean;
  envPath: string;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<EnvSaveResult>>> {
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const vars = body.vars as Record<string, string>;
    const envPath = (body.envPath as string) || "/app/.env";
    const shouldRestart = body.restart !== false; // default true

    if (!vars || typeof vars !== "object") {
      return NextResponse.json(
        { success: false, error: "vars must be an object" },
        { status: 400 }
      );
    }

    const { containerId, exec, cleanup: cl } = await resolveExec(id);
    cleanup = cl;

    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
    const result: EnvSaveResult = {
      backed_up: false,
      saved: false,
      restarted: false,
      envPath,
    };

    // 1. Backup current .env (ignore errors if file doesn't exist yet)
    try {
      await exec(
        `docker exec ${safeId} cp ${envPath} ${envPath}.bak 2>/dev/null`
      );
      result.backed_up = true;
    } catch {
      // No existing file to backup — that's fine
    }

    // 2. Build .env content
    const envContent = buildEnvContent(vars);

    // 3. Write .env file — use printf with base64 to avoid shell escaping issues
    const b64 = Buffer.from(envContent).toString("base64");
    try {
      await exec(
        `docker exec ${safeId} sh -c 'echo "${b64}" | base64 -d > ${envPath}'`
      );
      result.saved = true;
    } catch (writeErr) {
      // If base64 not available, try heredoc approach
      // Escape single quotes in content for sh -c
      const escaped = envContent.replace(/'/g, "'\\''");
      await exec(
        `docker exec ${safeId} sh -c 'printf '"'"'${escaped}'"'"' > ${envPath}'`
      );
      result.saved = true;
    }

    // 4. Restart container (if requested)
    if (shouldRestart && result.saved) {
      try {
        await exec(`docker restart ${safeId}`);
        result.restarted = true;
      } catch {
        // Restart failed but save succeeded — still report partial success
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save env";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  } finally {
    if (cleanup) await cleanup();
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────

/** Parse .env file content into key-value pairs (handles comments, blank lines, quotes). */
function parseEnvContent(raw: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/** Build .env file content from key-value pairs. */
function buildEnvContent(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    // Quote values that contain spaces, special characters, or are empty
    if (!value || /[\s#"'$\\]/.test(value)) {
      lines.push(`${key}="${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join("\n") + "\n";
}
