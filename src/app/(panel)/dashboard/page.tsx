"use client";

import { useSSE } from "@/hooks/useSSE";
import type { DashboardSummary } from "@/types";
import { QuickOverview } from "@/components/dashboard/QuickOverview";
import { OnboardingWizard } from "@/components/dashboard/OnboardingWizard";
import { RiskOverview } from "@/components/dashboard/RiskOverview";
import { Activity, AlertTriangle, CheckCircle2, GitBranch, Server, Wifi } from "lucide-react";

function riskTone(failedDeploys: number, inactiveServers: number) {
  if (failedDeploys > 0 || inactiveServers > 0) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

export default function DashboardPage() {
  const { data: summary, connected, error } = useSSE<DashboardSummary>("/api/dashboard/stream", {
    fallbackPollMs: 30_000,
  });

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 p-6 text-red-400">
        <p className="font-medium">Connection Error</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-gray-400">Loading fleet overview...</p>
        </div>
      </div>
    );
  }

  const healthy = summary.servers.inactive === 0 && summary.deployments.failed === 0;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-brand-500/20 bg-gradient-to-br from-gray-900 via-gray-800 to-slate-950 p-5 shadow-2xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${connected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-gray-700 bg-gray-900 text-gray-500"}`}>
                <Wifi className="h-3.5 w-3.5" /> {connected ? "Live fleet data" : "Disconnected"}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${riskTone(summary.deployments.failed, summary.servers.inactive)}`}>
                {healthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {healthy ? "Fleet healthy" : "Needs review"}
              </span>
            </div>
            <h1 className="mt-4 text-2xl font-bold text-white md:text-3xl">Fleet Management Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Multi-server overview for servers, applications, alerts, deployments, and safe operations. Open a server page for local or remote machine details.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[620px] xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-700 bg-gray-950/60 p-4">
              <p className="flex items-center gap-2 text-xs text-gray-500"><Server className="h-4 w-4" /> Servers</p>
              <p className="mt-2 text-2xl font-semibold text-white">{summary.servers.total}</p>
              <p className="mt-1 text-xs text-gray-500">{summary.servers.remote} remote · 1 local</p>
            </div>
            <div className="rounded-2xl border border-gray-700 bg-gray-950/60 p-4">
              <p className="flex items-center gap-2 text-xs text-gray-500"><Activity className="h-4 w-4" /> Apps</p>
              <p className="mt-2 text-2xl font-semibold text-white">{summary.apps.running}</p>
              <p className="mt-1 text-xs text-gray-500">{summary.apps.stopped} stopped · {summary.apps.total} total</p>
            </div>
            <div className="rounded-2xl border border-gray-700 bg-gray-950/60 p-4">
              <p className="flex items-center gap-2 text-xs text-gray-500"><GitBranch className="h-4 w-4" /> Deploys</p>
              <p className="mt-2 text-2xl font-semibold text-white">{summary.deployments.recent}</p>
              <p className="mt-1 text-xs text-gray-500">last 24h · {summary.deployments.failed} failed</p>
            </div>
            <div className={`rounded-2xl border p-4 ${riskTone(summary.deployments.failed, summary.servers.inactive)}`}>
              <p className="flex items-center gap-2 text-xs opacity-80"><AlertTriangle className="h-4 w-4" /> Review</p>
              <p className="mt-2 text-2xl font-semibold">{summary.servers.inactive + summary.deployments.failed}</p>
              <p className="mt-1 text-xs opacity-75">inactive servers + failed deploys</p>
            </div>
          </div>
        </div>
      </section>

      <OnboardingWizard />
      <RiskOverview />
      <QuickOverview />
    </div>
  );
}
