import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeRole, roleRank } from "@/lib/server-access";
import { runNotificationChecks, type NotificationCheckSummary } from "@/lib/notification-checks";
import { safeErrorMessage } from "@/lib/safe-error";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse<ApiResponse<NotificationCheckSummary>>> {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (roleRank[normalizeRole(session.role)] < roleRank.MANAGER) return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    const data = await runNotificationChecks(session);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error, "Failed to check notifications") }, { status: 500 });
  }
}
