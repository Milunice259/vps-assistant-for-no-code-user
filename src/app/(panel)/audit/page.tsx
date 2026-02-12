"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Filter, ChevronLeft, ChevronRight } from "lucide-react";

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
  login: "text-emerald-400 bg-emerald-500/10",
  login_failed: "text-red-400 bg-red-500/10",
  logout: "text-gray-400 bg-gray-500/10",
  server_create: "text-blue-400 bg-blue-500/10",
  server_delete: "text-red-400 bg-red-500/10",
  container_start: "text-emerald-400 bg-emerald-500/10",
  container_stop: "text-yellow-400 bg-yellow-500/10",
  container_restart: "text-orange-400 bg-orange-500/10",
  deploy_git: "text-violet-400 bg-violet-500/10",
  deploy_docker: "text-blue-400 bg-blue-500/10",
  system_update: "text-amber-400 bg-amber-500/10",
  system_reboot: "text-red-400 bg-red-500/10",
  docker_prune: "text-orange-400 bg-orange-500/10",
  service_start: "text-emerald-400 bg-emerald-500/10",
  service_stop: "text-yellow-400 bg-yellow-500/10",
  service_restart: "text-orange-400 bg-orange-500/10",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const perPage = 25;

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(perPage),
        ...(filter ? { action: filter } : {}),
      });
      const res = await fetch(`/api/audit?${params}`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data);
        setTotal(json.total ?? 0);
      }
    } catch { /* ok */ }
    finally { setLoading(false); }
  }, [page, filter]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const totalPages = Math.ceil(total / perPage) || 1;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-400" />
          <p className="text-sm text-gray-400">
            Security audit trail — all sensitive actions are logged here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white"
          >
            <option value="">All actions</option>
            <option value="login">Login</option>
            <option value="login_failed">Login Failed</option>
            <option value="deploy_git">Deploy (Git)</option>
            <option value="deploy_docker">Deploy (Docker)</option>
            <option value="container_stop">Container Stop</option>
            <option value="container_restart">Container Restart</option>
            <option value="system_reboot">System Reboot</option>
            <option value="service_stop">Service Stop</option>
          </select>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">User</th>
              <th className="text-left px-4 py-2">Target</th>
              <th className="text-left px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">No audit entries yet</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-mono px-2 py-0.5 rounded ${ACTION_COLORS[e.action] || "text-gray-400 bg-gray-500/10"}`}>
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-300">{e.username}</td>
                <td className="px-4 py-2 text-xs text-gray-400 max-w-[200px] truncate">{e.target || "—"}</td>
                <td className="px-4 py-2 text-xs text-gray-500 font-mono">{e.ip || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total} total entries</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-gray-400">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
