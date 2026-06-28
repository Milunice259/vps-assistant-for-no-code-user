import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { getSecuritySettings } from "@/lib/security-settings";
import type { ApiResponse, UserInfo, LoginInput } from "@/types";

export const dynamic = "force-dynamic";

// ─── In-memory rate limiter ───

interface RateEntry {
  count: number;
  firstAttempt: number;
}

const rateLimitMap = new Map<string, RateEntry>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 60 seconds

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return false;
  }

  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    return true;
  }

  return false;
}

// Periodic cleanup to prevent memory leak (every 5 minutes)
const _loginCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.firstAttempt > WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
}, 300_000);
if (typeof _loginCleanup === "object" && _loginCleanup && "unref" in _loginCleanup) {
  (_loginCleanup as NodeJS.Timeout).unref();
}

// ─── Route handler ───

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<UserInfo>>> {
  try {
    // ── Rate limiting ──
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (isRateLimited(ip)) {
      await auditLog({ action: "login_failed", username: "unknown", ip, details: "Rate limited" });
      return NextResponse.json(
        { success: false, error: "Too many login attempts. Try again later." },
        { status: 429 }
      );
    }

    const body = (await request.json()) as LoginInput;
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Find user in database
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Verify password against stored hash
    const isValid = await verifyPassword(password, user.passwordHash);

    if (!isValid) {
      await auditLog({ action: "login_failed", username, ip, details: "Invalid password" });
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Create JWT and set HttpOnly cookie
    const { sessionMaxAgeHours } = await getSecuritySettings();
    const maxAgeSeconds = sessionMaxAgeHours * 60 * 60;
    const token = await createSessionToken(user.id, user.username, user.role, maxAgeSeconds);
    await setSessionCookie(token, maxAgeSeconds);

    await auditLog({ action: "login", userId: user.id, username: user.username, ip });

    return NextResponse.json({
      success: true,
      data: { id: user.id, username: user.username },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Login failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
