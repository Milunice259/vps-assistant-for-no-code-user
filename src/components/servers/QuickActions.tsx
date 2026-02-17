"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Zap,
  RefreshCw,
  Trash2,
  HardDrive,
  Shield,
  Server,
  Clock,
  Container,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Timer,
  Network,
  MemoryStick,
  Info,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

/* ══════════════════════════════════════════════════════════
   Helper: friendly error mapping
   ══════════════════════════════════════════════════════════ */
function friendlyErrorMessage(raw: string): string {
  if (raw.includes("nsenter") && raw.includes("Operation not permitted")) {
    return "Host access unavailable. The app needs to run with pid:host mode in Docker to manage the host system.";
  }
  if (raw.includes("permission denied") || raw.includes("Permission denied")) {
    return "Permission denied. This action requires elevated privileges on the server.";
  }
  if (raw.includes("command not found")) {
    const match = raw.match(/(\S+):\s*command not found/);
    return match
      ? `The command "${match[1]}" is not installed on this server.`
      : "A required command is not installed on this server.";
  }
  if (raw.includes("Connection refused") || raw.includes("connect ECONNREFUSED")) {
    return "Could not connect to the server. Make sure the server is online and accessible.";
  }
  if (raw.includes("timeout") || raw.includes("Timeout")) {
    return "The operation timed out. The server may be busy — try again later.";
  }
  if (raw.includes("No space left on device")) {
    return "The server's disk is full. Free up space before trying again.";
  }
  if (raw.length > 300) {
    return raw.slice(0, 250) + "… (truncated)";
  }
  return raw;
}

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */
interface ActionResult {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  timestamp?: number;
}

interface ActionDef {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: "maintenance" | "cleanup" | "info" | "system";
  confirmMessage?: string;
}

/* ══════════════════════════════════════════════════════════
   Action definitions — NON-info categories only
   ══════════════════════════════════════════════════════════ */
