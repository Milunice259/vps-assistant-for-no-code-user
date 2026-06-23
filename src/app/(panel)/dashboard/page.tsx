"use client";

import { useSSE } from "@/hooks/useSSE";
import type { SystemStats } from "@/types";
import { CpuGauge } from "@/components/dashboard/CpuGauge";
import { MemoryBar } from "@/components/dashboard/MemoryBar";
import { DiskUsage } from "@/components/dashboard/DiskUsage";
import { QuickOverview } from "@/components/dashboard/QuickOverview";
import { OnboardingWizard } from "@/components/dashboard/OnboardingWizard";
import { RiskOverview } from "@/components/dashboard/RiskOverview";
import { SafeRepairCenter } from "@/components/dashboard/SafeRepairCenter";
import { Activity, Clock, Cpu, HardDrive, MemoryStick, Server, Wifi } from "lucide-react";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function statusTone(value: number, warn: number, danger: number) {
  if (value >= danger) return "text-red-300 border-red-500/30 bg-red-500/10";
  if (value >= warn) return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
}

export default function DashboardPage() {
  const { data: stats, connected, error } = useSSE<SystemStats>("/api/stats/stream");

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 p-6 text-red-400">
        <p className="font-medium">Connection Error</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-gray-400">Connecting to host...</p>
        </div>
      </div>
    );
  }

  const uptime = typeof stats.uptime === "number" ? formatUptime(stats.uptime) : stats.uptime;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-brand-500/20 bg-gradient-to-br from-gray-900 via-gray-800 to-slate-950 p-5 shadow-2xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${connected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-gray-700 bg-gray-900 text-gray-500"}`}>
                <Wifi className="h-3.5 w-3.5" /> {connected ? "Live" : "Disconnected"}
              </span>
              <span className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-gray-400">{stats.platform}</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold text-white md:text-3xl">Command Center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              One screen for fleet risk, local host health, apps, deployments, and safe maintenance.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:w-[520px]">
            <div className="rounded-2xl border border-gray-700 bg-gray-950/60 p-4">
              <p className="flex items-center gap-2 text-xs text-gray-500"><Server className="h-4 w-4" /> Host</p>
              <p className="mt-2 truncate text-sm font-semibold text-white">{stats.hostname}</p>
            </div>
            <div className="rounded-2xl border border-gray-700 bg-gray-950/60 p-4">
              <p className="flex items-center gap-2 text-xs text-gray-500"><Clock className="h-4 w-4" /> Uptime</p>
              <p className="mt-2 text-sm font-semibold text-white">{uptime}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${statusTone(Math.max(stats.cpu.usagePercent, stats.memory.usagePercent, stats.disk.usagePercent), 75, 88)}`}>
              <p className="flex items-center gap-2 text-xs opacity-80"><Activity className="h-4 w-4" /> Local load</p>
              <p className="mt-2 text-sm font-semibold">{Math.max(stats.cpu.usagePercent, stats.memory.usagePercent, stats.disk.usagePercent).toFixed(0)}% peak</p>
            </div>
          </div>
        </div>
      </section>

      <RiskOverview />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Local Server Health</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Live resource graphics</h2>
            </div>
            <span className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">SSE live</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-gray-700 bg-gray-900/70 p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-400"><Cpu className="h-4 w-4" /> CPU</h3>
              <div className="flex justify-center"><CpuGauge percentage={stats.cpu.usagePercent} /></div>
              <p className="mt-3 truncate text-center text-xs text-gray-500" title={stats.cpu.model}>{stats.cpu.cores} cores · {stats.cpu.model}</p>
            </div>

            <div className="rounded-2xl border border-gray-700 bg-gray-900/70 p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-400"><MemoryStick className="h-4 w-4" /> Memory</h3>
              <MemoryBar total={stats.memory.total} used={stats.memory.used} available={stats.memory.available} />
            </div>

            <div className="rounded-2xl border border-gray-700 bg-gray-900/70 p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-400"><HardDrive className="h-4 w-4" /> Disk</h3>
              <DiskUsage total={stats.disk.total} used={stats.disk.used} available={stats.disk.available} />
            </div>
          </div>
        </div>

        <QuickOverview />
      </section>

      <SafeRepairCenter />
      <OnboardingWizard />
    </div>
  );
}
