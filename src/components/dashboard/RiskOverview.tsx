"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, HardDrive, HelpCircle, Loader2, MemoryStick, RefreshCw, ServerCrash, Sparkles } from "lucide-react";
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

interface NotificationChannel {
  id: string;
  enabled: boolean;
  alertRules: Array<{ id: string; enabled: boolean; metric: string }>;
}

interface NotificationCheckSummary {
  checked: number;
  offline: number;
  appDown: number;
  serviceDown: number;
  sslExpiring: number;
  backupStale: number;
  results: Array<{ serverId: string; serverName: string; status: "checked" | "offline"; alerts: string[] }>;
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
  const router = useRouter();
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [guideMessage, setGuideMessage] = useState<string | null>(null);
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannel[]>([]);
  const [notificationCheck, setNotificationCheck] = useState<NotificationCheckSummary | null>(null);
  const [checkingNotifications, setCheckingNotifications] = useState(false);
  const [fleetSearch, setFleetSearch] = useState("");
  const [fleetFilter, setFleetFilter] = useState<"all" | "critical" | "warning" | "healthy" | "offline">("all");
  const [fleetGroupBy, setFleetGroupBy] = useState<"location" | "status" | "severity">("location");
  const [fleetPageSize, setFleetPageSize] = useState(6);
  const [fleetPage, setFleetPage] = useState(1);

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

