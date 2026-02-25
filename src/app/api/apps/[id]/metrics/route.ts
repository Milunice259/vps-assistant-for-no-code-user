import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Valid time ranges and their millisecond durations */
const RANGE_MS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Target number of data points to return for chart readability.
 * For longer ranges we downsample by taking every Nth point.
 */
const TARGET_POINTS = 360;

export interface MetricPoint {
  time: string;   // ISO timestamp
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
}

/**
 * GET /api/apps/[id]/metrics?range=1h|6h|24h|7d|30d
 *
 * Returns historical metric data points for charts.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<{ points: MetricPoint[] }>>> {
  try {
    const { id: appId } = await context.params;
    const url = new URL(request.url);
    const range = url.searchParams.get("range") || "1h";

    const durationMs = RANGE_MS[range];
    if (!durationMs) {
      return NextResponse.json(
        { success: false, error: `Invalid range: ${range}. Use: ${Object.keys(RANGE_MS).join(", ")}` },
        { status: 400 }
      );
    }

    const since = new Date(Date.now() - durationMs);

    // Fetch raw metrics from DB
    const raw = await prisma.appMetric.findMany({
      where: {
        appId,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: {
        cpuUsage: true,
        memUsage: true,
        netIn: true,
        netOut: true,
        timestamp: true,
      },
    });

    // Downsample if too many points
    let points: MetricPoint[];

    if (raw.length <= TARGET_POINTS) {
      // No downsampling needed
      points = raw.map((m) => ({
        time: m.timestamp.toISOString(),
        cpu: m.cpuUsage,
        mem: m.memUsage,
        netIn: m.netIn ?? 0,
        netOut: m.netOut ?? 0,
      }));
    } else {
      // Downsample: take every Nth point
      const step = Math.ceil(raw.length / TARGET_POINTS);
      points = [];
      for (let i = 0; i < raw.length; i += step) {
        // Average the bucket [i, i+step)
        const bucket = raw.slice(i, Math.min(i + step, raw.length));
        const avgCpu = bucket.reduce((s, m) => s + m.cpuUsage, 0) / bucket.length;
        const avgMem = bucket.reduce((s, m) => s + m.memUsage, 0) / bucket.length;
        const avgNetIn = bucket.reduce((s, m) => s + (m.netIn ?? 0), 0) / bucket.length;
        const avgNetOut = bucket.reduce((s, m) => s + (m.netOut ?? 0), 0) / bucket.length;
        // Use middle timestamp of bucket
        const midIdx = Math.floor(bucket.length / 2);
        points.push({
          time: bucket[midIdx].timestamp.toISOString(),
          cpu: Math.round(avgCpu * 100) / 100,
          mem: Math.round(avgMem * 100) / 100,
          netIn: Math.round(avgNetIn),
          netOut: Math.round(avgNetOut),
        });
      }
    }

    return NextResponse.json({ success: true, data: { points } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch metrics";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
