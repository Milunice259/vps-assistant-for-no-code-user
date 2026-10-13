import { authorizeApp } from "@/lib/app-access";
import { NextRequest, NextResponse } from "next/server";
import { MONITORING_RANGES, readMonitoringHistory } from "@/lib/monitoring-metrics";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, false);
    if (denied) return denied;
    const range = new URL(request.url).searchParams.get("range") || "1h";
    if (!Object.hasOwn(MONITORING_RANGES, range)) return NextResponse.json({ success: false, error: "Invalid metric range" }, { status: 400 });
    return NextResponse.json({ success: true, data: await readMonitoringHistory(id, range) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ success: false, error: "Metric history unavailable" }, { status: 500 });
  }
}
