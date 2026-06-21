import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { execOnHost, canAccessHost } from "@/lib/local-server";
import { validatePath } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/safe-error";
import SSH2Promise from "ssh2-promise";
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

/** Thrown when the requested directory does not exist on disk. */
class DirectoryNotFoundError extends Error {
  constructor(path: string) {
    super(`Directory not found: ${path}`);
    this.name = "DirectoryNotFoundError";
  }
}

/**
 * GET /api/servers/[id]/files?path=/some/dir
 * Lists directory contents on a server (local or remote via SSH).
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: serverId } = await context.params;
    const { searchParams } = new URL(request.url);
    const dirPath = searchParams.get("path") || "/";

    // Validate path using centralized validator
    const pathCheck = validatePath(dirPath);
    if (!pathCheck.valid) {
      return NextResponse.json(
        { success: false, error: pathCheck.reason },
        { status: 400 }
      );
    }

    const safePath = dirPath;

    let entries;

    if (serverId === "local") {
      entries = await listLocalDirectory(safePath);
    } else {
      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return NextResponse.json(
          { success: false, error: "Server not found" },
          { status: 404 }
        );
      }

      entries = await listRemoteDirectory(server, safePath);
    }

    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    if (err instanceof DirectoryNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 404 }
      );
    }
    const message = safeErrorMessage(err, "Failed to list directory");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

/**
 * List a directory on the local (host) server.
 * Tries nsenter first for host filesystem access,
 * falls back to Node.js fs (works inside the container or on local dev).
 */
async function listLocalDirectory(dirPath: string): Promise<FileEntry[]> {
  // Try nsenter (host filesystem) first
  if (canAccessHost()) {
    try {
      const cmd = `ls -la --time-style=long-iso "${dirPath}" 2>/dev/null || ls -la "${dirPath}" 2>/dev/null`;
      const result = execOnHost(cmd);
      return parseLsOutput(result, dirPath);
    } catch {
      // Fall through to fs fallback
    }
  }

  // Fallback: use Node.js fs (reads the container or local filesystem)
  if (!existsSync(dirPath)) {
    throw new DirectoryNotFoundError(dirPath);
  }

  try {
    const items = readdirSync(dirPath);
    const entries: FileEntry[] = [];

    for (const name of items) {
      if (name === "." || name === "..") continue;
      try {
        const fullPath = join(dirPath, name);
        const stat = statSync(fullPath);
        entries.push({
          name,
          path: fullPath.replace(/\\/g, "/"),
          type: stat.isDirectory() ? "directory" : "file",
          size: stat.size,
          modified: stat.mtime.toISOString().split("T")[0],
        });
      } catch {
        // Skip entries we can't stat (permission denied, etc.)
      }
    }

    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === "directory" ? -1 : 1;
    });

    return entries;
  } catch (err) {
    if (err instanceof DirectoryNotFoundError) throw err;
    throw new Error(
      `Cannot list directory "${dirPath}": ${err instanceof Error ? err.message : "Permission denied"}`
    );
  }
}

/**
 * List a directory on a remote server via SSH.
 */
async function listRemoteDirectory(
  server: { host: string; port: number; username: string; encryptedPass?: string | null; encryptedKey?: string | null },
  dirPath: string
): Promise<FileEntry[]> {
  const sshConfig: Record<string, unknown> = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: 10000,
  };

  if (server.encryptedKey) {
    sshConfig.privateKey = decrypt(server.encryptedKey);
  } else if (server.encryptedPass) {
    sshConfig.password = decrypt(server.encryptedPass);
  }

  const ssh = new SSH2Promise(sshConfig);
  try {
    await ssh.connect();
    const result = await ssh.exec(
      `ls -la --time-style=long-iso "${dirPath}" 2>/dev/null || ls -la "${dirPath}" 2>/dev/null`
    );
    return parseLsOutput(result, dirPath);
  } finally {
    ssh.close();
  }
}

/**
 * Parses `ls -la` output into FileEntry array.
 */
function parseLsOutput(output: string, parentPath: string): FileEntry[] {
  const lines = output.split("\n").filter(Boolean);
  const entries: FileEntry[] = [];

  for (const line of lines) {
    // Skip "total" line
    if (line.startsWith("total ")) continue;

    // Parse ls -la format:
    // drwxr-xr-x  2 root root 4096 2024-01-15 10:30 dirname
    // -rw-r--r--  1 root root  123 2024-01-15 10:30 filename
    const parts = line.trim().split(/\s+/);

    // Need at least 8 parts for ls -la parsing (long-iso has date + time)
    if (parts.length < 8) continue;

    const perms = parts[0];

    // In case of non-long-iso format (month day time|year), adjust
    // Try to detect: if parts[5] looks like a date (YYYY-MM-DD) it's long-iso
    let fileName: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[5])) {
      fileName = parts.slice(7).join(" ");
    } else {
      // Standard ls format: month day time/year
      fileName = parts.slice(8).join(" ");
    }

    // Skip . and ..
    if (fileName === "." || fileName === ".." || !fileName) continue;

    // Skip symlink targets
    const nameWithoutLink = fileName.split(" -> ")[0];

    const isDir = perms.startsWith("d");
    const size = parseInt(parts[4]) || 0;

    // Construct full path
    const fullPath =
      parentPath === "/"
        ? `/${nameWithoutLink}`
        : `${parentPath}/${nameWithoutLink}`;

    entries.push({
      name: nameWithoutLink,
      path: fullPath,
      type: isDir ? "directory" : "file",
      size,
      modified: parts[5] || "",
    });
  }

  // Sort: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "directory" ? -1 : 1;
  });

  return entries;
}
