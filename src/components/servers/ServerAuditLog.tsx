"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Shield } from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  username: string;
  target: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  quick_action: "text-cyan-400 bg-cyan-500/10",
  service_start: "text-emerald-400 bg-emerald-500/10",
  service_stop: "text-yellow-400 bg-yellow-500/10",
  service_restart: "text-orange-400 bg-orange-500/10",
  service_enable: "text-emerald-400 bg-emerald-500/10",
  service_disable: "text-red-400 bg-red-500/10",
  container_start: "text-emerald-400 bg-emerald-500/10",
  container_stop: "text-yellow-400 bg-yellow-500/10",
  container_restart: "text-orange-400 bg-orange-500/10",
  deploy_git: "text-violet-400 bg-violet-500/10",
  deploy_docker: "text-blue-400 bg-blue-500/10",
  deploy_compose: "text-blue-400 bg-blue-500/10",
  package_install: "text-amber-400 bg-amber-500/10",
  package_upgrade: "text-amber-400 bg-amber-500/10",
};

export function ServerAuditLog({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const perPage = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(perPage), target: serverId });
      const res = await fetch(`/api/audit?${params}`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data ?? []);
        setTotal(json.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, serverId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / perPage) || 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Shield className="h-5 w-5 text-brand-400" />
              <h2 className="text-base font-semibold text-white">Server Activity Log</h2>
            </div>
            <p className="text-sm text-gray-400">
              Theo dõi mọi thao tác đã chạy trên server này: service, quick action, deploy, terminal và package.
            </p>
          </div>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto touch-pan-x overscroll-x-contain">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="w-6 px-4 py-2 text-left"></th>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Target</th>
                <th className="px-4 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-500">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-500">No activity recorded for this server yet.</td></tr>
              ) : entries.map((entry) => (
                <>
                  <tr
                    key={entry.id}
                    className="cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <td className="px-4 py-2">
                      <ChevronDown className={`h-3.5 w-3.5 text-gray-600 transition-transform ${expandedId === entry.id ? "rotate-180" : ""}`} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 font-mono text-xs ${ACTION_COLORS[entry.action] || "bg-gray-500/10 text-gray-400"}`}>{entry.action}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-300">{entry.username}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 font-mono text-xs text-gray-400">{entry.target || "-"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{entry.ip || "-"}</td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr key={`${entry.id}-details`} className="border-b border-gray-800/50 bg-gray-800/20">
                      <td colSpan={6} className="px-8 py-3 text-xs text-gray-300">
                        <div className="space-y-1.5">
                          <div><span className="text-gray-500">Details:</span> {entry.details || "No extra details"}</div>
                          <div><span className="text-gray-500">Target:</span> <span className="font-mono">{entry.target || "-"}</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total} entries</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded p-1 hover:bg-gray-800 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-gray-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded p-1 hover:bg-gray-800 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
