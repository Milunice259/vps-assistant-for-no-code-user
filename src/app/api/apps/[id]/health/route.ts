import { authorizeApp } from "@/lib/app-access";
import { NextRequest, NextResponse } from "next/server";
import { checkAppReadiness, type AppReadiness } from "@/lib/app-readiness";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse<ApiResponse<AppReadiness>>> {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, false);
    if (denied) return denied;
    return NextResponse.json({ success: true, data: await checkAppReadiness(id) });
  } catch {
    return NextResponse.json({ success: false, error: "Health check failed; readiness is unverified" }, { status: 500 });
  }
}
