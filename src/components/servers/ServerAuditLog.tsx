"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, Shield } from "lucide-react";

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

const ACTION_GROUPS = ["all", "quick", "service", "container", "deploy", "package"] as const;

type ActionGroup = (typeof ACTION_GROUPS)[number];

function actionGroup(action: string): ActionGroup {
  if (action.startsWith("service_")) return "service";
  if (action.startsWith("container_")) return "container";
  if (action.startsWith("deploy_")) return "deploy";
  if (action.startsWith("package_")) return "package";
  if (action === "quick_action") return "quick";
  return "all";
}

function severity(action: string): "info" | "warning" | "critical" {
  if (action.includes("disable") || action.includes("stop") || action.includes("prune") || action.includes("restart")) return "warning";
  if (action.includes("delete") || action.includes("rollback")) return "critical";
  return "info";
}

function matchesSearch(entry: AuditEntry, query: string) {
  const text = `${entry.action} ${entry.username} ${entry.target ?? ""} ${entry.details ?? ""} ${entry.ip ?? ""}`.toLowerCase();
  return text.includes(query.toLowerCase());
}

export function ServerAuditLog({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ActionGroup>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | "info" | "warning" | "critical">("all");
  const [logSource, setLogSource] = useState<"system" | "service" | "docker">("system");
  const [logName, setLogName] = useState("");
  const [logLines, setLogLines] = useState("100");
  const [logSince, setLogSince] = useState("1h");
  const [followLogs, setFollowLogs] = useState(false);
  const [logOutput, setLogOutput] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState("");
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

  const fetchServerLogs = useCallback(async () => {
    setLogLoading(true);
    setLogError("");
    try {
      const params = new URLSearchParams({ source: logSource, lines: logLines, since: logSince });
      if (logSource !== "system") params.set("name", logName.trim());
      const res = await fetch(`/api/servers/${serverId}/logs?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to read logs");
      setLogOutput(json.data?.output || "No logs found.");
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Failed to read logs");
    } finally {
      setLogLoading(false);
    }
  }, [logLines, logName, logSince, logSource, serverId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!followLogs) return;
    fetchServerLogs();
    const id = window.setInterval(fetchServerLogs, 5000);
    return () => window.clearInterval(id);
  }, [fetchServerLogs, followLogs]);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (query && !matchesSearch(entry, query)) return false;
    if (group !== "all" && actionGroup(entry.action) !== group) return false;
    if (severityFilter !== "all" && severity(entry.action) !== severityFilter) return false;
    return true;
  }), [entries, group, query, severityFilter]);

  const totalPages = Math.ceil(total / perPage) || 1;

  function copyLogs() {
    if (logOutput) void navigator.clipboard.writeText(logOutput);
  }

  function downloadLogs() {
    if (!logOutput) return;
    const blob = new Blob([logOutput], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${serverId}-${logSource}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
              Search and filter actions on this server: services, containers, deploys, packages, and quick actions.
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

      <div className="rounded-xl border border-gray-700/60 bg-gray-900/70 p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Real server logs</h3>
            <p className="text-xs text-gray-500">Read-only logs from the actual server. Sensitive-looking values are redacted.</p>
          </div>
          <button onClick={fetchServerLogs} disabled={logLoading || (logSource !== "system" && !logName.trim())} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${logLoading ? "animate-spin" : ""}`} /> Read logs
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto_auto]">
          <select value={logSource} onChange={(event) => setLogSource(event.target.value as typeof logSource)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none">
            <option value="system">System logs</option>
            <option value="service">Service logs</option>
            <option value="docker">Docker app logs</option>
          </select>
          <input value={logName} onChange={(event) => setLogName(event.target.value)} disabled={logSource === "system"} placeholder={logSource === "service" ? "service name, e.g. nginx.service" : logSource === "docker" ? "container name or id" : "No name needed for system logs"} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-brand-500 focus:outline-none disabled:opacity-40" />
          <select value={logSince} onChange={(event) => setLogSince(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none">
            <option value="15m">Last 15m</option>
            <option value="1h">Last 1h</option>
            <option value="6h">Last 6h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
          </select>
          <select value={logLines} onChange={(event) => setLogLines(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none">
            <option value="50">50 lines</option>
            <option value="100">100 lines</option>
            <option value="200">200 lines</option>
            <option value="500">500 lines</option>
            <option value="1000">1000 lines</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setFollowLogs((value) => !value)} className={followLogs ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200" : "rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300"}>{followLogs ? "Following every 5s" : "Follow logs"}</button>
          <button onClick={copyLogs} disabled={!logOutput} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40">Copy</button>
          <button onClick={downloadLogs} disabled={!logOutput} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40">Download .txt</button>
        </div>
        {logError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{logError}</div>}
        {logOutput && <pre className="mt-3 max-h-[520px] overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">{logOutput}</pre>}
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-700/60 bg-gray-900/70 p-3 lg:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search action, user, target, details..."
            className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </label>
        <select value={group} onChange={(event) => setGroup(event.target.value as ActionGroup)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none">
          {ACTION_GROUPS.map((item) => <option key={item} value={item}>{item === "all" ? "All actions" : item}</option>)}
        </select>
        <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none">
          <option value="all">All severity</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center text-gray-500">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center text-gray-500">No activity matches these filters.</div>
        ) : filteredEntries.map((entry) => (
          <button key={entry.id} onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)} className="w-full rounded-xl border border-gray-700 bg-gray-900/70 p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className={`rounded px-2 py-0.5 font-mono text-xs ${ACTION_COLORS[entry.action] || "bg-gray-500/10 text-gray-400"}`}>{entry.action}</span>
                <p className="mt-2 text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</p>
              </div>
              <span className="shrink-0 text-xs capitalize text-gray-300">{severity(entry.action)}</span>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-400">
              <p className="break-all">User: {entry.username}</p>
              <p className="break-all">Target: {entry.target || "-"}</p>
              {expandedId === entry.id && <p className="break-all text-gray-300">Details: {entry.details || "No extra details"}</p>}
            </div>
          </button>
        ))}
      </div>

      <div className="hidden rounded-lg border border-gray-700 bg-gray-900 overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="w-6 px-4 py-2 text-left"></th>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">Severity</th>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Target</th>
                <th className="px-4 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-500">Loading...</td></tr>
              ) : filteredEntries.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-500">No activity matches these filters.</td></tr>
              ) : filteredEntries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr
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
                    <td className="px-4 py-2 text-xs capitalize text-gray-300">{severity(entry.action)}</td>
                    <td className="px-4 py-2 text-xs text-gray-300">{entry.username}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 font-mono text-xs text-gray-400">{entry.target || "-"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{entry.ip || "-"}</td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr key={`${entry.id}-details`} className="border-b border-gray-800/50 bg-gray-800/20">
                      <td colSpan={7} className="px-8 py-3 text-xs text-gray-300">
                        <div className="space-y-1.5">
                          <div><span className="text-gray-500">Details:</span> {entry.details || "No extra details"}</div>
                          <div><span className="text-gray-500">Target:</span> <span className="font-mono">{entry.target || "-"}</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{filteredEntries.length} shown · {total} total</span>
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
