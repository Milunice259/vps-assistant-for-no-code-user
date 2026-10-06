/**
 * API: /api/backup
 * Panel SQLite database snapshots only; online restore is deliberately unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPanelBackup, deletePanelBackup, isValidBackupName, listPanelBackups } from "@/lib/panel-backup";
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

// ── GET — List existing backups ──
export async function GET() {
  try {
    const files = await listPanelBackups(prisma);
    return NextResponse.json({ success: true, data: files, scope: "panel-database" });
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
    const backup = await createPanelBackup(prisma);
    auditLog({ action: "backup_create", details: `Created panel database snapshot ${backup.name}; integrity check: ok`, ip }).catch(() => {});
    return NextResponse.json({
      success: true,
      data: backup,
      message: `Panel database backup created: ${backup.name}. VPS apps and volumes are not included.`,
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

    if (!await deletePanelBackup(prisma, name)) {
      return NextResponse.json(
        { success: false, error: "Backup not found" },
        { status: 404 }
      );
    }

    const ip = getClientIp(request);
    auditLog({ action: "backup_delete", details: `Deleted ${name}`, ip }).catch(() => {});

    return NextResponse.json({ success: true, message: `Deleted ${name}` });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to delete backup");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
