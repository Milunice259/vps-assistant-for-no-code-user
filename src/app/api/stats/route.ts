import { NextResponse } from "next/server";
import { getHostStats, subscribeStats } from "@/lib/stats";
import type { ApiResponse, SystemStats } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResponse<SystemStats>>> {
  // Temporarily subscribe so the CPU sampler takes at least one reading.
  // This ensures the snapshot has a non-zero CPU% even when no SSE stream
  // is active.  The unsubscribe call in the finally block stops the sampler
  // if no other subscribers exist.
  const unsubscribe = subscribeStats();
  try {
    const stats = getHostStats();

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get stats";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  } finally {
    unsubscribe();
  }
}
