import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isLocalAppId, parseLocalContainerId, execLocal } from "@/lib/local-server";
import { createSSEResponse } from "@/lib/sse-stream";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface AppStreamData {
  status: string;
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  netIn: number;
  netOut: number;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id: appId } = await context.params;

  return createSSEResponse<AppStreamData>(
    async () => {
      // Resolve container ID — from DB or from local:: prefix
      let containerId: string | null = null;
      let status = "UNKNOWN";

      if (isLocalAppId(appId)) {
        containerId = parseLocalContainerId(appId);
        // Check if container is running
        try {
          const state = execLocal(
            `docker inspect --format "{{.State.Status}}" ${containerId.replace(/[^a-zA-Z0-9_.-]/g, "")}`,
            5_000
          ).trim();
          status = state === "running" ? "RUNNING" : state === "exited" ? "STOPPED" : state.toUpperCase();
        } catch {
          status = "UNKNOWN";
        }
      } else {
        const app = await prisma.app.findUnique({
          where: { id: appId },
          select: { containerId: true, status: true },
        });
        containerId = app?.containerId ?? null;
        status = app?.status ?? "UNKNOWN";
      }

      if (!containerId) {
        return { status, cpuPercent: 0, memUsageMB: 0, memLimitMB: 0, netIn: 0, netOut: 0 };
      }

      // Get live container stats
      try {
        const raw = execLocal(
          `docker stats ${containerId} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}"`,
          10_000
        );
        const parts = raw.trim().split("|");

        const cpuPercent = parseFloat(parts[0]?.replace("%", "") || "0");

        // Parse memory: "123.4MiB / 512MiB"
        const memParts = (parts[1] || "").split("/");
        const memUsageMB = parseMem(memParts[0] || "0");
        const memLimitMB = parseMem(memParts[1] || "0");

        // Parse network: "1.23kB / 4.56kB"
        const netParts = (parts[2] || "").split("/");
        const netIn = parseBytes(netParts[0] || "0");
        const netOut = parseBytes(netParts[1] || "0");

        return { status, cpuPercent, memUsageMB, memLimitMB, netIn, netOut };
      } catch {
        return {
          status,
          cpuPercent: 0,
          memUsageMB: 0,
          memLimitMB: 0,
          netIn: 0,
          netOut: 0,
        };
      }
    },
    10_000,  // check every 10s
    30_000   // heartbeat every 30s
  );
}

// ── Helpers ──

function parseMem(s: string): number {
  const trimmed = s.trim();
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  if (trimmed.includes("GiB")) return num * 1024;
  if (trimmed.includes("MiB")) return num;
  if (trimmed.includes("KiB")) return num / 1024;
  return num;
}

function parseBytes(s: string): number {
  const trimmed = s.trim();
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  if (trimmed.includes("GB")) return num * 1e9;
  if (trimmed.includes("MB")) return num * 1e6;
  if (trimmed.includes("kB")) return num * 1e3;
  if (trimmed.includes("B")) return num;
  return num;
}
