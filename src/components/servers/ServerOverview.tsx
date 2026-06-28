"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  HardDrive,
  Container,
  Timer,
  Network,
  MemoryStick,
  Info,
  Loader2,
  AlertCircle,
  Cpu,
  Globe,
  Server,
  ShieldCheck,
  Wrench,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CpuGauge } from "@/components/dashboard/CpuGauge";
import { MemoryBar } from "@/components/dashboard/MemoryBar";
import { DiskUsage } from "@/components/dashboard/DiskUsage";
import type { SystemStats } from "@/types";


function buildHealthChecks(stats: SystemStats) {
  return [
    { label: "CPU load", ok: stats.cpu.usagePercent < 80, value: `${stats.cpu.usagePercent.toFixed(0)}%`, help: "Under 80% is comfortable for most small VPS workloads." },
    { label: "Memory pressure", ok: stats.memory.usagePercent < 85, value: `${stats.memory.usagePercent.toFixed(0)}%`, help: "High memory can make apps slow or crash. Restarting unused apps may help." },
    { label: "Disk space", ok: stats.disk.usagePercent < 85, value: `${stats.disk.usagePercent.toFixed(0)}%`, help: "Keep free disk space for logs, databases, uploads, and deployments." },
    { label: "Uptime", ok: Number(stats.uptime) > 600, value: typeof stats.uptime === "number" ? "Stable" : String(stats.uptime), help: "Very recent restarts are normal after maintenance but worth noticing." },
  ];
}

function ControlCenterSummary({ stats }: { stats: SystemStats }) {
  const checks = buildHealthChecks(stats);
  const issues = checks.filter((check) => !check.ok);
  const label = issues.length === 0 ? "Healthy" : issues.length === 1 ? "Needs attention" : "Action recommended";
  const accent = issues.length === 0 ? "from-emerald-500/20 to-brand-500/10 border-emerald-500/25" : "from-yellow-500/20 to-orange-500/10 border-yellow-500/25";

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${accent} p-5`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
            <ShieldCheck className={issues.length ? "h-6 w-6 text-yellow-300" : "h-6 w-6 text-emerald-300"} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Server Control Center</p>
            <h3 className="mt-1 text-2xl font-semibold text-white">{label}</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              {issues.length ? "Review the alerts below, then run only the guided action you need." : "No urgent resource issue detected. Keep monitoring apps, services, and backups."}
            </p>
          </div>
        </div>
        <span className={issues.length ? "rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200" : "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200"}>
          {issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""} found` : "No urgent issue"}
        </span>
      </div>
    </div>
  );
}

