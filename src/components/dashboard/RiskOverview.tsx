"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, HardDrive, HelpCircle, MemoryStick, RefreshCw, ServerCrash, Sparkles } from "lucide-react";
import type { ApiResponse } from "@/types";

interface RiskAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  nextStep: string;
  serverId?: string;
  serverName?: string;
}

interface ServerRisk {
  serverId: string;
  serverName: string;
  host: string;
  status: "online" | "offline" | "unknown";
  score: number;
  label: "Healthy" | "Needs Attention" | "Critical";
  alerts: RiskAlert[];
  stats?: {
    cpu: number;
    memory: number;
    disk: number;
    uptime: number | string;
  };
}

interface RiskSummary {
  score: number;
  label: "Healthy" | "Needs Attention" | "Critical";
  servers: ServerRisk[];
  alerts: RiskAlert[];
}

const severityClass = {
  critical: "border-red-500/30 bg-red-500/10 text-red-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

const severityDot = {
  critical: "bg-red-400",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

function scoreColor(score: number) {
  if (score >= 85) return "text-emerald-300";
  if (score >= 65) return "text-amber-300";
  return "text-red-300";
}

function scoreBarColor(score: number) {
  if (score >= 85) return "bg-emerald-400";
  if (score >= 65) return "bg-amber-400";
  return "bg-red-400";
}

function severityIcon(alert: RiskAlert) {
  if (alert.id.includes("disk")) return <HardDrive className="h-4 w-4" />;
  if (alert.id.includes("memory")) return <MemoryStick className="h-4 w-4" />;
  if (alert.id.includes("unreachable")) return <ServerCrash className="h-4 w-4" />;
  if (alert.severity === "critical") return <AlertCircle className="h-4 w-4" />;
  return <Sparkles className="h-4 w-4" />;
}

function alertTooltip(alert: RiskAlert) {
  return `${alert.title}\n${alert.detail}\nSafe next step: ${alert.nextStep}`;
}

export function RiskOverview() {
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchRisk() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/risk", { cache: "no-store" });
      const json: ApiResponse<RiskSummary> = await res.json();
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Failed to load risk summary");
      setRisk(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load risk summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRisk();
    const timer = setInterval(fetchRisk, 30_000);
    return () => clearInterval(timer);
  }, []);

  const serverGroups = useMemo(() => {
    if (!risk) return [];
    return [...risk.servers].sort((a, b) => {
      if (b.alerts.length !== a.alerts.length) return b.alerts.length - a.alerts.length;
      return a.score - b.score;
    });
  }, [risk]);

  if (loading && !risk) {
    return (
      <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5 text-sm text-gray-400">
        <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Checking all servers...
      </section>
    );
  }

  if (error && !risk) {
    return (
      <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
        {error}
      </section>
    );
  }

  if (!risk) return null;

  const healthy = risk.alerts.length === 0;
  const color = scoreColor(risk.score);
  const criticalCount = risk.alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = risk.alerts.filter((alert) => alert.severity === "warning").length;
  const offlineCount = risk.servers.filter((server) => server.status !== "online").length;
  const averageScore = Math.round(risk.servers.reduce((sum, server) => sum + server.score, 0) / Math.max(risk.servers.length, 1));

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Fleet Risk Score</p>
            <h2 className={`mt-2 text-4xl font-bold ${color}`}>{risk.score}</h2>
            <p className="mt-1 text-sm font-medium text-white">{risk.label}</p>
          </div>
          <button onClick={fetchRisk} className="rounded-xl border border-gray-700 bg-gray-900 p-3 text-gray-400 hover:text-white" title="Refresh risk score">
            {healthy ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <AlertTriangle className={`h-6 w-6 ${color}`} />}
          </button>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-gray-900">
          <div className={`h-full rounded-full ${scoreBarColor(risk.score)}`} style={{ width: `${Math.max(4, risk.score)}%` }} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
            <p className="text-gray-500">Servers</p>
            <p className="mt-1 text-lg font-semibold text-white">{risk.servers.length}</p>
          </div>
          <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
            <p className="text-gray-500">Offline</p>
            <p className="mt-1 text-lg font-semibold text-red-300">{offlineCount}</p>
          </div>
          <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
            <p className="text-gray-500">Critical</p>
            <p className="mt-1 text-lg font-semibold text-red-300">{criticalCount}</p>
          </div>
          <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
            <p className="text-gray-500">Avg score</p>
            <p className={`mt-1 text-lg font-semibold ${scoreColor(averageScore)}`}>{averageScore}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-400">
          Compact fleet summary. Detailed alerts stay grouped by server so this card does not grow forever.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Alert Center</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Server alerts</h3>
            </div>
            <span title="Alerts are grouped by server. Hover an icon to see the issue and the safest next step.">
              <HelpCircle className="h-4 w-4 text-gray-500" />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-300">{criticalCount} critical</span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-300">{warningCount} warning</span>
            <span className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-gray-400">{risk.alerts.length} total</span>
          </div>
        </div>

        {healthy ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            No urgent issue detected across connected servers. Keep backups enabled and review public ports after each deployment.
          </div>
        ) : (
          <div className="max-h-[430px] overflow-y-auto pr-1">
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {serverGroups.map((server) => {
                const serverHealthy = server.alerts.length === 0;
                return (
                  <div key={server.serverId} className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${server.status === "online" ? "bg-emerald-400" : "bg-red-400"}`} />
                          <p className="truncate text-sm font-semibold text-white">{server.serverName}</p>
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500">{server.host}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${scoreColor(server.score)}`}>{server.score}</p>
                        <p className="text-[10px] uppercase text-gray-500">{server.status}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex min-h-8 flex-wrap gap-2">
                      {serverHealthy ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300" title="No current alert for this server">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Healthy
                        </span>
                      ) : (
                        server.alerts.map((alert, index) => (
                          <span
                            key={`${alert.id}-${index}`}
                            title={alertTooltip(alert)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${severityClass[alert.severity]}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${severityDot[alert.severity]}`} />
                            {severityIcon(alert)}
                            <span className="max-w-28 truncate">{alert.title}</span>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="mt-3 border-t border-gray-700/70 pt-3 text-xs text-gray-500">
                      {server.stats ? (
                        <span>CPU {server.stats.cpu.toFixed(0)}% · RAM {server.stats.memory.toFixed(0)}% · Disk {server.stats.disk.toFixed(0)}%</span>
                      ) : (
                        <span>Stats unavailable</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