const NON_INFO_ACTIONS: ActionDef[] = [
  // Maintenance
  {
    key: "system-update",
    label: "System Update",
    description: "Update all system packages to the latest versions",
    icon: <RefreshCw className="h-4 w-4" />,
    category: "maintenance",
    confirmMessage: "This will update all system packages. Continue?",
  },
  {
    key: "security-updates",
    label: "Security Updates",
    description: "Check for available security patches",
    icon: <Shield className="h-4 w-4" />,
    category: "maintenance",
  },
  {
    key: "sync-time",
    label: "Sync Time",
    description: "Synchronize system clock with NTP servers",
    icon: <Clock className="h-4 w-4" />,
    category: "maintenance",
  },
  // Cleanup
  {
    key: "docker-prune",
    label: "Docker Prune",
    description: "Remove unused images, containers, and volumes to free space",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
    confirmMessage: "This will remove all unused Docker resources. Running containers are not affected. Continue?",
  },
  {
    key: "clear-apt-cache",
    label: "Clear Package Cache",
    description: "Remove cached package files to free disk space",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
  },
  {
    key: "clear-logs",
    label: "Clear Old Logs",
    description: "Remove system logs older than 3 days",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
  },
  // System
  {
    key: "restart-docker",
    label: "Restart Docker",
    description: "Restart the Docker daemon (briefly interrupts all containers)",
    icon: <RefreshCw className="h-4 w-4" />,
    category: "system",
    confirmMessage: "Restarting Docker will briefly interrupt all running containers. Continue?",
  },
  {
    key: "restart-server",
    label: "Restart Server",
    description: "Reboot the entire server (all services will restart)",
    icon: <Server className="h-4 w-4" />,
    category: "system",
    confirmMessage: "This will reboot the server. All services will be temporarily unavailable. Are you sure?",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: "🔧 Maintenance",
  cleanup: "🧹 Cleanup",
  system: "⚙️ System",
};

const NON_INFO_CATEGORY_ORDER = ["maintenance", "cleanup", "system"];

/* ══════════════════════════════════════════════════════════
   Info panel keys (auto-fetched, visually rendered)
   ══════════════════════════════════════════════════════════ */
const INFO_PANELS = [
  { key: "check-disk",           label: "Disk Usage",      icon: <HardDrive className="h-4 w-4" /> },
  { key: "check-memory",         label: "Memory Details",  icon: <MemoryStick className="h-4 w-4" /> },
  { key: "docker-stats",         label: "Docker Stats",    icon: <Container className="h-4 w-4" /> },
  { key: "check-uptime",         label: "System Uptime",   icon: <Timer className="h-4 w-4" /> },
  { key: "check-connections",    label: "Network Summary", icon: <Network className="h-4 w-4" /> },
  { key: "check-docker-version", label: "Docker Version",  icon: <Info className="h-4 w-4" /> },
] as const;

/* ══════════════════════════════════════════════════════════
   Parsers — raw text → structured data
   ══════════════════════════════════════════════════════════ */

interface DiskPartition {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: number;
  mount: string;
}

function parseDiskUsage(raw: string): DiskPartition[] {
  const lines = raw.split("\n").filter(Boolean);
  // Skip header line (Filesystem  Size  Used ...)
  return lines.slice(1).map((line) => {
    const parts = line.trim().split(/\s+/);
    const useStr = (parts[4] || "0%").replace("%", "");
    return {
      filesystem: parts[0] || "",
      size: parts[1] || "0",
      used: parts[2] || "0",
      avail: parts[3] || "0",
      usePercent: parseInt(useStr, 10) || 0,
      mount: parts[5] || "/",
    };
  }).filter((p) => !p.filesystem.startsWith("tmpfs") && !p.filesystem.startsWith("shm") && !p.filesystem.startsWith("overlay") && p.size !== "0");
}

interface DockerStat {
  name: string;
  cpu: string;
  mem: string;
  net: string;
}

function parseDockerStats(raw: string): DockerStat[] {
  const lines = raw.split("\n").filter(Boolean);
  // Skip header if present
  const startIdx = lines[0]?.includes("NAME") ? 1 : 0;
  return lines.slice(startIdx).map((line) => {
    const parts = line.trim().split(/\s{2,}|\t+/);
    return {
      name: parts[0] || "",
      cpu: parts[1] || "0%",
      mem: parts[2] || "0B / 0B",
      net: parts[3] || "0B / 0B",
    };
  }).filter((s) => s.name);
}

interface MemoryRow {
  label: string;
  total: string;
  used: string;
  free: string;
  shared: string;
  buffers: string;
  available: string;
}

function parseMemory(raw: string): { rows: MemoryRow[]; usagePercent: number } {
  const lines = raw.split("\n").filter(Boolean);
  const rows: MemoryRow[] = [];
  let usagePercent = 0;

  for (const line of lines) {
    if (line.startsWith("Mem:")) {
      const parts = line.replace("Mem:", "").trim().split(/\s+/);
      const totalVal = parseFloat(parts[0] || "0");
      const usedVal  = parseFloat(parts[1] || "0");
      usagePercent = totalVal > 0 ? Math.round((usedVal / totalVal) * 100) : 0;
      rows.push({
        label: "RAM",
        total: parts[0] || "0",
        used: parts[1] || "0",
        free: parts[2] || "0",
        shared: parts[3] || "0",
        buffers: parts[4] || "0",
        available: parts[5] || "0",
      });
    } else if (line.startsWith("Swap:")) {
      const parts = line.replace("Swap:", "").trim().split(/\s+/);
      rows.push({
        label: "Swap",
        total: parts[0] || "0",
        used: parts[1] || "0",
        free: parts[2] || "0",
        shared: "",
        buffers: "",
        available: "",
      });
    }
  }
  return { rows, usagePercent };
}

interface NetworkSummary {
  tcp: { total: number; estab: number; closed: number; timewait: number };
  udp: { total: number };
}

function parseNetworkSummary(raw: string): NetworkSummary {
  const result: NetworkSummary = {
    tcp: { total: 0, estab: 0, closed: 0, timewait: 0 },
    udp: { total: 0 },
  };

  for (const line of raw.split("\n")) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith("tcp:") || lower.startsWith("tcp6:")) {
      const totalMatch = lower.match(/(\d+)\s*\(estab/);
      const estabMatch = lower.match(/estab\s+(\d+)/);
      const closedMatch = lower.match(/closed\s+(\d+)/);
      const twMatch = lower.match(/timewait\s+(\d+)/);
      if (totalMatch) result.tcp.total += parseInt(totalMatch[1], 10);
      if (estabMatch) result.tcp.estab += parseInt(estabMatch[1], 10);
      if (closedMatch) result.tcp.closed += parseInt(closedMatch[1], 10);
      if (twMatch) result.tcp.timewait += parseInt(twMatch[1], 10);
    }
    if (lower.startsWith("udp:") || lower.startsWith("udp6:")) {
      const totalMatch = lower.match(/(\d+)\s/);
      if (totalMatch) result.udp.total += parseInt(totalMatch[1], 10);
    }
  }
  return result;
}