function PerServerAlerts({ stats, onOpenActions }: { stats: SystemStats; onOpenActions?: () => void }) {
  const issues = buildHealthChecks(stats).filter((check) => !check.ok);

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className={issues.length ? "h-4 w-4 text-yellow-300" : "h-4 w-4 text-emerald-300"} />
          <h3 className="text-sm font-semibold text-white">Alerts for this server</h3>
        </div>
        <span className="text-xs text-gray-500">{issues.length ? `${issues.length} active` : "Clear"}</span>
      </div>
      {issues.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {issues.map((issue) => (
            <div key={issue.label} className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-yellow-100">{issue.label}</p>
                <span className="text-xs text-yellow-300">{issue.value}</span>
              </div>
              <p className="mt-1 text-xs text-yellow-100/70">{issue.help}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No CPU, memory, disk, or uptime alert for this server right now.</p>
      )}
      {issues.length > 0 && onOpenActions && (
        <Button className="mt-4" variant="secondary" size="sm" onClick={onOpenActions}>
          <Wrench className="mr-1.5 h-4 w-4" /> Open guided actions
        </Button>
      )}
    </div>
  );
}

function GuidedNextSteps({ stats, onOpenActions, onOpenLogs }: { stats: SystemStats; onOpenActions?: () => void; onOpenLogs?: () => void }) {
  const steps = [
    stats.disk.usagePercent >= 75 ? { title: "Disk is high", body: "Start with Disk Usage, then use Safe Cleanup only after checking backups.", action: onOpenActions } : null,
    stats.memory.usagePercent >= 80 ? { title: "Memory pressure", body: "Inspect Docker Stats before restarting apps or services.", action: onOpenActions } : null,
    stats.cpu.usagePercent >= 75 ? { title: "CPU load", body: "Check Docker Stats and recent Activity Log to find the busy app.", action: onOpenLogs } : null,
  ].filter(Boolean) as Array<{ title: string; body: string; action?: () => void }>;
  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-brand-300" />
        <h3 className="text-sm font-semibold text-white">Guided next steps</h3>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {steps.map((step) => (
          <button key={step.title} onClick={step.action} className="rounded-lg border border-gray-700/60 bg-gray-950/40 p-3 text-left hover:border-brand-500/40">
            <p className="text-sm font-medium text-white">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">{step.body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}


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
  if (
    raw.includes("Connection refused") ||
    raw.includes("connect ECONNREFUSED")
  ) {
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

/* ══════════════════════════════════════════════════════════
   Info panel definitions
   ══════════════════════════════════════════════════════════ */
const INFO_PANELS = [
  {
    key: "check-disk",
    label: "Disk Usage",
    icon: <HardDrive className="h-4 w-4" />,
  },
  {
    key: "check-memory",
    label: "Memory Details",
    icon: <MemoryStick className="h-4 w-4" />,
  },
  {
    key: "docker-stats",
    label: "Docker Stats",
    icon: <Container className="h-4 w-4" />,
  },
  {
    key: "check-uptime",
    label: "System Uptime",
    icon: <Timer className="h-4 w-4" />,
  },
  {
    key: "check-connections",
    label: "Network Summary",
    icon: <Network className="h-4 w-4" />,
  },
  {
    key: "check-docker-version",
    label: "Docker Version",
    icon: <Info className="h-4 w-4" />,
  },
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
  return lines
    .slice(1)
    .map((line) => {
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
    })
    .filter(
      (p) =>
        !p.filesystem.startsWith("tmpfs") &&
        !p.filesystem.startsWith("shm") &&
        !p.filesystem.startsWith("overlay") &&
        p.size !== "0",
    );
}

interface DockerStat {
  name: string;
  cpu: string;
  mem: string;
  net: string;
}

function parseDockerStats(raw: string): DockerStat[] {
  const lines = raw.split("\n").filter(Boolean);
  const startIdx = lines[0]?.includes("NAME") ? 1 : 0;
  return lines
    .slice(startIdx)
    .map((line) => {
      const parts = line.trim().split(/\s{2,}|\t+/);
      return {
        name: parts[0] || "",
        cpu: parts[1] || "0%",
        mem: parts[2] || "0B / 0B",
        net: parts[3] || "0B / 0B",
      };
    })
    .filter((s) => s.name);
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
      const usedVal = parseFloat(parts[1] || "0");
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
    return (
      <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>
    );
  }
  return (
    <div className="space-y-3">
      {partitions.map((p, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span
              className="text-gray-300 font-mono truncate max-w-[180px]"
              title={p.filesystem}
            >
              {p.mount}
            </span>
            <span className="text-gray-400">
              {p.used} / {p.size}
            </span>
          </div>
          <div className="h-2.5 bg-gray-700/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                p.usePercent > 90
                  ? "bg-red-500"
                  : p.usePercent > 70
                    ? "bg-amber-500"
                    : "bg-brand-500"
              }`}
              style={{ width: `${Math.min(p.usePercent, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500 text-right">
            {p.usePercent}% used · {p.avail} free
          </p>
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
              <td
                className="py-1.5 text-gray-300 font-mono truncate max-w-[140px]"
                title={s.name}
              >
                {s.name}
              </td>
              <td className="py-1.5 text-right text-cyan-400 font-mono">
                {s.cpu}
              </td>
              <td className="py-1.5 text-right text-purple-400 font-mono text-[11px]">
                {s.mem}
              </td>
              <td className="py-1.5 text-right text-gray-400 font-mono text-[11px]">
                {s.net}
              </td>
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
    return (
      <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>
    );
  }
  const ram = rows.find((r) => r.label === "RAM");
  const swap = rows.find((r) => r.label === "Swap");
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-300">RAM</span>
          <span className="text-gray-400">
            {ram?.used || "0"} / {ram?.total || "0"}
          </span>
        </div>
        <div className="h-3 bg-gray-700/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              usagePercent > 90
                ? "bg-red-500"
                : usagePercent > 70
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-500 text-right mt-0.5">
          {usagePercent}% used · {ram?.available || "0"} available
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Free", value: ram?.free },
          { label: "Shared", value: ram?.shared },
          { label: "Buff/Cache", value: ram?.buffers },
        ]
          .filter((item) => item.value && item.value !== "0")
          .map((item) => (
            <div
              key={item.label}
              className="bg-gray-800/50 rounded-lg px-2.5 py-2 text-center"
            >
              <p className="text-[10px] text-gray-500">{item.label}</p>
              <p className="text-xs text-gray-300 font-mono mt-0.5">
                {item.value}
              </p>
            </div>
          ))}
      </div>
      {swap && swap.total !== "0" && (
        <div className="pt-2 border-t border-gray-800">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Swap</span>
            <span className="text-gray-500">
              {swap.used} / {swap.total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RenderUptime({ raw }: { raw: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
        <Timer className="h-5 w-5 text-emerald-400" />
      </div>
      <div>
        <p className="text-sm text-white font-medium">
          {raw.replace(/^\s*\d+:\d+:\d+\s+(up\s*)?/i, "").trim() || raw}
        </p>
        <p className="text-[10px] text-gray-500 mt-0.5">System uptime</p>
      </div>
    </div>
  );
}

function RenderNetworkSummary({ raw }: { raw: string }) {
  const net = parseNetworkSummary(raw);
  const stats = [
    { label: "TCP Total", value: net.tcp.total, color: "text-cyan-400" },
    { label: "Established", value: net.tcp.estab, color: "text-emerald-400" },
    { label: "Time-Wait", value: net.tcp.timewait, color: "text-amber-400" },
    { label: "Closed", value: net.tcp.closed, color: "text-gray-400" },
    { label: "UDP", value: net.udp.total, color: "text-purple-400" },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {stats
        .filter((s) => s.value > 0 || s.label === "TCP Total")
        .map((s) => (
          <div
            key={s.label}
            className="bg-gray-800/50 rounded-lg px-2.5 py-2.5 text-center"
          >
            <p className="text-[10px] text-gray-500">{s.label}</p>
            <p className={`text-lg font-semibold ${s.color} mt-0.5`}>
              {s.value}
            </p>
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
        <p className="text-[10px] text-gray-500 mt-0.5">
          Docker engine version
        </p>
      </div>
    </div>
  );
}

function InfoVisual({ panelKey, raw }: { panelKey: string; raw: string }) {
  switch (panelKey) {
    case "check-disk":
      return <RenderDiskUsage raw={raw} />;
    case "docker-stats":
      return <RenderDockerStats raw={raw} />;
    case "check-memory":
      return <RenderMemory raw={raw} />;
    case "check-uptime":
      return <RenderUptime raw={raw} />;
    case "check-connections":
      return <RenderNetworkSummary raw={raw} />;
    case "check-docker-version":
      return <RenderDockerVersion raw={raw} />;
    default:
      return (
        <pre className="text-xs text-gray-400 whitespace-pre-wrap">{raw}</pre>
      );
  }
}

/* ══════════════════════════════════════════════════════════
   Info Panel Card
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
    <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 flex flex-col backdrop-blur-sm">
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
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
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
   Server Quick Stat Card
   ══════════════════════════════════════════════════════════ */
function QuickStatCard({
  icon,
  label,
  value,
  sub,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accentColor: string;
}) {
  return (
    <div className="relative overflow-hidden bg-gray-800/60 rounded-xl px-4 py-3.5 border border-gray-700/40 group hover:border-gray-600/60 transition-colors">
      <div
        className={`absolute top-0 left-0 w-1 h-full rounded-r-full ${accentColor}`}
      />
      <div className="flex items-center gap-3 ml-1">
        <div className="w-9 h-9 rounded-lg bg-gray-700/40 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">
            {label}
          </p>
          <p
            className="text-sm text-white font-semibold truncate"
            title={value}
          >
            {value}
          </p>
          {sub && <p className="text-[10px] text-gray-500 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main component — ServerOverview
   ══════════════════════════════════════════════════════════ */

interface ServerOverviewProps {
  serverId: string;
  onOpenActions?: () => void;
  onOpenLogs?: () => void;
}

export function ServerOverview({ serverId, onOpenActions, onOpenLogs }: ServerOverviewProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [infoResults, setInfoResults] = useState<Record<string, ActionResult>>(
    {},
  );

  /* ─── Fetch system stats (CPU/Memory/Disk) ─── */
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/stats`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load stats");
      setStats(json.data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStatsLoading(false);
    }
  }, [serverId]);

  /* ─── Fetch a single info panel ─── */
  const fetchInfoPanel = useCallback(
    async (actionKey: string) => {
      setInfoResults((prev) => ({
        ...prev,
        [actionKey]: { status: "loading" },
      }));

      try {
        const res = await fetch(`/api/servers/${serverId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionKey }),
        });
        const json = await res.json();

        if (json.success) {
          setInfoResults((prev) => ({
            ...prev,
            [actionKey]: {
              status: "success",
              message: json.data?.output || "Done",
              timestamp: Date.now(),
            },
          }));
        } else {
          setInfoResults((prev) => ({
            ...prev,
            [actionKey]: {
              status: "error",
              message: friendlyErrorMessage(
                json.error || json.data?.output || "Action failed",
              ),
              timestamp: Date.now(),
            },
          }));
        }
      } catch {
        setInfoResults((prev) => ({
          ...prev,
          [actionKey]: {
            status: "error",
            message: "Network error — could not reach the server.",
            timestamp: Date.now(),
          },
        }));
      }
    },
    [serverId],
  );

  /* ─── Auto-fetch on mount ─── */
  useEffect(() => {
    fetchStats();
    INFO_PANELS.forEach((panel, idx) => {
      setTimeout(() => fetchInfoPanel(panel.key), idx * 400);
    });
  }, [serverId, fetchStats, fetchInfoPanel]);

  /* ─── Refresh all ─── */
  const refreshAll = useCallback(() => {
    fetchStats();
    INFO_PANELS.forEach((panel, idx) => {
      setTimeout(() => fetchInfoPanel(panel.key), idx * 200);
    });
  }, [fetchStats, fetchInfoPanel]);

  /* ─── Format uptime ─── */
  function formatUptime(uptime: number | string): string {
    if (typeof uptime === "string") return uptime;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════
         Section 1: System Stats Header
         ═══════════════════════════════════════════════════════ */}
      {statsLoading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {statsError && (
        <div className="flex flex-col items-center gap-3 py-8">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-red-400">{statsError}</p>
          <Button variant="secondary" size="sm" onClick={fetchStats}>
            Retry
          </Button>
        </div>
      )}

      {stats && !statsLoading && (
        <>
          <ControlCenterSummary stats={stats} />
          <PerServerAlerts stats={stats} onOpenActions={onOpenActions} />
          <GuidedNextSteps stats={stats} onOpenActions={onOpenActions} onOpenLogs={onOpenLogs} />

          {/* Server Identity & Quick Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/30 flex items-center justify-center">
                <Server className="h-5 w-5 text-brand-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {stats.hostname}
                </h3>
                <p className="text-xs text-gray-500">
                  {stats.platform} · Uptime: {formatUptime(stats.uptime)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh All
            </Button>
          </div>

          {/* Server Quick Stats */}
          <div className="grid gap-3 sm:grid-cols-2">
            <QuickStatCard
              icon={<Globe className="h-4 w-4 text-blue-400" />}
              label="Operating System"
              value={stats.os?.distro || stats.platform}
              sub={stats.os?.kernel ? `Kernel ${stats.os.kernel}` : undefined}
              accentColor="bg-blue-500"
            />
            <QuickStatCard
              icon={<Cpu className="h-4 w-4 text-cyan-400" />}
              label="Processor"
              value={stats.cpu.model || `${stats.cpu.cores || '—'} Cores`}
              sub={stats.cpu.model && stats.cpu.cores ? `${stats.cpu.cores} Cores` : undefined}
              accentColor="bg-cyan-500"
            />
          </div>

          {/* Resource Gauges */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex justify-center rounded-xl bg-gray-800/60 border border-gray-700/40 p-5 backdrop-blur-sm">
              <CpuGauge percentage={stats.cpu.usagePercent} />
            </div>
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 p-5 backdrop-blur-sm flex flex-col justify-center">
              <MemoryBar
                total={stats.memory.total}
                used={stats.memory.used}
                available={stats.memory.available}
              />
            </div>
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 p-5 backdrop-blur-sm flex flex-col justify-center">
              <DiskUsage
                total={stats.disk.total}
                used={stats.disk.used}
                available={stats.disk.available}
              />
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
         Section 2: Detailed Info Panels
         ═══════════════════════════════════════════════════════ */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
          <span className="inline-block w-1 h-4 rounded-full bg-brand-500" />
          Detailed Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {INFO_PANELS.map((panel) => {
            const result = infoResults[panel.key] || {
              status: "idle" as const,
            };
            return (
              <InfoPanel
                key={panel.key}
                panelKey={panel.key}
                label={panel.label}
                icon={panel.icon}
                result={result}
                onRefresh={() => fetchInfoPanel(panel.key)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

