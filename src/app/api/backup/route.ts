/**
 * API: /api/backup
 * Database backup and restore operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import { requireSafeModeOff } from "@/lib/operation-safety";

// ── Rate limiter (5 operations per 60s per IP) ──
const rateLimitMap = new Map<string, { count: number; firstAttempt: number }>();
const MAX_OPS = 5;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return false;
  }
  entry.count++;
  return entry.count > MAX_OPS;
}

const _backupCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.firstAttempt > WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 300_000);
if (typeof _backupCleanup === "object" && _backupCleanup && "unref" in _backupCleanup) {
  (_backupCleanup as NodeJS.Timeout).unref();
}

/**
 * Validate a backup filename — must be a plain .db filename with no path traversal.
 */
function isValidBackupName(name: unknown): name is string {
  if (typeof name !== "string" || !name.endsWith(".db")) return false;
  // Must be a bare filename — no directory separators or traversal
  if (name !== basename(name)) return false;
  if (name.includes("..")) return false;
  // Only allow safe characters in the filename
  if (!/^[a-zA-Z0-9_.-]+\.db$/.test(name)) return false;
  return true;
}

const DB_PATH = resolve(process.env.DATABASE_URL?.replace("file:", "") || "./prisma/dev.db");
const BACKUP_DIR = resolve("./backups");

// Ensure backup directory exists
function ensureBackupDir() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ── GET — List existing backups ──
export async function GET() {
  try {
    ensureBackupDir();

    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const fpath = join(BACKUP_DIR, f);
        const stat = statSync(fpath);
        return {
          name: f,
          size: stat.size,
          created: stat.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return NextResponse.json({ success: true, data: files });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to list backups");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST — Create a new backup ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }
    const { action } = body;
    if (action === "restore") {
      const safetyError = requireSafeModeOff("backup_restore", body);
      if (safetyError) return safetyError;
      // ponytail: fail closed until DATA-01 provides a quiesced, consistent restore.
      return NextResponse.json({
        success: false,
        error: "Restore is maintenance-only and unavailable in the panel until a consistent, integrity-checked restore is implemented.",
      }, { status: 503 });
    }
    if (action !== undefined && action !== "create") {
      return NextResponse.json({ success: false, error: "Invalid backup action" }, { status: 400 });
    }
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many backup operations. Try again later." },
        { status: 429 }
      );
    }
    // Default: create backup
    ensureBackupDir();

    if (!existsSync(DB_PATH)) {
      return NextResponse.json(
        { success: false, error: "Database file not found" },
        { status: 404 }
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `backup_${timestamp}.db`;
    const destination = join(BACKUP_DIR, backupFile);

    copyFileSync(DB_PATH, destination);

    auditLog({ action: "backup_create", details: `Created ${backupFile}`, ip }).catch(() => {});

    const stat = statSync(destination);

    return NextResponse.json({
      success: true,
      data: {
        name: backupFile,
        size: stat.size,
        created: stat.birthtime.toISOString(),
      },
      message: `Backup created: ${backupFile}`,
    });
  } catch (error) {
    const msg = safeErrorMessage(error, "Backup failed");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── DELETE — Remove a backup ──
export async function DELETE(request: NextRequest) {
  try {
    const safetyError = requireSafeModeOff("backup_delete", {
      safeModeOff: request.headers.get("X-Safe-Mode-Off") === "true",
    });
    if (safetyError) return safetyError;
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!isValidBackupName(name)) {
      return NextResponse.json(
        { success: false, error: "Invalid backup name" },
        { status: 400 }
      );
    }

    const backupPath = join(BACKUP_DIR, name);
    if (!existsSync(backupPath)) {
      return NextResponse.json(
        { success: false, error: "Backup not found" },
        { status: 404 }
      );
    }

    const { unlinkSync } = await import("fs");
    unlinkSync(backupPath);

    const ip = getClientIp(request);
    auditLog({ action: "backup_delete", details: `Deleted ${name}`, ip }).catch(() => {});

    return NextResponse.json({ success: true, message: `Deleted ${name}` });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to delete backup");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
