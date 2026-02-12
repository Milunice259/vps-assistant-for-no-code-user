/**
 * Next.js Middleware - Auth guard + CSRF protection.
 * - Protects all routes under /(panel)/ by checking the JWT cookie.
 * - Validates Origin header on mutable requests (POST/PUT/DELETE/PATCH).
 * - Redirects unauthenticated users to /login.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vps-session";

// Routes that do NOT require authentication
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

// HTTP methods that mutate state
const MUTABLE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // ── CSRF Protection ──
  // Block cross-origin mutable requests for ALL API routes
  if (pathname.startsWith("/api/") && MUTABLE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json(
            { success: false, error: "Cross-origin request blocked" },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, error: "Invalid origin" },
          { status: 403 }
        );
      }
    }
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── Auth check ──
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, getJwtSecret());
    return NextResponse.next();
  } catch {
    // Invalid or expired token
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

export const config = {
  matcher: [
    // Match all paths except static files and public API
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
