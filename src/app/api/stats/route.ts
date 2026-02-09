import { NextResponse } from "next/server";
import { getHostStats } from "@/lib/stats";
import type { ApiResponse, SystemStats } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResponse<SystemStats>>> {
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
  }
}
