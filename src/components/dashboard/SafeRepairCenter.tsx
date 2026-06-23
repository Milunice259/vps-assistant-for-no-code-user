"use client";

import { useState, type ReactNode } from "react";
import { ClipboardList, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

type RepairAction = {
  id: "system-health-check" | "clear-apt-cache" | "clear-logs";
  title: string;
  detail: string;
  icon: ReactNode;
  confirm?: string;
};

const actions: RepairAction[] = [
  {
    id: "system-health-check",
    title: "Explain current health",
    detail: "Runs a read-only check for disk, memory, CPU load, failed services, and pending updates.",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    id: "clear-apt-cache",
    title: "Clear package cache",
    detail: "Safely removes downloaded package cache. It does not delete apps, databases, or Docker volumes.",
    icon: <Trash2 className="h-4 w-4" />,
    confirm: "Clear package cache on the local server? This is safe and does not remove apps or databases.",
  },
  {
    id: "clear-logs",
    title: "Trim old system logs",
    detail: "Keeps recent logs and vacuums old journal entries to recover disk space safely.",
    icon: <Trash2 className="h-4 w-4" />,
    confirm: "Trim old system logs on the local server? Recent logs will be kept.",
  },
];

export function SafeRepairCenter() {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; output: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: RepairAction) {
    if (action.confirm && !window.confirm(action.confirm)) return;

    setRunning(action.id);
    setError(null);
    try {
      const res = await fetch("/api/servers/local/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.id }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Action failed");
      setResult({ title: action.title, output: json.data?.output || "Done" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500">Safe Repair</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" /> Guided maintenance for beginners
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            Low-risk checks and cleanup actions. Read the <a href="/docs#safe-repair" className="text-brand-400 hover:text-brand-300">safe repair docs</a> first if unsure.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {actions.map((action) => (
          <div key={action.id} className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-gray-700 bg-gray-950 p-2 text-gray-300">{action.icon}</div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">{action.title}</h3>
                <p className="mt-1 text-xs leading-5 text-gray-400">{action.detail}</p>
              </div>
            </div>
            <Button className="mt-4 w-full" variant="secondary" size="sm" onClick={() => runAction(action)} disabled={running !== null}>
              {running === action.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {action.id === "system-health-check" ? "Run check" : "Run safely"}
            </Button>
          </div>
        ))}
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {result && (
        <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">{result.title} result</p>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>Close</Button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-gray-300">{result.output}</pre>
        </div>
      )}
    </section>
  );
}
