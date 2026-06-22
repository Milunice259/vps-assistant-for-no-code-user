"use client";

import { AlertTriangle, CheckCircle2, HardDrive, Info, MemoryStick, ServerCrash, ShieldAlert, Sparkles } from "lucide-react";
import type { DashboardSummary, SystemStats } from "@/types";

interface RiskItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  nextStep: string;
  icon: React.ReactNode;
}

function addUsageRisk(items: RiskItem[], id: string, label: string, value: number, icon: React.ReactNode, warning: number, critical: number) {
  if (value >= critical) {
    items.push({
      id,
      severity: "critical",
      title: `${label} is critically high`,
      detail: `${label} is using ${value.toFixed(0)}%. Apps may slow down or fail if this continues.`,
      nextStep: label === "Disk" ? "Create a backup, then clean Docker cache/logs from Quick Actions." : "Check which app is using resources before restarting anything.",
      icon,
    });
  } else if (value >= warning) {
    items.push({
      id,
      severity: "warning",
      title: `${label} needs attention`,
      detail: `${label} is using ${value.toFixed(0)}%. This is still manageable, but should be watched.`,
      nextStep: label === "Disk" ? "Plan a cleanup before it reaches 90%." : "Watch the trend and check app resource usage if it keeps rising.",
      icon,
    });
  }
}

function buildRisks(stats: SystemStats, summary?: DashboardSummary | null): RiskItem[] {
  const items: RiskItem[] = [];

  addUsageRisk(items, "cpu", "CPU", stats.cpu.usagePercent, <Sparkles className="h-4 w-4" />, 75, 90);
  addUsageRisk(items, "memory", "Memory", stats.memory.usagePercent, <MemoryStick className="h-4 w-4" />, 80, 92);
  addUsageRisk(items, "disk", "Disk", stats.disk.usagePercent, <HardDrive className="h-4 w-4" />, 75, 88);

  if (summary?.containers.stopped && summary.containers.stopped > 0) {
    items.push({
      id: "stopped-containers",
      severity: "warning",
      title: `${summary.containers.stopped} app container${summary.containers.stopped > 1 ? "s" : ""} stopped`,
      detail: "A stopped container may mean an app is offline or intentionally paused.",
      nextStep: "Open Apps, inspect the stopped item, then start it only if you recognize it.",
      icon: <ServerCrash className="h-4 w-4" />,
    });
  }

  if (summary?.deployments.failed && summary.deployments.failed > 0) {
    items.push({
      id: "failed-deployments",
      severity: "critical",
      title: `${summary.deployments.failed} deployment${summary.deployments.failed > 1 ? "s" : ""} failed`,
      detail: "A failed deployment can leave an app on an older version or partially updated.",
      nextStep: "Open Deploy, read the failed log, then rollback or redeploy after backup.",
      icon: <ShieldAlert className="h-4 w-4" />,
    });
  }

  if (summary?.network.listeningPorts && summary.network.listeningPorts >= 12) {
    items.push({
      id: "many-open-ports",
      severity: "info",
      title: "Many ports are listening",
      detail: `${summary.network.listeningPorts} ports are accepting connections. This is not always bad, but beginners should know why each public port exists.`,
      nextStep: "Open Network Map and confirm that public ports belong to known apps.",
      icon: <Info className="h-4 w-4" />,
    });
  }

  return items;
}

function scoreFromRisks(items: RiskItem[]) {
  const penalty = items.reduce((sum, item) => sum + (item.severity === "critical" ? 28 : item.severity === "warning" ? 14 : 6), 0);
  const score = Math.max(0, 100 - penalty);
  const status = score >= 85 ? "Healthy" : score >= 65 ? "Needs Attention" : "Critical";
  return { score, status };
}

const severityClass = {
  critical: "border-red-500/30 bg-red-500/10 text-red-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

export function RiskOverview({ stats, summary }: { stats: SystemStats; summary?: DashboardSummary | null }) {
  const risks = buildRisks(stats, summary);
  const { score, status } = scoreFromRisks(risks);
  const healthy = risks.length === 0;
  const scoreColor = score >= 85 ? "text-emerald-300" : score >= 65 ? "text-amber-300" : "text-red-300";

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Server Risk Score</p>
            <h2 className={`mt-2 text-4xl font-bold ${scoreColor}`}>{score}</h2>
            <p className="mt-1 text-sm font-medium text-white">{status}</p>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-900 p-3">
            {healthy ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <AlertTriangle className={`h-6 w-6 ${scoreColor}`} />}
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-400">
          Beginner-friendly score based on CPU, memory, disk, stopped containers, failed deploys, and exposed ports.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Alert Center</p>
            <h3 className="mt-1 text-lg font-semibold text-white">What needs attention</h3>
          </div>
          <span className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">{risks.length} alert{risks.length !== 1 ? "s" : ""}</span>
        </div>

        {healthy ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            No urgent issue detected. Keep backups enabled and review open ports after every new app deployment.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {risks.map((item) => (
              <div key={item.id} className={`rounded-xl border p-4 ${severityClass[item.severity]}`}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-300">{item.detail}</p>
                    <p className="mt-2 text-xs text-gray-400"><span className="text-gray-300">Safe next step:</span> {item.nextStep}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
