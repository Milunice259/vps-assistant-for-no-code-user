/**
 * SSE stream for deployment list — replaces 10s polling.
 * Sends full snapshot on connect, then only delta changes every 5s.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDeployments } from "@/app/api/deploy/route";
import { createSSEResponse } from "@/lib/sse-stream";
import type { DeploymentInfo } from "@/types";

export const dynamic = "force-dynamic";

// Wrapper: createSSEResponse expects Record<string, unknown>
// so we wrap the array in an object
interface DeployStreamData {
  deployments: DeploymentInfo[];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const response = createSSEResponse<DeployStreamData>(
    async () => {
      const current = await getSession();
      // Recheck permissions for every snapshot; never share another user's logs.
      return { deployments: current?.sub === session.sub ? await getDeployments(current) : [] };
    },
    5_000,   // check for changes every 5s (deploy status can change fast)
    30_000   // heartbeat every 30s
  );
  response.headers.set("Cache-Control", "private, no-store, no-transform");
  response.headers.set("Vary", "Cookie");
  return response;
}
