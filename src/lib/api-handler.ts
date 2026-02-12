/**
 * API Handler Wrapper — Unified auth check + error handling for all API routes.
 *
 * Provides:
 * - JWT session verification (auth guard)
 * - Consistent JSON error responses
 * - Session info passed to handler (user id + username)
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vps-session";

export interface Session {
  userId: string;
  username: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}

export interface ApiContext {
  session: Session;
  params: Record<string, string>;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(secret);
}

type ApiRouteHandler = (
  request: NextRequest,
  context: ApiContext
) => Promise<NextResponse>;

/**
 * Wraps an API route handler with auth check and error handling.
 *
 * Usage:
 * ```ts
 * export const GET = withAuth(async (request, { session, params }) => {
 *   // session.userId, session.username available
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withAuth(handler: ApiRouteHandler) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Record<string, string> }
  ): Promise<NextResponse> => {
    try {
      // ── Verify JWT session ──
      const token = request.cookies.get(SESSION_COOKIE)?.value;

      if (!token) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      let session: Session;
      try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        session = {
          userId: payload.sub as string,
          username: payload.username as string,
          role: (payload.role as Session["role"]) || "VIEWER",
        };
      } catch {
        return NextResponse.json(
          { success: false, error: "Session expired" },
          { status: 401 }
        );
      }

      // ── Execute handler ──
      const params = routeContext?.params ?? {};
      return await handler(request, { session, params });
    } catch (error) {
      console.error("[api]", error);
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  };
}

// ── Role hierarchy ──
const ROLE_LEVEL: Record<string, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  ADMIN: 2,
};

/**
 * Wraps a handler so that only users with a minimum role level can access it.
 *
 * Usage:
 * ```ts
 * export const DELETE = withRole("ADMIN", async (request, { session }) => {
 *   // Only admins reach here
 * });
 * ```
 */
export function withRole(
  minRole: "ADMIN" | "OPERATOR" | "VIEWER",
  handler: ApiRouteHandler
) {
  return withAuth(async (request, context) => {
    const userLevel = ROLE_LEVEL[context.session.role] ?? 0;
    const requiredLevel = ROLE_LEVEL[minRole] ?? 0;

    if (userLevel < requiredLevel) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    return handler(request, context);
  });
}
