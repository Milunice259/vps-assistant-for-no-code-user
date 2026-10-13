"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";

interface SchedulerStatus {
  enabled: boolean;
  intervalSeconds?: number;
  workerOnline?: boolean;
  running?: boolean;
  lastStartedAt?: number | null;
  lastCompletedAt?: number | null;
  lastStarted?: string | null;
  lastCompleted?: string | null;
  nextRun?: string | null;
  state?: string;
  outcome?: string | null;
}

export function MonitoringStatus() {
  const { formatDate } = useTranslation();
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    let timeout: ReturnType<typeof setTimeout>;
    const load = async () => {
      controller?.abort();
      clearTimeout(timeout);
      controller = new AbortController();
      const current = controller;
      setStatus(null);
      setError(null);
      setLoading(true);
      const deadline = setTimeout(() => {
        current.abort();
        if (active && controller === current) { setError("Monitoring status timed out. Try again."); setLoading(false); }
      }, 15_000);
      timeout = deadline;
      try {
        const response = await fetch("/api/monitoring/status", { cache: "no-store", signal: current.signal });
        if (!active || current.signal.aborted) return;
        if (!response.ok) {
          setError(response.status === 401 || response.status === 403 ? "Access denied. Previous status is hidden." : "Monitoring status unavailable.");
          return;
        }
        const json = await response.json();
        if (!active || current.signal.aborted) return;
        if (!json.success || typeof json.data?.enabled !== "boolean") throw new Error("Invalid status");
        setStatus(json.data);
      } catch {
        if (active && !current.signal.aborted) setError("Offline or monitoring status unavailable.");
      } finally {
        clearTimeout(deadline);
        if (active && !current.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { active = false; controller?.abort(); clearTimeout(timeout); clearInterval(timer); };
  }, [refresh]);
  const date = (value: string | number | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? formatDate(new Date(value).toISOString(), { dateStyle: "short", timeStyle: "medium" }) : "Not available";
  const state = !status ? "" : !status.enabled ? "Disabled" : status.workerOnline === false ? "Worker offline" : status.running || status.state === "running" ? "Running" : status.outcome === "failed" || status.state === "error" ? "Last cycle failed" : status.outcome === "timeout" ? "Last cycle timed out" : status.workerOnline === true ? "Waiting for next cycle" : "Not verified";
  return <section aria-label="Monitoring scheduler" aria-busy={loading} className="space-y-3 min-w-0 rounded-lg border border-gray-800 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-white">Monitoring scheduler</h3>
      <button type="button" disabled={loading} onClick={() => setRefresh(v => v + 1)} className="min-h-11 px-3 text-sm text-gray-300 disabled:opacity-50">Refresh status</button>
    </div>
    <p role="status" aria-live="polite" className="text-sm text-gray-300 break-words">{loading ? "Loading monitoring status…" : error || state}</p>
    {status && !loading && !error && <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-400">
      <div><dt>Last started</dt><dd className="text-gray-300 break-words">{date(status.lastStarted ?? status.lastStartedAt)}</dd></div>
      <div><dt>Last completed</dt><dd className="text-gray-300 break-words">{date(status.lastCompleted ?? status.lastCompletedAt)}</dd></div>
      <div><dt>Next run</dt><dd className="text-gray-300 break-words">{status.enabled ? date(status.nextRun) : "Disabled"}</dd></div>
    </dl>}
    <p className="text-xs text-gray-400">Background collection runs without this page open. Scheduler status does not verify application readiness.</p>
  </section>;
}
