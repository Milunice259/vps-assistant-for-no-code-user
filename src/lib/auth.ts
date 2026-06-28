/**
 * Authentication utilities.
 * - bcrypt for password hashing
 * - jose (JWT) for stateless sessions in HttpOnly cookies
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getSecuritySettings } from "./security-settings";

const SESSION_COOKIE = "vps-session";
const SESSION_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds
const SESSION_REFRESH_AFTER = 12 * 60 * 60; // Refresh after 12 hours

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

// ─── Password ───

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT Session ───

export interface SessionPayload extends JWTPayload {
  sub: string; // userId
  username: string;
  role: string; // "ADMIN" | "OPERATOR" | "VIEWER"
}

export async function createSessionToken(
  userId: string,
  username: string,
  role: string = "ADMIN",
  maxAgeSeconds: number = SESSION_MAX_AGE
): Promise<string> {
  const { forceLogoutVersion } = await getSecuritySettings();
  return new SignJWT({ sub: userId, username, role, forceLogoutVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const { forceLogoutVersion } = await getSecuritySettings();
    if (Number(payload.forceLogoutVersion ?? 0) < forceLogoutVersion) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

// ─── Cookie Helpers ───

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Check if the session token should be silently refreshed.
 * Returns a new token if the current one is past 50% of its lifetime.
 */
export async function refreshSessionIfNeeded(): Promise<string | null> {
  const session = await getSession();
  if (!session || !session.iat) return null;

  const age = Math.floor(Date.now() / 1000) - (session.iat as number);
  if (age > SESSION_REFRESH_AFTER) {
    // Issue a fresh token with same claims
    return createSessionToken(
      session.sub as string,
      session.username as string,
      session.role as string
    );
  }
  return null;
}

export async function setSessionCookie(token: string, maxAgeSeconds: number = SESSION_MAX_AGE): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
