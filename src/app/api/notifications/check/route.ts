import { NextResponse } from "next/server";
import { runNotificationChecks, type NotificationCheckSummary } from "@/lib/notification-checks";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse<ApiResponse<NotificationCheckSummary>>> {
  const data = await runNotificationChecks();
  return NextResponse.json({ success: true, data });
}
