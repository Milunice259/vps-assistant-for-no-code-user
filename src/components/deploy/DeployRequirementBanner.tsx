"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clipboard, Loader2, Terminal, Wrench } from "lucide-react";
import { useSafeMode } from "@/contexts/SafeModeContext";

type DeployMode = "git" | "image" | "compose";
type Requirement = { name: string; ok: boolean; detail: string; installCommand?: string; packageId?: "git" | "docker-compose-plugin" };
type CheckState = { loading: boolean; error: string | null; requirements: Requirement[]; installOutput: string | null };

const actionClass = "inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export function DeployRequirementBanner({ mode, serverId }: { mode: DeployMode; serverId?: string }) {
  const { safeMode } = useSafeMode();
  const [state, setState] = useState<CheckState>({ loading: true, error: null, requirements: [], installOutput: null });
  const [installing, setInstalling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const res = await fetch("/api/deploy/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, serverId: serverId === "local" ? undefined : serverId || undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Requirement check failed");
      setState({ loading: false, error: null, requirements: json.data?.requirements || [], installOutput: null });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : "Requirement check failed", requirements: [], installOutput: null });
    }
  }, [mode, serverId]);

  useEffect(() => { void load(); }, [load]);

  async function installPackage(item: Requirement) {
    if (!item.packageId) return;
    if (!window.confirm(`Install ${item.name} on ${serverId ? "the selected remote server" : "the local server"}?`)) return;
    setInstalling(item.packageId);
    try {
      const res = await fetch("/api/deploy/requirements/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: item.packageId, serverId: serverId === "local" ? undefined : serverId || undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Install failed");
      setState((current) => ({ ...current, installOutput: json.data?.output || `${item.name} installed.` }));
      await load();
    } catch (err) {
      setState((current) => ({ ...current, installOutput: err instanceof Error ? err.message : "Install failed" }));
    } finally {
      setInstalling(null);
    }
  }

  async function copyCommand(command: string) {
    await navigator.clipboard.writeText(command);
    setState((current) => ({ ...current, installOutput: "Command copied." }));
  }

  const missing = state.requirements.filter((item) => !item.ok);

  return (
    <div className={`rounded-xl border p-4 ${missing.length || state.error ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/5"}`}>
      <div className="flex items-start gap-3">
        {state.loading ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-gray-400" /> : missing.length || state.error ? <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-white">Server requirements</p>
            <a href="/docs#deploy-requirements" className="text-xs text-brand-400 hover:text-brand-300">Docs</a>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {state.loading ? "Checking required packages..." : state.error ? state.error : missing.length ? "Fix missing requirements before filling the form." : "Required packages are ready for this deploy type."}
          </p>
          {!state.loading && !state.error && state.requirements.length > 0 && (
            <div className="mt-3 space-y-2">
              {state.requirements.map((item) => {
                const isOpen = expanded === item.name;
                return (
                  <div key={item.name} className="rounded-lg border border-gray-700/70 bg-gray-950/50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span title={item.detail} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${item.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
                        {item.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        {item.name}
                      </span>
                      {!item.ok && (
                        <button type="button" onClick={() => setExpanded(isOpen ? null : item.name)} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-300 hover:text-amber-200" title={`Fix ${item.name}`}>
                          <Wrench className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {!item.ok && isOpen && (
                      <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-700/70 pt-2">
                        {item.packageId && (
                          <button type="button" className={actionClass} disabled={installing === item.packageId} onClick={() => installPackage(item)}>
                            {installing === item.packageId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                            Install
                          </button>
                        )}
                        {item.installCommand && (
                          <button type="button" onClick={() => copyCommand(item.installCommand || "")} className={actionClass}>
                            <Clipboard className="h-3.5 w-3.5" /> Copy command
                          </button>
                        )}
                        {safeMode ? (
                          <button type="button" disabled className={actionClass} title="Turn Safe Mode off to use terminal.">
                            <Terminal className="h-3.5 w-3.5" /> Terminal locked
                          </button>
                        ) : (
                          <a href={serverId ? `/servers/${encodeURIComponent(serverId)}` : "/terminal"} className={actionClass}>
                            <Terminal className="h-3.5 w-3.5" /> Open terminal
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {state.installOutput && <p className="mt-3 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-400">{state.installOutput}</p>}
        </div>
      </div>
    </div>
  );
}
