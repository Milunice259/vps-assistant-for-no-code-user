import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { getMonitoringStatus, saveMonitoringConfig, validateMonitoringConfig } from "@/lib/monitoring-scheduler";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await getMonitoringStatus() });
  } catch {
    return NextResponse.json({ success: false, error: "Monitoring status unavailable" }, { status: 503 });
  }
}
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "OWNER") return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!validateMonitoringConfig(body)) return NextResponse.json({ success: false, error: "Expected enabled (boolean) and intervalSeconds (30–3600)" }, { status: 400 });
  // Safe Mode policy: configuration only enables read-only diagnostics and existing configured alerts.
  // It never executes deployments, repairs, restarts or other privileged server mutations.
  try {
    await saveMonitoringConfig(body);
    await auditLog({ action: "general_settings_updated", userId: session.sub, username: session.username, ip: getClientIp(request), details: JSON.stringify(body) });
    return NextResponse.json({ success: true, data: await getMonitoringStatus() });
  } catch {
    return NextResponse.json({ success: false, error: "Save or readback failed; reload before retrying" }, { status: 500 });
  }
}
