/**
 * SSE stream for dashboard summary — replaces 30s polling.
 * Sends full snapshot on connect, then only delta changes every 10s.
 */

import { getDashboardSummary } from "@/app/api/dashboard/summary/route";
import { createSSEResponse } from "@/lib/sse-stream";
import type { DashboardSummary } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return createSSEResponse<DashboardSummary>(
    () => getDashboardSummary(),
    10_000,  // check for changes every 10s
    30_000   // heartbeat every 30s
  );
}
