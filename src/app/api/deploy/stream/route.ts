/**
 * SSE stream for deployment list — replaces 10s polling.
 * Sends full snapshot on connect, then only delta changes every 5s.
 */

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
  return createSSEResponse<DeployStreamData>(
    async () => ({ deployments: await getDeployments() }),
    5_000,   // check for changes every 5s (deploy status can change fast)
    30_000   // heartbeat every 30s
  );
}
