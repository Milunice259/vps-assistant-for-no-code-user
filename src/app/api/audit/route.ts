/**
 * API: /api/audit
 * Query audit logs with pagination and filtering.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25")));
    const action = searchParams.get("action") || undefined;

    const where = action ? { action } : {};

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: entries, total });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch audit logs";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
