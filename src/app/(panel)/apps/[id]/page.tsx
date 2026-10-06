"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Activity,
  FileText,
  Cpu,
  Settings,
  Key,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  Download,
  Trash2,
  Terminal,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { OperationResult } from "@/lib/operation-result";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { AppLogViewer } from "@/components/apps/AppLogViewer";
import { AppEnvEditor } from "@/components/apps/AppEnvEditor";
import { AppSettings } from "@/components/apps/AppSettings";
import { WebTerminal } from "@/components/apps/WebTerminal";
import { useSSE } from "@/hooks/useSSE";
import { useSafeMode } from "@/contexts/SafeModeContext";
import type {
  AppDetailInfo,
  ContainerStats,
  AppMetricInfo,
  ApiResponse,
  AppStatusType,
} from "@/types";

// Lazy-load recharts bundle (~180KB gzipped) — only loads when Resources tab is active
const AppResourceChart = dynamic(
  () =>
    import("@/components/apps/AppResourceChart").then((m) => ({
      default: m.AppResourceChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  },
);

function statusBadgeVariant(status: AppStatusType) {
  switch (status) {
    case "RUNNING":
      return "success" as const;
    case "STOPPED":
      return "danger" as const;
    case "RESTARTING":
      return "warning" as const;
    case "UNHEALTHY":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

/** Derive a human-friendly app name from container metadata. */
function deriveAppName(app: AppDetailInfo): string {
  // 1. If name exists and isn't just a container ID (64-char hex), use it
  if (app.name && !/^[a-f0-9]{12,64}$/.test(app.name)) {
    // Clean up Docker container naming conventions
    return app.name
      .replace(/^\//, "") // Leading slash
      .replace(/_1$/, "") // Docker Compose suffix _1
      .replace(/[-_]/g, " ") // Dashes/underscores to spaces
      .replace(/\b\w/g, (c) => c.toUpperCase()); // Title case
  }
  // 2. Try container name
  if (app.containerName && !/^[a-f0-9]{12,64}$/.test(app.containerName)) {
    return app.containerName
      .replace(/^\//, "")
      .replace(/_1$/, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // 3. Try image name (without tag/registry)
  if (app.image) {
    const imageName = app.image.split(":")[0].split("/").pop() || app.image;
    return imageName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // 4. Fallback: truncated container ID
  return app.containerId
    ? `Container ${app.containerId.substring(0, 12)}`
    : "Unknown App";
}

const APP_TABS = [
  {
    key: "overview",
    label: "Overview",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    key: "terminal",
    label: "Terminal",
    icon: <Terminal className="h-4 w-4" />,
  },
  { key: "logs", label: "Logs", icon: <FileText className="h-4 w-4" /> },
  { key: "resources", label: "Resources", icon: <Cpu className="h-4 w-4" /> },
  { key: "env", label: "Env Vars", icon: <Key className="h-4 w-4" /> },
  {
    key: "settings",
    label: "Settings",
    icon: <Settings className="h-4 w-4" />,
  },
];

/** Tab descriptions for user guidance */
const TAB_DESCRIPTIONS: Record<string, string> = {
  overview: "Container configuration, metadata, and health status at a glance.",
  terminal: "Open an interactive shell session inside this container.",
  logs: "Live-stream stdout/stderr output from this container.",
  resources: "CPU, memory, and network usage charts with historical data.",
  env: "View runtime variables injected by Docker (read-only) and manage custom .env overrides for your app.",
  settings:
    "Update application settings like resource limits, domain, and restart policy.",
};

interface AppStreamData {
  status: string;
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  netIn: number;
  netOut: number;
  pids: number;
}

export default function AppDetailPage() {
  const params = useParams();
  const appId = params.id as string;
  // Route identity owns all state, including confirmations, readbacks and SSE.
  return <AppDetail key={appId} appId={appId} />;
}

function AppDetail({ appId }: { appId: string }) {
  const { safeMode } = useSafeMode();
  const router = useRouter();

  const [app, setApp] = useState<AppDetailInfo | null>(null);
  const [metrics, setMetrics] = useState<AppMetricInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<(OperationResult & { action?: string }) | null>(null);
  const [needsReadback, setNeedsReadback] = useState(false);
  const operationBusy = useRef(false);

  // SSE for live stats — replaces 10s polling
  const isStatsTab = activeTab === "overview" || activeTab === "resources";
  const { data: streamStats } = useSSE<AppStreamData>(
    `/api/apps/${appId}/stream`,
    { enabled: isStatsTab && app?.appSource !== "systemd", fallbackPollMs: 10_000 },
  );

  // Compute liveStats from SSE stream
  const liveStats: ContainerStats | null = streamStats
    ? {
        cpuPercent: streamStats.cpuPercent,
        memUsageMB: streamStats.memUsageMB,
        memLimitMB: streamStats.memLimitMB,
        memPercent:
          streamStats.memLimitMB > 0
            ? (streamStats.memUsageMB / streamStats.memLimitMB) * 100
            : 0,
        netIn: streamStats.netIn,
        netOut: streamStats.netOut,
        pids: streamStats.pids ?? 0,
      }
    : null;

  const fetchApp = useCallback(
    async (includeStats = false, includeMetrics = false) => {
      try {
        const params = new URLSearchParams();
        if (includeStats) params.set("stats", "true");
        if (includeMetrics) params.set("metrics", "true");
        const res = await fetch(`/api/apps/${appId}?${params}`, { cache: "no-store" });
        const json: ApiResponse<
          AppDetailInfo & {
            liveStats?: ContainerStats;
            metrics?: AppMetricInfo[];
          }
        > = await res.json();
        if (res.ok && json.success && json.data) {
          setApp(json.data);
          if (json.data.metrics) setMetrics(json.data.metrics);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [appId],
  );

  useEffect(() => {
    setPendingAction(null);
    setActionResult(null);
    setActionError(null);
    setNeedsReadback(false);
    fetchApp(false, true);
  }, [fetchApp]);

  const impacts: Record<string, string> = {
    start: "Start this container. Saved data and mounted volumes are kept. This does not verify application readiness.",
    stop: "Stop this container. The app will be unavailable until started again. Saved data and mounted volumes are kept.",
    restart: "Restart this container once. Expect a brief interruption. No image update, recreation, or data cleanup; mounted volumes are kept. Docker state and health will be checked.",
    pull: "Download the configured image. This uses disk space but does not update the running container.",
    recreate: "Replace the container using saved settings. Data in its writable layer may be lost. This is not a guided restart.",
  };

  function handleAction(action: string) {
    if (safeMode || actionLoading || needsReadback || !app || app.appSource === "systemd" || !impacts[action]) return;
    setPendingAction(action);
  }

  async function executeAction() {
    const action = pendingAction;
    if (safeMode || operationBusy.current || needsReadback || !app || !action) return;
    operationBusy.current = true;
    setPendingAction(null);
    setActionLoading(action);
    setActionError(null);
    setActionResult(null);
    const lifecycle = ["start", "stop", "restart"].includes(action);
    let submitted = false;
    try {
      if (!navigator.onLine) { setActionError("You are offline. No command was submitted."); return; }
      if (lifecycle && (!app.serverId || !app.containerId)) { setActionError("Container target unavailable. Refresh the app details."); return; }
      submitted = true;
      const res = await fetch(lifecycle ? `/api/servers/${encodeURIComponent(app.serverId)}/docker/action` : `/api/apps/${appId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, safeModeOff: !safeMode, ...(lifecycle ? { containerId: app.containerId } : {}) }),
      });
      const json: ApiResponse<OperationResult> = await res.json();
      if (!res.ok || !json.success) {
        setActionError(res.status >= 500 ? `${json.error || "Server unavailable"}. Outcome unknown — check state before another action.` : json.error || "App action failed");
        if (res.status >= 500) setNeedsReadback(true);
      } else {
        setActionResult(lifecycle && json.data?.message ? { ...json.data, action } : { message: lifecycle ? "Outcome unknown. Check state before another action." : "Advanced command response received; outcome unverified. This was not a guided restart.", output: json.data?.output, risk: "danger", verified: false, outcome: "unverified" });
        if (json.data?.verified !== true || json.data?.outcome !== "verified") setNeedsReadback(true);
      }
      // Keep single-flight busy through the real detail readback, not a timer.
      const detailRead = await fetchApp(true, false);
      const stateRead = lifecycle ? await readContainerState() : true;
      if (!detailRead || !stateRead) {
        setActionError("Live container readback unavailable. The command result above is retained; check state before another action.");
        setNeedsReadback(true);
      }
    } catch {
      setActionError(submitted ? "Outcome unknown — connection lost after submission. The command may have run. Check state; do not blindly retry." : "Server unavailable; no command submitted.");
      if (submitted) setNeedsReadback(true);
    } finally {
      operationBusy.current = false;
      setActionLoading(null);
    }
  }

  async function readContainerState() {
    if (!app?.serverId || !app.containerId) return false;
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(app.serverId)}/docker`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success || !Array.isArray(json.data)) return false;
      const container = json.data.find((item: { id: string }) => item.id === app.containerId || (!!app.containerId && (item.id.startsWith(app.containerId) || app.containerId.startsWith(item.id))));
      const statuses: Record<string, AppStatusType> = { running: "RUNNING", exited: "STOPPED", restarting: "RESTARTING", dead: "STOPPED", created: "STOPPED", paused: "STOPPED" };
      if (!container || !statuses[container.state]) return false;
      setApp(current => current ? { ...current, status: statuses[container.state] } : current);
      return true;
    } catch { return false; }
  }

  async function checkState() {
    if (operationBusy.current) return;
    operationBusy.current = true;
    setActionLoading("readback");
    await fetchApp(true, false);
    const read = await readContainerState();
    if (read) { setNeedsReadback(false); setActionError("Current app state refreshed. This does not prove a previous command completed. Review state and health before any new action."); }
    else setActionError("Server offline or app detail unavailable. Outcome remains unknown; no command retried.");
    operationBusy.current = false;
    setActionLoading(null);
  }

  async function handleDelete() {
    if (safeMode || actionLoading || !app) return;
    if (!confirm(`Delete tracking for ${deriveAppName(app)} on ${app.serverName}?\n\nRemoves the panel record only. The container will not be stopped or deleted.`)) return;
    setActionLoading("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: "DELETE",
        headers: { "X-Safe-Mode-Off": "true" },
      });
      const json: ApiResponse<unknown> = await res.json();
      if (!res.ok || !json.success) {
        setActionError(json.error || "Failed to delete tracking record");
        return;
      }
      router.push("/apps");
    } catch {
      setActionError("Could not connect to the server");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="text-center py-12 text-gray-400">
        Application not found.
      </div>
    );
  }

  const displayName = deriveAppName(app);
  const isSystemService = app.appSource === "systemd";
  const visibleTabs = isSystemService
    ? APP_TABS.filter((tab) => tab.key === "overview")
    : APP_TABS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => router.push("/apps")}
            className="mt-1 shrink-0 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white sm:text-xl">{displayName}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400 mt-0.5 sm:text-sm">
              <span className="truncate max-w-[160px] font-mono text-xs bg-gray-800 px-1.5 py-0.5 rounded sm:max-w-[240px] sm:px-2">
                {isSystemService ? "System Service" : app.image || "Manual App"}
              </span>
              <span>•</span>
              <span className="truncate">{app.serverName}</span>
              {app.domain && (
                <>
                  <span>•</span>
                  <span className="truncate text-brand-400">{app.domain}</span>
                </>
              )}
            </div>
          </div>
          <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* Container Actions */}
          {!isSystemService && app.containerId && (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "start"}
                disabled={safeMode || !!actionLoading || needsReadback || app.status === "RUNNING"}
                onClick={() => handleAction("start")}
              >
                <Play className="w-3.5 h-3.5 mr-1" /> Start
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "stop"}
                disabled={safeMode || !!actionLoading || needsReadback || app.status === "STOPPED"}
                onClick={() => handleAction("stop")}
              >
                <Square className="w-3.5 h-3.5 mr-1" /> Stop
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "restart"}
                disabled={safeMode || !!actionLoading || needsReadback}
                onClick={() => handleAction("restart")}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restart
              </Button>
              {app.image && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={actionLoading === "pull"}
                  disabled={safeMode || !!actionLoading || needsReadback}
                  onClick={() => handleAction("pull")}
                >
                  <Download className="w-3.5 h-3.5 mr-1" /> Pull
                </Button>
              )}
            </>
          )}
          {!app.id.startsWith("local-service::") && !app.id.startsWith("local::") && (
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={safeMode || !!actionLoading || needsReadback} loading={actionLoading === "delete"}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog open={!!pendingAction} title={`${pendingAction || "Action"}: ${displayName}`} message={`Target: ${app.serverName} · ${app.containerName || app.containerId || displayName}. ${impacts[pendingAction || ""] || ""}`} confirmLabel={pendingAction === "restart" ? "Restart once" : "Confirm action"} variant="danger" onConfirm={executeAction} onCancel={() => setPendingAction(null)} />
      {isSystemService && <a className="inline-block text-sm text-brand-400" href={`/servers/${encodeURIComponent(app.serverId)}#services`}>Manage this system service in Services →</a>}
      {actionResult && <div role="status" className={`rounded-lg border p-3 text-sm ${actionResult.outcome === "failed" || actionResult.health === "unhealthy" ? "border-red-500/30 text-red-300" : actionResult.verified && actionResult.outcome === "verified" && (actionResult.health === "healthy" || actionResult.action === "stop") ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}><p>{actionResult.message}</p>{actionResult.output && <p className="mt-1 break-words text-xs">{actionResult.output}</p>}</div>}
      {needsReadback && <Button variant="secondary" size="sm" loading={actionLoading === "readback"} disabled={!!actionLoading} onClick={checkState}>Check state (no retry)</Button>}
      {/* Live Stats Summary */}
      {safeMode && <p className="text-xs text-amber-300">Safe Mode locks app changes and terminal commands. Turn it off in the header to continue; diagnostics and logs stay available.</p>}
      {actionError && <p role="alert" className="text-sm text-red-400">{actionError}</p>}
      {liveStats && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="CPU"
            value={`${liveStats.cpuPercent.toFixed(1)}%`}
            color="blue"
          />
          <StatCard
            label="Memory"
            value={`${liveStats.memUsageMB.toFixed(0)} MB`}
            sub={`/ ${liveStats.memLimitMB.toFixed(0)} MB`}
            color="purple"
          />
          <StatCard
            label="Net In"
            value={formatBytes(liveStats.netIn)}
            color="emerald"
          />
          <StatCard
            label="Net Out"
            value={formatBytes(liveStats.netOut)}
            color="amber"
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={visibleTabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab description */}
      {TAB_DESCRIPTIONS[activeTab] && (
        <p className="text-xs text-gray-500 -mt-3">
          {TAB_DESCRIPTIONS[activeTab]}
        </p>
      )}

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <OverviewPanel app={app} appId={app.id} />
        </div>
      )}
      {activeTab === "terminal" && app.containerId && (
        <WebTerminal
          appId={app.id}
          appName={`${displayName} on ${app.serverName}`}
          containerId={app.containerId}
          onClose={() => setActiveTab("overview")}
        />
      )}
      {activeTab === "logs" && app.containerId && (
        <AppLogViewer
          appId={app.id}
          appName={displayName}
          onClose={() => setActiveTab("overview")}
        />
      )}
      {activeTab === "resources" && (
        <AppResourceChart
          appId={appId}
          liveStats={liveStats}
          metrics={metrics}
          cpuLimit={app.cpuLimit}
          memoryLimit={app.memoryLimit}
          onRefresh={() => fetchApp(true, true)}
        />
      )}
      {activeTab === "env" && <AppEnvEditor appId={appId} appName={`${displayName} on ${app.serverName}`} />}
      {activeTab === "settings" && (
        <AppSettings app={app} onSaved={() => fetchApp(false, false)} />
      )}
    </div>
  );
}

// ─── Sub-components ───

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };

  return (
    <div
      className={`rounded-lg border p-4 ${colorMap[color] || colorMap.blue}`}
    >
      <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold mt-1">
        {value}
        {sub && <span className="text-xs text-gray-500 ml-1">{sub}</span>}
      </p>
    </div>
  );
}

function InlineHealthCheck({ appId }: { appId: string }) {
  const [result, setResult] = useState<{
    status: "healthy" | "unhealthy" | "unknown";
    output: string;
    containerState: string;
    checkedAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/health`);
      const json: ApiResponse<typeof result> = await res.json();
      if (json.success && json.data) setResult(json.data);
      else setError(json.error || "Health check failed");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => { runCheck(); }, [runCheck]);

  const statusStyle = {
    healthy: "text-emerald-400",
    unhealthy: "text-red-400",
    unknown: "text-gray-400",
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {loading && !result && (
        <span className="text-xs text-gray-500">Checking…</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {result && (
        <>
          <span className={`text-sm font-semibold capitalize ${statusStyle[result.status]}`}>
            {result.status}
          </span>
          <span className="text-xs text-gray-500">{result.output}</span>
        </>
      )}
      <Button variant="ghost" size="sm" onClick={runCheck} loading={loading}>
        <RefreshCw className="h-3 w-3 mr-1" /> Check Now
      </Button>
    </div>
  );
}

function OverviewPanel({ app, appId }: { app: AppDetailInfo; appId: string }) {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    if (app.containerId) {
      navigator.clipboard.writeText(app.containerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const details = [
    {
      label: "Container ID",
      value: app.containerId ? (
        <span className="flex items-center gap-2">
          <code className="text-xs bg-gray-800 px-2 py-0.5 rounded font-mono">
            {app.containerId.substring(0, 12)}
          </code>
          <button
            onClick={copyId}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Copy full ID"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {copied && <span className="text-xs text-emerald-400">Copied!</span>}
        </span>
      ) : (
        "—"
      ),
    },
    { label: app.appSource === "systemd" ? "Service Unit" : "Container Name", value: app.appSource === "systemd" ? app.image || "—" : app.containerName || "—" },
    { label: app.appSource === "systemd" ? "Service File" : "Image", value: app.appSource === "systemd" ? app.volumes || "—" : app.image || "—" },
    {
      label: "Domain",
      value: app.domain || (
        <span className="text-gray-600 italic">Not configured</span>
      ),
    },
    { label: "Server", value: app.serverName },
    { label: app.appSource === "systemd" ? "Startup State" : "Restart Policy", value: app.restartPolicy || "none" },
    {
      label: "CPU Limit",
      value: app.cpuLimit ? `${app.cpuLimit} cores` : "Unlimited",
    },
    {
      label: "Memory Limit",
      value: app.memoryLimit ? `${app.memoryLimit} MB` : "Unlimited",
    },
    {
      label: app.appSource === "systemd" ? "Unit File" : "Volumes",
      value: app.volumes || <span className="text-gray-600 italic">None</span>,
    },
    {
      label: app.appSource === "systemd" ? "Main Process" : "Ports",
      value: app.ports || <span className="text-gray-600 italic">None</span>,
    },
    {
      label: app.appSource === "systemd" ? "Service State" : "Health Check",
      value: app.appSource === "systemd" ? (
        app.healthCheck || <span className="text-gray-600 italic">Unknown</span>
      ) : app.containerId ? (
        <InlineHealthCheck appId={appId} />
      ) : (
        <span className="text-gray-600 italic">No container</span>
      ),
    },
    { label: "Created", value: new Date(app.createdAt).toLocaleString() },
    { label: "Updated", value: new Date(app.updatedAt).toLocaleString() },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-800">
          {details.map((d) => (
            <tr key={d.label} className="hover:bg-gray-800/50">
              <td className="py-3 pr-4 text-gray-400 font-medium whitespace-nowrap w-28 sm:w-40 sm:pr-8">
                {d.label}
              </td>
              <td className="py-3 text-white break-all">{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes.toFixed(0)} B`;
}

