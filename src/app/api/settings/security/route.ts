import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSecuritySettings, saveSecuritySettings } from "@/lib/security-settings";
import { auditLog, getClientIp } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResponse>> {
  try {
    return NextResponse.json({ success: true, data: await getSecuritySettings() });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to load security settings") }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (session.role !== "ADMIN") return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });

    const settings = await saveSecuritySettings(await request.json());
    await auditLog({
      action: "security_settings_updated",
      userId: session.sub as string,
      username: session.username as string,
      ip: getClientIp(request),
      details: "Updated security settings",
    });

    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to save security settings") }, { status: 500 });
  }
}
