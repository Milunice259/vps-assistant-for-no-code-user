"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HardDrive, MemoryStick, RefreshCw, Server, ServerCrash, Sparkles } from "lucide-react";
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

function scoreColor(score: number) {
  if (score >= 85) return "text-emerald-300";
  if (score >= 65) return "text-amber-300";
  return "text-red-300";
}

function severityIcon(alert: RiskAlert) {
  if (alert.id.includes("disk")) return <HardDrive className="h-4 w-4" />;
  if (alert.id.includes("memory")) return <MemoryStick className="h-4 w-4" />;
  if (alert.id.includes("unreachable")) return <ServerCrash className="h-4 w-4" />;
  return <Sparkles className="h-4 w-4" />;
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

  return (
    <section className="grid gap-4 xl:grid-cols-[340px_1fr]">
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
        <p className="mt-4 text-sm text-gray-400">
          Multi-server score covering local and remote VPS health. Offline remote servers are counted as critical.
        </p>
        <div className="mt-4 grid gap-2">
          {risk.servers.map((server) => (
            <div key={server.serverId} className="flex items-center justify-between rounded-xl border border-gray-700 bg-gray-900/60 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{server.serverName}</p>
                <p className="truncate text-xs text-gray-500">{server.host}</p>
              </div>
              <div className="ml-3 text-right">
                <p className={`text-sm font-semibold ${scoreColor(server.score)}`}>{server.score}</p>
                <p className="text-[10px] uppercase text-gray-500">{server.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Alert Center</p>
            <h3 className="mt-1 text-lg font-semibold text-white">What needs attention across servers</h3>
          </div>
          <span className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">{risk.alerts.length} alert{risk.alerts.length !== 1 ? "s" : ""}</span>
        </div>

        {healthy ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            No urgent issue detected across connected servers. Keep backups enabled and review public ports after each deployment.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {risk.alerts.map((item, index) => (
              <div key={`${item.serverId}-${item.id}-${index}`} className={`rounded-xl border p-4 ${severityClass[item.severity]}`}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{severityIcon(item)}</div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{item.serverName}</p>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-300">{item.detail}</p>
                    <p className="mt-2 text-xs text-gray-400"><span className="text-gray-300">Safe next step:</span> {item.nextStep}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-2 text-xs text-gray-500 sm:grid-cols-3">
          {risk.servers.map((server) => (
            <div key={`${server.serverId}-stats`} className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-gray-300"><Server className="h-3.5 w-3.5" /> {server.serverName}</div>
              {server.stats ? (
                <p>CPU {server.stats.cpu.toFixed(0)}% · RAM {server.stats.memory.toFixed(0)}% · Disk {server.stats.disk.toFixed(0)}%</p>
              ) : (
                <p>Stats unavailable</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
