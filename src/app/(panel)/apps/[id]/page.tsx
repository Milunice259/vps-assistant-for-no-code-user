"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { AppLogViewer } from "@/components/apps/AppLogViewer";
import { AppResourceChart } from "@/components/apps/AppResourceChart";
import { AppEnvEditor } from "@/components/apps/AppEnvEditor";
import { AppSettings } from "@/components/apps/AppSettings";
import { WebTerminal } from "@/components/apps/WebTerminal";
import { AppHealthCheck } from "@/components/apps/AppHealthCheck";
import type { AppDetailInfo, ContainerStats, AppMetricInfo, ApiResponse, AppStatusType } from "@/types";

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

const APP_TABS = [
  { key: "overview", label: "Overview", icon: <Activity className="h-4 w-4" /> },
  { key: "terminal", label: "Terminal", icon: <Terminal className="h-4 w-4" /> },
  { key: "logs", label: "Logs", icon: <FileText className="h-4 w-4" /> },
  { key: "resources", label: "Resources", icon: <Cpu className="h-4 w-4" /> },
  { key: "env", label: "Env Vars", icon: <Key className="h-4 w-4" /> },
  { key: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

export default function AppDetailPage() {
  const params = useParams();
  const router = useRouter();
  const appId = params.id as string;

  const [app, setApp] = useState<AppDetailInfo | null>(null);
  const [liveStats, setLiveStats] = useState<ContainerStats | null>(null);
  const [metrics, setMetrics] = useState<AppMetricInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApp = useCallback(async (includeStats = true, includeMetrics = false) => {
    try {
      const params = new URLSearchParams();
      if (includeStats) params.set("stats", "true");
      if (includeMetrics) params.set("metrics", "true");
      const res = await fetch(`/api/apps/${appId}?${params}`);
      const json: ApiResponse<AppDetailInfo & { liveStats?: ContainerStats; metrics?: AppMetricInfo[] }> = await res.json();
      if (json.success && json.data) {
        setApp(json.data);
        if (json.data.liveStats) setLiveStats(json.data.liveStats);
        if (json.data.metrics) setMetrics(json.data.metrics);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchApp(true, true);
  }, [fetchApp]);

  // Auto-refresh stats every 10 seconds
  useEffect(() => {
    if (activeTab !== "overview" && activeTab !== "resources") return;
    const interval = setInterval(() => fetchApp(true, false), 10_000);
    return () => clearInterval(interval);
  }, [activeTab, fetchApp]);

  async function handleAction(action: string) {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/apps/${appId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();
      if (json.success) {
        // Refresh after action
        setTimeout(() => fetchApp(true, false), 1500);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this application tracking record?")) return;
    try {
      await fetch(`/api/apps/${appId}`, { method: "DELETE" });
      router.push("/apps");
    } catch {
      // ignore
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
      <div className="text-center py-12 text-gray-400">Application not found.</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/apps")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-white">{app.name}</h2>
            <p className="text-sm text-gray-400">
              {app.image || "No image"} • {app.serverName}
            </p>
          </div>
          <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
        </div>
        <div className="flex gap-2">
          {/* Container Actions */}
          {app.containerId && (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "start"}
                disabled={!!actionLoading || app.status === "RUNNING"}
                onClick={() => handleAction("start")}
              >
                <Play className="w-3.5 h-3.5 mr-1" /> Start
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "stop"}
                disabled={!!actionLoading || app.status === "STOPPED"}
                onClick={() => handleAction("stop")}
              >
                <Square className="w-3.5 h-3.5 mr-1" /> Stop
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading === "restart"}
                disabled={!!actionLoading}
                onClick={() => handleAction("restart")}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restart
              </Button>
              {app.image && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={actionLoading === "pull"}
                  disabled={!!actionLoading}
                  onClick={() => handleAction("pull")}
                >
                  <Download className="w-3.5 h-3.5 mr-1" /> Pull
                </Button>
              )}
            </>
          )}
          <Button variant="danger" size="sm" onClick={handleDelete}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
          </Button>
        </div>
      </div>

      {/* Live Stats Summary */}
      {liveStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="CPU" value={`${liveStats.cpuPercent.toFixed(1)}%`} color="blue" />
          <StatCard
            label="Memory"
            value={`${liveStats.memUsageMB.toFixed(0)} MB`}
            sub={`/ ${liveStats.memLimitMB.toFixed(0)} MB`}
            color="purple"
          />
          <StatCard label="Net In" value={formatBytes(liveStats.netIn)} color="emerald" />
          <StatCard label="Net Out" value={formatBytes(liveStats.netOut)} color="amber" />
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={APP_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <OverviewPanel app={app} />
          {app.containerId && <AppHealthCheck appId={app.id} />}
        </div>
      )}
      {activeTab === "terminal" && app.containerId && (
        <WebTerminal
          appId={app.id}
          appName={app.name}
          containerId={app.containerId}
          onClose={() => setActiveTab("overview")}
        />
      )}
      {activeTab === "logs" && app.containerId && (
        <AppLogViewer
          appId={app.id}
          appName={app.name}
          onClose={() => setActiveTab("overview")}
        />
      )}
      {activeTab === "resources" && (
        <AppResourceChart
          liveStats={liveStats}
          metrics={metrics}
          cpuLimit={app.cpuLimit}
          memoryLimit={app.memoryLimit}
          onRefresh={() => fetchApp(true, true)}
        />
      )}
      {activeTab === "env" && <AppEnvEditor appId={appId} />}
      {activeTab === "settings" && (
        <AppSettings app={app} onSaved={() => fetchApp(false, false)} />
      )}
    </div>
  );
}

// ─── Sub-components ───

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorMap[color] || colorMap.blue}`}>
      <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold mt-1">
        {value}
        {sub && <span className="text-xs text-gray-500 ml-1">{sub}</span>}
      </p>
    </div>
  );
}

function OverviewPanel({ app }: { app: AppDetailInfo }) {
  const details = [
    { label: "Container ID", value: app.containerId || "—" },
    { label: "Container Name", value: app.containerName || "—" },
    { label: "Image", value: app.image || "—" },
    { label: "Domain", value: app.domain || "—" },
    { label: "Server", value: app.serverName },
    { label: "Restart Policy", value: app.restartPolicy || "none" },
    { label: "CPU Limit", value: app.cpuLimit ? `${app.cpuLimit} cores` : "Unlimited" },
    { label: "Memory Limit", value: app.memoryLimit ? `${app.memoryLimit} MB` : "Unlimited" },
    { label: "Health Check", value: app.healthCheck || "None" },
    { label: "Created", value: new Date(app.createdAt).toLocaleString() },
    { label: "Updated", value: new Date(app.updatedAt).toLocaleString() },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-800">
          {details.map((d) => (
            <tr key={d.label} className="hover:bg-gray-800/50">
              <td className="py-3 pr-8 text-gray-400 font-medium whitespace-nowrap">{d.label}</td>
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
