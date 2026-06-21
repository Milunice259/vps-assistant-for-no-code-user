/**
 * Audit Logger — Records security-sensitive actions to the database.
 * Logs server management, container actions, system commands, and auth events.
 */

import { prisma } from "@/lib/db";

export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "server_create"
  | "server_update"
  | "server_delete"
  | "container_start"
  | "container_stop"
  | "container_restart"
  | "container_delete"
  | "service_start"
  | "service_stop"
  | "service_restart"
  | "service_enable"
  | "service_disable"
  | "deploy_git"
  | "deploy_docker"
  | "deploy_compose"
  | "system_update"
  | "system_reboot"
  | "docker_prune"
  | "package_install"
  | "package_upgrade"
  | "file_browse"
  | "quick_action"
  | "backup_create"
  | "backup_restore"
  | "backup_delete"
  | "user_created"
  | "user_updated"
  | "user_deleted"
  | "deployment_rollback";

interface AuditEntry {
  action: AuditAction;
  userId?: string;
  username?: string;
  target?: string;        // e.g., server name, container ID
  details?: string;       // extra context
  ip?: string;
}

/**
 * Record an audit log entry. Fire-and-forget — errors are caught silently.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        username: entry.username ?? "system",
        target: entry.target ?? null,
        details: entry.details ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    // Never let audit logging crash the request
    console.error("[audit] Failed to write audit log:", error);
  }
}

/**
 * Extract client IP from a Request object.
 */
export function getClientIp(request: Request): string {
  const headers = new Headers(request.headers);
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