/* ══════════════════════════════════════════════════════════
   Visual renderers for each info panel
   ══════════════════════════════════════════════════════════ */

function RenderDiskUsage({ raw }: { raw: string }) {
  const partitions = parseDiskUsage(raw);
  if (partitions.length === 0) {
    return <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>;
  }
  return (
    <div className="space-y-3">
      {partitions.map((p, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-300 font-mono truncate max-w-[180px]" title={p.filesystem}>
              {p.mount}
            </span>
            <span className="text-gray-400">
              {p.used} / {p.size}
            </span>
          </div>
          <div className="h-2.5 bg-gray-700/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                p.usePercent > 90 ? "bg-red-500" : p.usePercent > 70 ? "bg-amber-500" : "bg-brand-500"
              }`}
              style={{ width: `${Math.min(p.usePercent, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500 text-right">{p.usePercent}% used · {p.avail} free</p>
        </div>
      ))}
    </div>
  );
}

function RenderDockerStats({ raw }: { raw: string }) {
  const stats = parseDockerStats(raw);
  if (stats.length === 0) {
    return <p className="text-xs text-gray-500">No running containers</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-left pb-2 font-medium">Container</th>
            <th className="text-right pb-2 font-medium">CPU</th>
            <th className="text-right pb-2 font-medium">Memory</th>
            <th className="text-right pb-2 font-medium">Net I/O</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {stats.map((s, i) => (
            <tr key={i} className="hover:bg-gray-800/30">
              <td className="py-1.5 text-gray-300 font-mono truncate max-w-[140px]" title={s.name}>
                {s.name}
              </td>
              <td className="py-1.5 text-right text-cyan-400 font-mono">{s.cpu}</td>
              <td className="py-1.5 text-right text-purple-400 font-mono text-[11px]">{s.mem}</td>
              <td className="py-1.5 text-right text-gray-400 font-mono text-[11px]">{s.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderMemory({ raw }: { raw: string }) {
  const { rows, usagePercent } = parseMemory(raw);
  if (rows.length === 0) {
    return <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>;
  }
  const ram = rows.find((r) => r.label === "RAM");
  const swap = rows.find((r) => r.label === "Swap");
  return (
    <div className="space-y-3">
      {/* Main RAM bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-300">RAM</span>
          <span className="text-gray-400">{ram?.used || "0"} / {ram?.total || "0"}</span>
        </div>
        <div className="h-3 bg-gray-700/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-500 text-right mt-0.5">{usagePercent}% used · {ram?.available || "0"} available</p>
      </div>
      {/* Breakdown grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Free", value: ram?.free },
          { label: "Shared", value: ram?.shared },
          { label: "Buff/Cache", value: ram?.buffers },
        ].filter((item) => item.value && item.value !== "0").map((item) => (
          <div key={item.label} className="bg-gray-800/50 rounded-lg px-2.5 py-2 text-center">
            <p className="text-[10px] text-gray-500">{item.label}</p>
            <p className="text-xs text-gray-300 font-mono mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>
      {/* Swap */}
      {swap && swap.total !== "0" && (
        <div className="pt-2 border-t border-gray-800">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Swap</span>
            <span className="text-gray-500">{swap.used} / {swap.total}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RenderUptime({ raw }: { raw: string }) {
  // uptime output: "up 14 days, 3 hours, 22 minutes" or similar
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
        <Timer className="h-5 w-5 text-emerald-400" />
      </div>
      <div>
        <p className="text-sm text-white font-medium">{raw.replace(/^\s*\d+:\d+:\d+\s+(up\s*)?/i, "").trim() || raw}</p>
        <p className="text-[10px] text-gray-500 mt-0.5">System uptime</p>
      </div>
    </div>
  );
}

function RenderNetworkSummary({ raw }: { raw: string }) {
  const net = parseNetworkSummary(raw);
  const stats = [
    { label: "TCP Total",     value: net.tcp.total, color: "text-cyan-400" },
    { label: "Established",   value: net.tcp.estab, color: "text-emerald-400" },
    { label: "Time-Wait",     value: net.tcp.timewait, color: "text-amber-400" },
    { label: "Closed",        value: net.tcp.closed, color: "text-gray-400" },
    { label: "UDP",           value: net.udp.total, color: "text-purple-400" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.filter((s) => s.value > 0 || s.label === "TCP Total").map((s) => (
        <div key={s.label} className="bg-gray-800/50 rounded-lg px-2.5 py-2.5 text-center">
          <p className="text-[10px] text-gray-500">{s.label}</p>
          <p className={`text-lg font-semibold ${s.color} mt-0.5`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function RenderDockerVersion({ raw }: { raw: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
        <Container className="h-5 w-5 text-blue-400" />
      </div>
      <div>
        <p className="text-sm text-white font-medium">{raw}</p>
        <p className="text-[10px] text-gray-500 mt-0.5">Docker engine version</p>
      </div>
    </div>
  );
}

/* Visual renderer dispatch */
function InfoVisual({ panelKey, raw }: { panelKey: string; raw: string }) {
  switch (panelKey) {
    case "check-disk":           return <RenderDiskUsage raw={raw} />;
    case "docker-stats":         return <RenderDockerStats raw={raw} />;
    case "check-memory":         return <RenderMemory raw={raw} />;
    case "check-uptime":         return <RenderUptime raw={raw} />;
    case "check-connections":    return <RenderNetworkSummary raw={raw} />;
    case "check-docker-version": return <RenderDockerVersion raw={raw} />;
    default: return <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>;
  }
}

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

interface QuickActionsProps {
  serverId: string;
}

export function QuickActions({ serverId }: QuickActionsProps) {
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const updateResult = useCallback(
    (key: string, result: ActionResult) => {
      setResults((prev) => ({ ...prev, [key]: result }));
    },
    []
  );

  const executeAction = useCallback(
    async (actionKey: string) => {
      updateResult(actionKey, { status: "loading" });

      try {
        const res = await fetch(`/api/servers/${serverId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionKey }),
        });
        const json = await res.json();

        if (json.success) {
          updateResult(actionKey, {
            status: "success",
            message: json.data?.output || "Done",
            timestamp: Date.now(),
          });
        } else {
          updateResult(actionKey, {
            status: "error",
            message: friendlyErrorMessage(json.error || json.data?.output || "Action failed"),
            timestamp: Date.now(),
          });
        }
      } catch {
        updateResult(actionKey, {
          status: "error",
          message: "Network error — could not reach the server.",
          timestamp: Date.now(),
        });
      }
    },
    [serverId, updateResult]
  );

  /* Auto-fetch all info panels on mount */
  useEffect(() => {
    INFO_PANELS.forEach((panel, idx) => {
      setTimeout(() => executeAction(panel.key), idx * 400);
    });
  }, [serverId, executeAction]);

  function handleActionClick(action: ActionDef) {
    if (action.confirmMessage) {
      setConfirming(action.key);
    } else {
      executeAction(action.key);
    }
  }

  function handleConfirm(action: ActionDef) {
    setConfirming(null);
    executeAction(action.key);
  }

  // Group non-info actions by category
  const grouped = NON_INFO_CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    actions: NON_INFO_ACTIONS.filter((a) => a.category === cat),
  }));

  return (
    <div className="space-y-8">
      {/* ─── Info Dashboard ─── */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-4">📊 Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {INFO_PANELS.map((panel) => {
            const result = results[panel.key] || { status: "idle" };
            return (
              <InfoPanel
                key={panel.key}
                panelKey={panel.key}
                label={panel.label}
                icon={panel.icon}
                result={result}
                onRefresh={() => executeAction(panel.key)}
              />
            );
          })}
        </div>
      </div>

      {/* ─── Non-Info Action Cards ─── */}
      {grouped.map((group) => (
        <div key={group.category}>
          <h3 className="text-sm font-medium text-gray-400 mb-3">
            {group.label}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.actions.map((action) => (
              <ActionCard
                key={action.key}
                action={action}
                result={results[action.key] || { status: "idle" }}
                confirming={confirming === action.key}
                onRun={() => handleActionClick(action)}
                onConfirm={() => handleConfirm(action)}
                onCancel={() => setConfirming(null)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Info Panel — auto-loaded, visual rendering
   ══════════════════════════════════════════════════════════ */
function InfoPanel({
  panelKey,
  label,
  icon,
  result,
  onRefresh,
}: {
  panelKey: string;
  label: string;
  icon: React.ReactNode;
  result: ActionResult;
  onRefresh: () => void;
}) {
  const isLoading = result.status === "loading";

  return (
    <div className="bg-gray-900 border border-gray-700/60 rounded-xl p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-gray-300">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-[60px]">
        {(result.status === "idle" || result.status === "loading") && (
          <div className="flex items-center justify-center h-full py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
          </div>
        )}

        {result.status === "success" && result.message && (
          <InfoVisual panelKey={panelKey} raw={result.message} />
        )}

        {result.status === "error" && (
          <div className="text-xs text-red-300/80 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            {result.message}
          </div>
        )}
      </div>

      {/* Timestamp */}
      {result.timestamp && (
        <p className="text-[10px] text-gray-600 mt-2 text-right">
          {new Date(result.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Action Card — for maintenance, cleanup, system
   ══════════════════════════════════════════════════════════ */
function ActionCard({
  action,
  result,
  confirming,
  onRun,
  onConfirm,
  onCancel,
}: {
  action: ActionDef;
  result: ActionResult;
  confirming: boolean;
  onRun: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLoading = result.status === "loading";

  const statusIcon = {
    idle: null,
    loading: <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-400" />,
    success: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />,
    error: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  };

  const borderColor = {
    idle: "border-gray-700",
    loading: "border-brand-500/40",
    success: "border-emerald-500/30",
    error: "border-red-500/30",
  };

  return (
    <div
      className={`bg-gray-900 border ${borderColor[result.status]} rounded-lg p-4 transition-colors`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-gray-300">
          {action.icon}
          <span className="text-sm font-medium">{action.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {statusIcon[result.status]}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 mb-3">{action.description}</p>

      {/* Confirm Dialog (inline) */}
      {confirming && (
        <div className="mb-3 p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-300">{action.confirmMessage}</p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="danger" size="sm" onClick={onConfirm}>
              Yes, proceed
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Result area */}
      {result.status === "success" && result.message && (
        <div className="mb-3">
          <div
            className="text-xs text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5 font-mono leading-relaxed cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            <pre className={`whitespace-pre-wrap break-all ${expanded ? "" : "max-h-20 overflow-hidden"}`}>
              {result.message}
            </pre>
            {!expanded && result.message.length > 150 && (
              <span className="text-emerald-400/60 text-[10px] mt-1 block">Click to expand</span>
            )}
          </div>
          {result.timestamp && (
            <p className="text-[10px] text-gray-600 mt-1">
              {new Date(result.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {result.status === "error" && result.message && (
        <div className="mb-3">
          <div className="text-xs text-red-300/80 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            {result.message}
          </div>
          {result.timestamp && (
            <p className="text-[10px] text-gray-600 mt-1">
              {new Date(result.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* Run button */}
      {!confirming && (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={isLoading}
          loading={isLoading}
          onClick={onRun}
        >
          <Zap className="h-3.5 w-3.5 mr-1" />
          {isLoading ? "Running…" : result.status !== "idle" ? "Run Again" : "Run"}
        </Button>
      )}
    </div>
  );
}