  async function fetchNotificationChannels() {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const json: ApiResponse<NotificationChannel[]> = await res.json();
      if (res.ok && json.success && json.data) setNotificationChannels(json.data);
    } catch { /* notification setup status is optional */ }
  }

  async function runNotificationCheck() {
    setCheckingNotifications(true);
    try {
      const res = await fetch("/api/notifications/check", { method: "POST" });
      const json: ApiResponse<NotificationCheckSummary> = await res.json();
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Notification check failed");
      setNotificationCheck(json.data);
      await fetchRisk();
    } catch (err) {
      setGuideMessage(err instanceof Error ? err.message : "Notification check failed");
    } finally {
      setCheckingNotifications(false);
    }
  }

  async function runServerAction(action: string) {
    const res = await fetch("/api/servers/local/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json: ApiResponse<{ output: string }> = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || "Action failed");
    return json.data?.output || "Done";
  }

  async function fixAlert(server: ServerRisk, alert: RiskAlert) {
    const key = `${server.serverId}-${alert.id}`;
    setFixing(key);
    setGuideMessage(null);
    try {
      if (server.serverId !== "local") {
        router.push(`/servers/${encodeURIComponent(server.serverId)}`);
        return;
      }

      if (alert.id === "disk") {
        const backup = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const backupJson: ApiResponse<{ name: string }> = await backup.json();
        if (!backup.ok || !backupJson.success) throw new Error(backupJson.error || "Backup failed");
        const logs = await runServerAction("clear-logs");
        const cache = await runServerAction("clear-apt-cache");
        setGuideMessage(`Safe disk cleanup completed after backup ${backupJson.data?.name || "created"}.\n\n${logs}\n\n${cache}`);
        await fetchRisk();
        return;
      }

      if (alert.id === "memory" || alert.id === "cpu") {
        const output = await runServerAction("system-health-check");
        setGuideMessage(`Read-only diagnosis completed. Review the output before restarting anything.\n\n${output}`);
        return;
      }

      router.push(`/servers/${encodeURIComponent(server.serverId)}`);
    } catch (err) {
      setGuideMessage(err instanceof Error ? err.message : "Guided fix failed");
    } finally {
      setFixing(null);
    }
  }

  function explainAlert(server: ServerRisk, alert: RiskAlert) {
    setGuideMessage(`${server.serverName}: ${alert.title}\n\n${alert.detail}\n\nSafe next step: ${alert.nextStep}`);
  }

  useEffect(() => {
    fetchRisk();
    fetchNotificationChannels();
    const timer = setInterval(fetchRisk, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setFleetPage(1);
  }, [fleetFilter, fleetGroupBy, fleetPageSize, fleetSearch]);

  const fleetView = useMemo(() => {
    if (!risk) return { groups: [] as Array<{ title: string; helper: string; servers: ServerRisk[] }>, total: 0, pageCount: 1 };
    const query = fleetSearch.trim().toLowerCase();
    const filtered = risk.servers.filter((server) => {
      const matchesSearch = !query || `${server.serverName} ${server.host} ${server.serverId}`.toLowerCase().includes(query);
      const matchesFilter =
        fleetFilter === "all" ||
        (fleetFilter === "offline" && server.status !== "online") ||
        (fleetFilter === "healthy" && server.alerts.length === 0 && server.status === "online") ||
        (fleetFilter === "critical" && server.alerts.some((alert) => alert.severity === "critical")) ||
        (fleetFilter === "warning" && server.alerts.some((alert) => alert.severity === "warning"));
      return matchesSearch && matchesFilter;
    });
    const sorted = filtered.sort((a, b) => {
      if (b.alerts.length !== a.alerts.length) return b.alerts.length - a.alerts.length;
      return a.score - b.score;
    });
    const pageCount = Math.max(1, Math.ceil(sorted.length / fleetPageSize));
    const page = Math.min(fleetPage, pageCount);
    const pageItems = sorted.slice((page - 1) * fleetPageSize, page * fleetPageSize);

    const makeGroup = (title: string, helper: string, servers: ServerRisk[]) => ({ title, helper, servers });
    let groups: Array<{ title: string; helper: string; servers: ServerRisk[] }>;
    if (fleetGroupBy === "status") {
      groups = [
        makeGroup("Online", "Reachable servers", pageItems.filter((server) => server.status === "online")),
        makeGroup("Offline or unknown", "Needs connectivity check", pageItems.filter((server) => server.status !== "online")),
      ];
    } else if (fleetGroupBy === "severity") {
      groups = [
        makeGroup("Critical", "Highest priority", pageItems.filter((server) => server.alerts.some((alert) => alert.severity === "critical"))),
        makeGroup("Warning", "Needs attention", pageItems.filter((server) => server.alerts.some((alert) => alert.severity === "warning") && !server.alerts.some((alert) => alert.severity === "critical"))),
        makeGroup("Healthy", "No current alerts", pageItems.filter((server) => server.alerts.length === 0)),
      ];
    } else {
      groups = [
        makeGroup("Local server", "This machine running the panel", pageItems.filter((server) => server.serverId === "local")),
        makeGroup("Remote servers", "Other VPS machines connected by SSH", pageItems.filter((server) => server.serverId !== "local")),
      ];
    }

    return { groups: groups.filter((group) => group.servers.length > 0), total: sorted.length, pageCount };
  }, [fleetFilter, fleetGroupBy, fleetPage, fleetPageSize, fleetSearch, risk]);

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
  const enabledChannels = notificationChannels.filter((channel) => channel.enabled).length;
  const enabledRules = notificationChannels.flatMap((channel) => channel.alertRules).filter((rule) => rule.enabled).length;
  const notificationReady = enabledChannels > 0 && enabledRules > 0;
  const visibleServers = fleetView.total;
  const hasActiveFleetFilter = fleetFilter !== "all" || Boolean(fleetSearch.trim());

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500" title="A simple 0-100 health score across all servers. Offline servers and critical alerts lower this score.">Fleet Risk Score</p>
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

        <div className={`mt-4 rounded-xl border p-3 ${notificationReady ? "border-emerald-500/20 bg-emerald-500/10" : "border-amber-500/20 bg-amber-500/10"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Bell className={`mt-0.5 h-4 w-4 ${notificationReady ? "text-emerald-300" : "text-amber-300"}`} />
              <div>
                <p className="text-sm font-semibold text-white">Notification Watchdog</p>
                <p className="mt-1 text-xs text-gray-400">Rules, thresholds, cooldowns, and external delivery.</p>
                <p className="mt-1 text-xs text-gray-500">
                  {notificationReady ? `External alerts armed: ${enabledChannels} channel · ${enabledRules} rules · auto-check every 15 min.` : "In-app check is ready. Add a channel/rule only if you want Discord, Slack, or Telegram alerts."}
                </p>
              </div>
            </div>
            <button
              onClick={runNotificationCheck}
              disabled={checkingNotifications}
              className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingNotifications ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Check now
            </button>
          </div>
          {notificationCheck && (
            <div className="mt-2 space-y-2 text-xs text-gray-400">
              <p>
                Last check: {notificationCheck.checked} servers · {notificationCheck.offline} offline · {notificationCheck.appDown} app down · {notificationCheck.serviceDown} service down · {notificationCheck.sslExpiring} SSL · {notificationCheck.backupStale} backup
              </p>
              {notificationCheck.results.some((result) => result.status === "offline" || result.alerts.length > 0) ? (
                <div className="space-y-1">
                  {notificationCheck.results.filter((result) => result.status === "offline" || result.alerts.length > 0).slice(0, 4).map((result) => (
                    <div key={result.serverId} className="rounded-lg border border-gray-700/70 bg-gray-950/50 px-2 py-1">
                      <span className="font-medium text-gray-200">{result.serverName}</span>: {result.status === "offline" ? "offline" : result.alerts.join(", ").replace(/_/g, " ")}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-300">No smart-alert issue found in this check.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wider text-gray-500">Alert Center</p>
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

        <div className="mb-4 grid gap-2 lg:grid-cols-[1fr_auto]">
          <input
            value={fleetSearch}
            onChange={(event) => setFleetSearch(event.target.value)}
            placeholder="Search server, IP, or id..."
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-brand-500"
          />
          <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
            {[
              ["all", "All"],
              ["critical", "Critical"],
              ["warning", "Warning"],
              ["offline", "Offline"],
              ["healthy", "Healthy"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFleetFilter(value as typeof fleetFilter)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 ${fleetFilter === value ? "border-brand-500/60 bg-brand-500/15 text-brand-200" : "border-gray-700 bg-gray-900 text-gray-400 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500">
            Group by
            <select value={fleetGroupBy} onChange={(event) => setFleetGroupBy(event.target.value as typeof fleetGroupBy)} className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white">
              <option value="location">Local / Remote</option>
              <option value="status">Online / Offline</option>
              <option value="severity">Severity</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Servers per page
            <select value={fleetPageSize} onChange={(event) => setFleetPageSize(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white">
              <option value={6}>6</option>
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={48}>48</option>
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>Showing {visibleServers === 0 ? 0 : (fleetPage - 1) * fleetPageSize + 1}-{Math.min(fleetPage * fleetPageSize, visibleServers)} of {visibleServers} matching servers · {risk.servers.length} total</span>
          {hasActiveFleetFilter && (
            <button
              onClick={() => { setFleetSearch(""); setFleetFilter("all"); }}
              className="rounded-lg border border-gray-700 px-2 py-1 text-gray-300 hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>

        {healthy && !hasActiveFleetFilter && (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            No urgent issue detected. Fleet list still stays visible below so large-fleet layout can be reviewed.
          </div>
        )}

        <div className="max-h-[520px] space-y-4 overflow-y-auto pr-1">
          {visibleServers === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
              No server matches this search/filter.
            </div>
          ) : (
            fleetView.groups.map((group) => (
              <div key={group.title} className="rounded-2xl border border-gray-700/70 bg-gray-950/30 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{group.title}</h3>
                    <p className="text-xs text-gray-500">{group.helper}</p>
                  </div>
                  <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-400">{group.servers.length}</span>
                </div>

                {group.servers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-700 p-4 text-sm text-gray-500">{group.title === "Local server" ? "Local server data unavailable." : "No remote server added yet."}</div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                    {group.servers.map((server) => {
                      const serverHealthy = server.alerts.length === 0;
                      const displayName = server.serverId === "local" ? "Local" : server.serverName;
                      return (
                        <div key={server.serverId} className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${server.status === "online" ? "bg-emerald-400" : "bg-red-400"}`} />
                                <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                              </div>
                              <p className="mt-1 truncate text-xs text-gray-500">{server.serverId === "local" ? `IP: ${server.host}` : server.host}</p>
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
                              <>
                                {server.alerts.slice(0, 4).map((alert, index) => (
                                  <span
                                    key={`${alert.id}-${index}`}
                                    title={alertTooltip(alert)}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${severityClass[alert.severity]}`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${severityDot[alert.severity]}`} />
                                    {severityIcon(alert)}
                                    <span className="max-w-28 truncate">{alert.title}</span>
                                  </span>
                                ))}
                                {server.alerts.length > 4 && <span className="rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-xs text-gray-400">+{server.alerts.length - 4} more</span>}
                              </>
                            )}
                          </div>

                          {!serverHealthy && (
                            <div className="mt-3 space-y-2">
                              {server.alerts.slice(0, 2).map((alert, index) => {
                                const key = `${server.serverId}-${alert.id}`;
                                const fixLabel = server.serverId === "local" && alert.id === "disk" ? "Fix safely" : server.serverId === "local" && (alert.id === "memory" || alert.id === "cpu") ? "Diagnose" : "View details";
                                return (
                                  <div key={`${alert.id}-fix-${index}`} className="rounded-lg border border-gray-700/70 bg-gray-950/60 p-2">
                                    <p className="truncate text-xs font-medium text-gray-200">{alert.title}</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button onClick={() => explainAlert(server, alert)} className="rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white">
                                        Explain
                                      </button>
                                      <button onClick={() => fixAlert(server, alert)} disabled={fixing !== null} className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-60">
                                        {fixing === key ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                        {fixLabel}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

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
                )}
              </div>
            )))}
          </div>

        {fleetView.pageCount > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-700 bg-gray-900/70 p-3 text-xs text-gray-400">
            <span>Page {fleetPage} of {fleetView.pageCount}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFleetPage((page) => Math.max(1, page - 1))}
                disabled={fleetPage <= 1}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setFleetPage((page) => Math.min(fleetView.pageCount, page + 1))}
                disabled={fleetPage >= fleetView.pageCount}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {guideMessage && (
          <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-white">Guided fix</p>
              <button onClick={() => setGuideMessage(null)} className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:text-white">
                Close
              </button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5 text-gray-300">{guideMessage}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
