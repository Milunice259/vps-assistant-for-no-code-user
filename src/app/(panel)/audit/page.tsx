"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Filter, ChevronLeft, ChevronRight, Search, Download, ChevronDown } from "lucide-react";

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

/** Human-friendly action descriptions */
const ACTION_LABELS: Record<string, string> = {
  login: "Successful login",
  login_failed: "Failed login attempt",
  logout: "User logged out",
  server_create: "Server added",
  server_delete: "Server removed",
  container_start: "Container started",
  container_stop: "Container stopped",
  container_restart: "Container restarted",
  deploy_git: "Deployed from Git",
  deploy_docker: "Deployed from Docker",
  system_update: "System update ran",
  system_reboot: "System rebooted",
  docker_prune: "Docker cleanup ran",
  service_start: "Service started",
  service_stop: "Service stopped",
  service_restart: "Service restarted",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const perPage = 25;

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(perPage),
        ...(actionFilter ? { action: actionFilter } : {}),
      });
      const res = await fetch(`/api/audit?${params}`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data);
        setTotal(json.total ?? 0);
      }
    } catch { /* ok */ }
    finally { setLoading(false); }
  }, [page, actionFilter]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const totalPages = Math.ceil(total / perPage) || 1;

  const filtered = entries.filter((e) => {
    // Date range filter
    if (dateFrom) {
      const entryDate = new Date(e.createdAt);
      const fromDate = new Date(dateFrom);
      if (entryDate < fromDate) return false;
    }
    if (dateTo) {
      const entryDate = new Date(e.createdAt);
      const toDate = new Date(dateTo + "T23:59:59");
      if (entryDate > toDate) return false;
    }
    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        e.action.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.target?.toLowerCase().includes(q)) ||
        (e.details?.toLowerCase().includes(q)) ||
        (e.ip?.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Export visible entries as CSV
  function exportCSV() {
    const headers = ["Time", "Action", "User", "Target", "IP", "Details"];
    const rows = filtered.map((e) => [
      new Date(e.createdAt).toISOString(),
      e.action,
      e.username,
      e.target || "",
      e.ip || "",
      (e.details || "").replace(/"/g, '""'),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header and description */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-5 w-5 text-brand-400" />
          <h1 className="text-lg font-semibold text-white">Audit Log</h1>
        </div>
        <p className="text-sm text-gray-400">
          Every security-sensitive action is recorded here — logins, deployments, server changes, and container operations. Use this to track who did what and when.
        </p>
      </div>

      {/* Toolbar: search + filter + export */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Text search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user, target, IP..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Action filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white"
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

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white [color-scheme:dark]"
          />
          <span className="text-xs text-gray-500">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white [color-scheme:dark]"
          />
        </div>

        {/* Export */}
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              <th className="text-left px-4 py-2 w-6"></th>
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">User</th>
              <th className="text-left px-4 py-2">Target</th>
              <th className="text-left px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">
                {searchQuery ? "No entries match your search." : "No audit entries yet."}
              </td></tr>
            ) : filtered.map((e) => (
              <>
                <tr
                  key={e.id}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer ${expandedId === e.id ? "bg-gray-800/40" : ""}`}
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                >
                  <td className="px-4 py-2">
                    <ChevronDown className={`h-3.5 w-3.5 text-gray-600 transition-transform ${expandedId === e.id ? "rotate-180" : ""}`} />
                  </td>
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
                {expandedId === e.id && (
                  <tr key={`${e.id}-details`} className="border-b border-gray-800/50">
                    <td colSpan={6} className="px-8 py-3 bg-gray-800/20">
                      <div className="space-y-1.5">
                        <div className="flex gap-6 text-xs">
                          <span className="text-gray-500">Action:</span>
                          <span className="text-gray-300">{ACTION_LABELS[e.action] || e.action}</span>
                        </div>
                        {e.target && (
                          <div className="flex gap-6 text-xs">
                            <span className="text-gray-500">Target:</span>
                            <span className="text-gray-300 font-mono">{e.target}</span>
                          </div>
                        )}
                        {e.details && (
                          <div className="flex gap-6 text-xs">
                            <span className="text-gray-500">Details:</span>
                            <span className="text-gray-300">{e.details}</span>
                          </div>
                        )}
                        {e.ip && (
                          <div className="flex gap-6 text-xs">
                            <span className="text-gray-500">IP Address:</span>
                            <span className="text-gray-300 font-mono">{e.ip}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total} total entries{searchQuery ? ` · ${filtered.length} matching` : ""}</span>
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
