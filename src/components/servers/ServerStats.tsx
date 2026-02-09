"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { SystemStats } from "@/types";
import { CpuGauge } from "@/components/dashboard/CpuGauge";
import { MemoryBar } from "@/components/dashboard/MemoryBar";
import { DiskUsage } from "@/components/dashboard/DiskUsage";
import { Button } from "@/components/ui/Button";

interface ServerStatsProps {
  serverId: string;
}

export function ServerStats({ serverId }: ServerStatsProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/stats`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load stats");
      setStats(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchStats}>
          Retry
        </Button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">{stats.hostname}</h3>
          <p className="text-xs text-gray-500">
            {stats.platform} &middot; Uptime: {stats.uptime}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchStats}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div className="flex justify-center rounded-xl bg-gray-800 p-4">
          <CpuGauge percentage={stats.cpu.usagePercent} />
        </div>
        <div className="rounded-xl bg-gray-800 p-4">
          <MemoryBar
            total={stats.memory.total}
            used={stats.memory.used}
            available={stats.memory.available}
          />
        </div>
        <div className="rounded-xl bg-gray-800 p-4">
          <DiskUsage
            total={stats.disk.total}
            used={stats.disk.used}
            available={stats.disk.available}
          />
        </div>
      </div>
    </div>
  );
}
