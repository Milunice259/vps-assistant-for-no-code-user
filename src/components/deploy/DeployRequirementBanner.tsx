"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type DeployMode = "git" | "image" | "compose";
type Requirement = { name: string; ok: boolean; detail: string };
type CheckState = { loading: boolean; error: string | null; requirements: Requirement[] };

export function DeployRequirementBanner({ mode, serverId }: { mode: DeployMode; serverId?: string }) {
  const [state, setState] = useState<CheckState>({ loading: true, error: null, requirements: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ loading: true, error: null, requirements: [] });
      try {
        const res = await fetch("/api/deploy/requirements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, serverId: serverId === "local" ? undefined : serverId || undefined }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Requirement check failed");
        if (!cancelled) setState({ loading: false, error: null, requirements: json.data?.requirements || [] });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err instanceof Error ? err.message : "Requirement check failed", requirements: [] });
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [mode, serverId]);

  const missing = state.requirements.filter((item) => !item.ok);

  return (
    <div className={`rounded-xl border p-4 ${missing.length || state.error ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/5"}`}>
      <div className="flex items-start gap-3">
        {state.loading ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-gray-400" /> : missing.length || state.error ? <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Server requirements</p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {state.loading ? "Checking required packages..." : state.error ? state.error : missing.length ? "Fix these before filling the form." : "Required packages are ready for this deploy type."}
          </p>
          {!state.loading && !state.error && state.requirements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {state.requirements.map((item) => (
                <span key={item.name} title={item.detail} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${item.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
                  {item.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {item.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
