"use client";

import { useSSE } from "@/hooks/useSSE";
import type { SystemStats } from "@/types";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { CpuGauge } from "@/components/dashboard/CpuGauge";
import { MemoryBar } from "@/components/dashboard/MemoryBar";
import { DiskUsage } from "@/components/dashboard/DiskUsage";
import { QuickOverview } from "@/components/dashboard/QuickOverview";
import { OnboardingWizard } from "@/components/dashboard/OnboardingWizard";
import { Cpu, MemoryStick, HardDrive, Clock, Server, Wifi } from "lucide-react";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function DashboardPage() {
  const { data: stats, connected, error } = useSSE<SystemStats>("/api/stats/stream");

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-800 rounded-xl text-red-400">
        <p className="font-medium">Connection Error</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Connecting to host...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-sm">
        <Wifi className={`w-4 h-4 ${connected ? "text-green-400" : "text-gray-600"}`} />
        <span className={connected ? "text-green-400" : "text-gray-500"}>
          {connected ? "Live" : "Disconnected"}
        </span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">{stats.hostname}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500 text-xs">{stats.platform}</span>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="CPU Usage"
          value={`${stats.cpu.usagePercent.toFixed(1)}%`}
          subtitle={`${stats.cpu.cores} cores`}
          icon={<Cpu className="w-5 h-5" />}
        />
        <StatsCard
          title="Memory"
          value={`${stats.memory.usagePercent.toFixed(1)}%`}
          subtitle={`${(stats.memory.used / 1e9).toFixed(1)} / ${(stats.memory.total / 1e9).toFixed(1)} GB`}
          icon={<MemoryStick className="w-5 h-5" />}
        />
        <StatsCard
          title="Disk"
          value={`${stats.disk.usagePercent.toFixed(1)}%`}
          subtitle={`${(stats.disk.used / 1e9).toFixed(1)} / ${(stats.disk.total / 1e9).toFixed(1)} GB`}
          icon={<HardDrive className="w-5 h-5" />}
        />
        <StatsCard
          title="Uptime"
          value={typeof stats.uptime === "number" ? formatUptime(stats.uptime) : stats.uptime}
          subtitle="Since last reboot"
          icon={<Clock className="w-5 h-5" />}
        />
      </div>

      {/* Onboarding wizard — visible after core health so operators see risk first. */}
      <OnboardingWizard />

      {/* Quick Overview — Clickable resource panels */}
      <QuickOverview />

      {/* Detailed Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
            <Server className="w-4 h-4" />
            CPU Load
          </h3>
          <div className="flex justify-center">
            <CpuGauge percentage={stats.cpu.usagePercent} />
          </div>
          <p className="text-center text-xs text-gray-500 mt-3">
            {stats.cpu.model}
          </p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
            <MemoryStick className="w-4 h-4" />
            Memory Usage
          </h3>
          <MemoryBar
            total={stats.memory.total}
            used={stats.memory.used}
            available={stats.memory.available}
          />
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            Disk Space
          </h3>
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
