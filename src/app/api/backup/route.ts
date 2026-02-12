/**
 * API: /api/backup
 * Database backup and restore operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.firstAttempt > WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 300_000).unref();

/**
 * Validate a backup filename — must be a plain .db filename with no path traversal.
 */
function isValidBackupName(name: string | null | undefined): name is string {
  if (!name || !name.endsWith(".db")) return false;
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
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many backup operations. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { action } = body as { action?: string };

    if (action === "restore") {
      // Restore from a backup
      const { name } = body as { name: string };
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

      // Create a pre-restore backup first
      ensureBackupDir();
      const preRestoreFile = `pre-restore_${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
      copyFileSync(DB_PATH, join(BACKUP_DIR, preRestoreFile));

      // Restore
      copyFileSync(backupPath, DB_PATH);

      auditLog({ action: "backup_restore", details: `Restored from ${name}`, ip }).catch(() => {});

      return NextResponse.json({
        success: true,
        message: `Restored from ${name}. Pre-restore backup saved as ${preRestoreFile}.`,
      });
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
