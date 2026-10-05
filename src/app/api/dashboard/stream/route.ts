/**
 * SSE stream for dashboard summary — replaces 30s polling.
 * Sends full snapshot on connect, then only delta changes every 10s.
 */

import { getDashboardSummary } from "@/app/api/dashboard/summary/route";
import { createSSEResponse } from "@/lib/sse-stream";
import type { DashboardSummary } from "@/types";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get("vps-session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!token || !session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessServer(session.sub, session.role, "local"))) {
    return NextResponse.json({ success: false, error: "Local server access required for dashboard summary" }, { status: 403 });
  }
  const response = createSSEResponse<DashboardSummary>(
    async () => {
      // Timer callbacks have no request cookie context; reverify the original login token.
      const current = await verifySessionToken(token);
      if (!current) throw new Error("Unauthorized");
      return getDashboardSummary(current);
    },
    10_000,  // check for changes every 10s
    30_000   // heartbeat every 30s
  );
  response.headers.set("Cache-Control", "private, no-store, no-transform");
  response.headers.set("Vary", "Cookie");
  return response;
}
