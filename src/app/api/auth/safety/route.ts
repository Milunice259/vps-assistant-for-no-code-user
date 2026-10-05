import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ADVANCED_COOKIE, ADVANCED_MAX_AGE, createAdvancedToken, verifyAdvancedToken } from "@/lib/operation-safety";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Session expired" }, { status: 401, headers });
  const cookieStore = await cookies();
  const grant = await verifyAdvancedToken(cookieStore.get(ADVANCED_COOKIE)?.value, session);
  return NextResponse.json({ success: true, data: { safeMode: !grant, expiresAt: grant?.exp ? grant.exp * 1000 : null } }, { headers });
}

export async function POST(request: NextRequest) {
  // Defense in depth: this endpoint must not mint grants outside a same-origin browser action.
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    const url = new URL(origin || "");
    // Next's URL can contain the internal listener behind a proxy; use Host, never forwarded headers.
    if (!host || url.host !== host || url.origin !== origin ||
      !["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error("Invalid origin");
  } catch {
    return NextResponse.json({ success: false, error: "Same-origin request required" }, { status: 403, headers });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Session expired" }, { status: 401, headers });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.safeMode !== "boolean") return NextResponse.json({ success: false, error: "Safe Mode choice required" }, { status: 400, headers });
  const cookieStore = await cookies();
  if (body.safeMode) {
    cookieStore.delete(ADVANCED_COOKIE);
    return NextResponse.json({ success: true, data: { safeMode: true, expiresAt: null } }, { headers });
  }
  if (!can(session.role, "MANAGER")) return NextResponse.json({ success: false, error: "Manager access required for Advanced Mode" }, { status: 403, headers });
  if (body.acknowledged !== true) return NextResponse.json({ success: false, error: "Acknowledge the server-change risk first" }, { status: 400, headers });
  if (typeof session.jti !== "string" || !session.jti.trim()) {
    return NextResponse.json({ success: false, error: "Sign in again to enable Advanced Mode" }, { status: 403, headers });
  }
  const token = await createAdvancedToken(session);
  const grant = await verifyAdvancedToken(token, session);
  if (!grant?.exp) return NextResponse.json({ success: false, error: "Unable to authorize Advanced Mode" }, { status: 503, headers });
  cookieStore.set(ADVANCED_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.min(ADVANCED_MAX_AGE, grant.exp - Math.floor(Date.now() / 1000)),
  });
  return NextResponse.json({ success: true, data: { safeMode: false, expiresAt: grant.exp * 1000 } }, { headers });
}
