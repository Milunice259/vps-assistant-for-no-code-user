/**
 * API: /api/audit
 * Query audit logs with pagination and filtering.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/safe-error";
import { getSession } from "@/lib/auth";
import { adminRoles, normalizeRole } from "@/lib/server-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25")));
    const action = searchParams.get("action") || undefined;
    const target = searchParams.get("target") || undefined;

    const where = {
      // ponytail: actor-only until audit entries carry unambiguous server scope.
      ...(!adminRoles.has(normalizeRole(session.role)) ? { userId: session.sub } : {}),
      ...(action ? { action } : {}),
      ...(target ? { target: { contains: target } } : {}),
    };

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: entries, total }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to fetch audit logs");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
