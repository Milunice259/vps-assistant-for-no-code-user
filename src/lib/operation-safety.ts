import { NextResponse } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { can } from "./permissions";

export const DANGEROUS_ACTIONS = new Set([
  "terminal_execute",
  "cron_add",
  "cron_delete",
  "backup_restore",
  "backup_delete",
  "deploy_git",
  "deploy_docker",
  "sync-time",
  "container_start",
  "container_stop",
  "container_restart",
  "service_start",
  "service_stop",
  "service_restart",
  "service_enable",
  "service_disable",
  "firewall_block-port",
  "firewall_allow-port",
  "os-update",
  "docker-prune",
  "clear-apt-cache",
  "clear-logs",
  "clear-temp",
  "remove-old-kernels",
  "firewall-reload",
  "ban-ip",
  "unban-ip",
  "unban-all",
  "restart-docker",
  "restart-server",
  "package_install",
  "package_update",
  "package_upgrade",
  "deploy_requirement_install",
]);

export const ADVANCED_COOKIE = "vps-advanced";
export const ADVANCED_MAX_AGE = 15 * 60;
type SafetySession = JWTPayload & { sub: string; role: string; forceLogoutVersion: number };

function signingKey() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function createAdvancedToken(session: SafetySession): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!can(session.role, "MANAGER") || typeof session.jti !== "string" || !session.jti.trim() || !Number.isSafeInteger(session.iat) || !session.exp || session.exp <= now) throw new Error("Advanced authorization unavailable");
  return new SignJWT({ sessionIssuedAt: session.iat, sessionId: session.jti, forceLogoutVersion: session.forceLogoutVersion, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setAudience(ADVANCED_COOKIE)
    .setIssuedAt(now)
    .setExpirationTime(Math.min(now + ADVANCED_MAX_AGE, session.exp))
    .sign(signingKey());
}

export async function verifyAdvancedToken(token: string | undefined, session: SafetySession): Promise<JWTPayload | null> {
  if (!token || !can(session.role, "MANAGER") || typeof session.jti !== "string" || !session.jti.trim()) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"], audience: ADVANCED_COOKIE });
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== session.sub || payload.sessionIssuedAt !== session.iat || payload.sessionId !== session.jti ||
      payload.forceLogoutVersion !== session.forceLogoutVersion || payload.role !== session.role ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      payload.iat! > now || payload.exp! <= payload.iat! || payload.exp! - payload.iat! > ADVANCED_MAX_AGE || payload.exp! > (session.exp ?? 0)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Allowlist only actual previews/diagnostics; unknown actions never bypass the cookie guard.
const READ_ONLY_ACTIONS = new Set(["system-health-check", "security-check", "os-version-check", "docker-stats", "connection-stats", "check-disk", "check-uptime", "check-memory", "check-connections", "check-docker-version"]);
export function requiresAdvancedAuthorization(pathname: string, method: string, body: Record<string, unknown> | null): boolean {
  const packages = pathname === "/api/network/packages" || /^\/api\/servers\/[^/]+\/packages$/.test(pathname);
  if (method === "GET") return false;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  if (pathname === "/api/backup") return method === "DELETE" || (method === "POST" && body?.action === "restore");
  if (pathname === "/api/deploy") return method === "POST" && (!body || Boolean(body.serverId && body.serverId !== "local")); // local Git analysis does not deploy
  if (pathname.startsWith("/api/deploy/")) return !["/api/deploy/preflight", "/api/deploy/requirements"].includes(pathname);
  if (pathname === "/api/apps" || pathname.startsWith("/api/apps/")) return true;
  if (packages) return true;
  if (/^\/api\/servers\/[^/]+\/actions$/.test(pathname)) return typeof body?.action !== "string" || !READ_ONLY_ACTIONS.has(body.action);
  if (/^\/api\/servers\/[^/]+\/network\/firewall$/.test(pathname)) return body?.mode !== "dry-run";
  return /^\/api\/servers\/[^/]+\/(terminal|cron|docker\/action|services\/action|dependencies\/install)$/.test(pathname);
}

export type SafetyBody = { safeModeOff?: boolean };

export function requireSafeModeOff(action: string, body: SafetyBody) {
  if (!DANGEROUS_ACTIONS.has(action)) return null;
  if (body.safeModeOff === true) return null;
  return NextResponse.json(
    { success: false, error: "Safe Mode is on. Turn it off before running this dangerous action." },
    { status: 423 },
  );
}
