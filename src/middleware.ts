/**
 * Next.js Middleware - Auth guard + CSRF protection + Rate limiting.
 * - Protects all routes under /(panel)/ by checking the JWT cookie.
 * - Validates Origin header on mutable requests (POST/PUT/DELETE/PATCH).
 * - Rejects mutable requests without an Origin header (CSRF defense).
 * - Applies global API rate limiting per IP (100 req/min).
 * - Redirects unauthenticated users to /login.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vps-session";

// Routes that do NOT require authentication
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

// HTTP methods that mutate state
const MUTABLE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const ROLE_LEVEL = { VIEWER: 0, MANAGER: 1, OPERATOR: 1, ADMIN: 2, OWNER: 3 } as const;
type Role = keyof typeof ROLE_LEVEL;

// ── Global API Rate Limiter (in-memory) ──
const API_RATE_LIMIT = 100;       // ponytail: Edge middleware cannot read DB settings; move rate limiting to Node/API proxy for runtime tuning.
const API_RATE_WINDOW = 60_000;   // 1 minute window

interface RateEntry {
  count: number;
  resetAt: number;
}

const apiRateMap = new Map<string, RateEntry>();

function checkRateLimit(ip: string, limit: number): { limited: boolean; remaining: number } {
  const now = Date.now();
  const entry = apiRateMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    apiRateMap.set(ip, { count: 1, resetAt: now + API_RATE_WINDOW });
    return { limited: false, remaining: limit - 1 };
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  return { limited: entry.count > limit, remaining };
}

// Cleanup stale entries every 5 minutes
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of apiRateMap) {
    if (now >= entry.resetAt) apiRateMap.delete(ip);
  }
}, 300_000);
if (typeof _cleanupTimer === "object" && _cleanupTimer && "unref" in _cleanupTimer) {
  (_cleanupTimer as NodeJS.Timeout).unref();
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(secret);
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function requiredRole(pathname: string, method: string): Role {
  if (!MUTABLE_METHODS.has(method)) return "VIEWER";
  if (pathname.startsWith("/api/auth/")) return "VIEWER";
  if (pathname.startsWith("/api/users") || pathname === "/api/backup") return "ADMIN";
  return "OPERATOR";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── Global API Rate Limiting ──
  if (pathname.startsWith("/api/")) {
    const ip = getClientIp(request);
    const { limited, remaining } = checkRateLimit(ip, API_RATE_LIMIT);

    if (limited) {
      return withSecurityHeaders(NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(API_RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
          },
        }
      ));
    }

    // ── CSRF Protection ──
    // Require Origin header on all mutable API requests
    if (MUTABLE_METHODS.has(request.method)) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");

      // Reject requests without Origin header (closes null-origin bypass)
      if (!origin) {
        return withSecurityHeaders(NextResponse.json(
          { success: false, error: "Origin header required for state-changing requests" },
          { status: 403 }
        ));
      }

      if (host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return withSecurityHeaders(NextResponse.json(
              { success: false, error: "Cross-origin request blocked" },
              { status: 403 }
            ));
          }
        } catch {
          return withSecurityHeaders(NextResponse.json(
            { success: false, error: "Invalid origin" },
            { status: 403 }
          ));
        }
      }
    }

    // Attach rate limit headers to API responses
    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", String(API_RATE_LIMIT));
    response.headers.set("X-RateLimit-Remaining", String(remaining));

    // Continue to auth check only for non-public paths
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      return withSecurityHeaders(response);
    }

    // ── API Auth check ──
    const apiToken = request.cookies.get(SESSION_COOKIE)?.value;
    if (!apiToken) {
      return withSecurityHeaders(NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ));
    }

    try {
      const { payload } = await jwtVerify(apiToken, getJwtSecret());
      const role = (payload.role as Role) || "VIEWER";
      if ((ROLE_LEVEL[role] ?? 0) < ROLE_LEVEL[requiredRole(pathname, request.method)]) {
        return withSecurityHeaders(NextResponse.json(
          { success: false, error: "Insufficient permissions" },
          { status: 403 }
        ));
      }
      return withSecurityHeaders(response);
    } catch {
      return withSecurityHeaders(NextResponse.json(
        { success: false, error: "Session expired" },
        { status: 401 }
      ));
    }
  }

  // Allow public paths (non-API)
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── Page Auth check ──
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }

  try {
    await jwtVerify(token, getJwtSecret());
    return withSecurityHeaders(NextResponse.next());
  } catch {
    // Invalid or expired token
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return withSecurityHeaders(response);
  }
}

export const config = {
  matcher: [
    // Match all paths except static files and public API
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
