import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { getGeneralSettings, saveGeneralSettings, validateGeneralSettings, SCHEDULE_CAPABILITIES } from "@/lib/general-settings";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await getGeneralSettings(), schedules: SCHEDULE_CAPABILITIES });
  } catch {
    return NextResponse.json({ success: false, error: "Settings unavailable" }, { status: 500 });
  }
}
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "OWNER") return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!validateGeneralSettings(body)) return NextResponse.json({ success: false, error: "Invalid settings: check name, restart policy, memory and schedule ranges" }, { status: 400 });
  try {
    const saved = await saveGeneralSettings(body);
    await auditLog({ action: "general_settings_updated", userId: session.sub as string, username: session.username as string, ip: getClientIp(request), details: "Updated Docker defaults, branding and inactive schedule preferences" });
    return NextResponse.json({ success: true, data: saved, schedules: SCHEDULE_CAPABILITIES });
  } catch {
    return NextResponse.json({ success: false, error: "Save or readback failed; reload settings before retrying" }, { status: 500 });
  }
}
