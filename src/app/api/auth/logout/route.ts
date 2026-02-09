import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse<ApiResponse>> {
  try {
    await clearSessionCookie();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Logout failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
