import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

interface SecurityStatus {
  session: string;
  csrf: string;
  rateLimit: string;
  headers: string;
  audit: string;
}

export async function GET(): Promise<NextResponse<ApiResponse<SecurityStatus>>> {
  return NextResponse.json({
    success: true,
    data: {
      session: "HttpOnly, Secure in production, SameSite=Lax, 24h expiry with refresh",
      csrf: "Mutable API requests require same-origin Origin header",
      rateLimit: "Global API limit plus stricter login lockout",
      headers: "nosniff, deny framing, strict referrer, no camera/microphone/geolocation",
      audit: "Login, failed login, package install, and server-changing actions are audited",
    },
  });
}
