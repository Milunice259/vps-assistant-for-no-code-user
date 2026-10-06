"use client";

import { useState, useCallback, useRef } from "react";
import {
  Zap,
  RefreshCw,
  Trash2,
  Shield,
  Server,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  Download,
  BarChart3,
  Network,
  ShieldOff,
  ShieldBan,
  ShieldCheck,
  FileX,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { OperationResult } from "@/lib/operation-result";
import { useSafeMode } from "@/contexts/SafeModeContext";

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
  status: "idle" | "loading" | "success" | "error" | "warning";
  message?: string;
  timestamp?: number;
}

interface ActionDef {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: "maintenance" | "update" | "diagnostics" | "cleanup" | "security" | "system";
  confirmMessage?: string;
  risk?: "safe" | "caution" | "danger";
  /** If set, shows an input prompt before executing. */
  promptInput?: {
    label: string;
    placeholder: string;
  };
}

/* ══════════════════════════════════════════════════════════
   Action definitions
   ══════════════════════════════════════════════════════════ */
const ACTIONS: ActionDef[] = [
  // ── Maintenance ──
  {
    key: "system-health-check",
    label: "System Health Check",
    description: "Check disk, memory, CPU load, failed services, and pending updates",
    icon: <Activity className="h-4 w-4" />,
    category: "maintenance",
  },
  {
    key: "security-check",
    label: "Security Check",
    description: "Audit firewall, fail2ban status, and recent SSH login activity",
    icon: <Shield className="h-4 w-4" />,
    category: "maintenance",
  },
  {
    key: "os-version-check",
    label: "OS Version Check",
    description: "Check current OS version, kernel, and available distribution upgrades",
    icon: <HardDrive className="h-4 w-4" />,
    category: "maintenance",
  },
  {
    key: "sync-time",
    risk: "danger",
    label: "Sync Time",
    description: "Synchronize system clock with NTP servers",
    icon: <Clock className="h-4 w-4" />,
    category: "maintenance",
  },

  // ── Update ──
  {
    key: "os-update",
    label: "OS Update",
    description: "Update and upgrade all system packages to the latest versions",
    icon: <Download className="h-4 w-4" />,
    category: "update",
    confirmMessage: "This will update all system packages. It may take a few minutes and use bandwidth. Continue?",
    risk: "danger",
  },

  // ── Diagnostics ──
  {
    key: "docker-stats",
    label: "Docker Stats",
    description: "Show CPU, memory, and network usage for each running container",
    icon: <BarChart3 className="h-4 w-4" />,
    category: "diagnostics",
  },
  {
    key: "connection-stats",
    label: "Connection Stats",
    description: "Show active TCP connections and all listening ports",
    icon: <Network className="h-4 w-4" />,
    category: "diagnostics",
  },

  // ── Cleanup ──
  {
    key: "docker-prune",
    label: "Docker Prune",
    description: "Remove unused containers, networks, images and build cache. Rollback images may be lost.",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
    confirmMessage: "This advanced action can delete unused images needed for rollback and stopped containers. It is not guided safe cleanup. Continue?",
    risk: "danger",
  },
  {
    key: "clear-logs",
    label: "Clear Old Logs",
    description: "Remove system logs older than 3 days",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
    risk: "danger",
  },
  {
    key: "clear-temp",
    label: "Clear Temp Files",
    description: "Remove all temporary files from /tmp and /var/tmp",
    icon: <FileX className="h-4 w-4" />,
    category: "cleanup",
    risk: "danger",
  },
  {
    key: "remove-old-kernels",
    label: "Remove Old Kernels",
    description: "Uninstall unused kernel versions and orphan packages",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
    confirmMessage: "This will remove old kernel versions and orphan packages. Continue?",
    risk: "danger",
  },

  // ── Security ──
  {
    key: "firewall-reload",
    label: "Reload Firewall",
    description: "Reload firewall rules (ufw or iptables)",
    icon: <ShieldCheck className="h-4 w-4" />,
    category: "security",
    risk: "danger",
  },
  {
    key: "ban-ip",
    label: "Ban IP Address",
    description: "Block an IP address via fail2ban or ufw",
    icon: <ShieldBan className="h-4 w-4" />,
    category: "security",
    confirmMessage: "This will block the specified IP from accessing your server. Continue?",
    risk: "danger",
    promptInput: {
      label: "IP address to ban",
      placeholder: "e.g. 192.168.1.100",
    },
  },
  {
    key: "unban-ip",
    label: "Unban IP Address",
    description: "Remove a specific IP from the ban list",
    icon: <ShieldOff className="h-4 w-4" />,
    category: "security",
    risk: "danger",
    promptInput: {
      label: "IP address to unban",
      placeholder: "e.g. 192.168.1.100",
    },
  },
  {
    key: "unban-all",
    label: "Unban All IPs",
    description: "Remove all IP bans from fail2ban",
    icon: <ShieldOff className="h-4 w-4" />,
    category: "security",
    confirmMessage: "This will unban ALL blocked IP addresses. Are you sure?",
    risk: "danger",
  },

  // ── System ──
  {
    key: "restart-docker",
    label: "Restart Docker",
    description: "Restart the Docker daemon (briefly interrupts all containers)",
    icon: <RefreshCw className="h-4 w-4" />,
    category: "system",
    confirmMessage: "Restarting Docker will briefly interrupt all running containers. Continue?",
    risk: "danger",
  },
  {
    key: "restart-server",
    label: "Restart Server",
    description: "Reboot the entire server (all services will restart)",
    icon: <Server className="h-4 w-4" />,
    category: "system",
    confirmMessage: "This will reboot the server. All services will be temporarily unavailable. Are you sure?",
    risk: "danger",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: "🔍 Diagnostics & Checks",
  update: "📥 Update",
  diagnostics: "📊 Live Monitoring",
  cleanup: "🧹 Cleanup",
  security: "🛡️ Security",
  system: "⚙️ System",
};

const CATEGORY_ORDER = ["maintenance", "update", "diagnostics", "cleanup", "security", "system"];

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

interface QuickActionsProps {
  serverId: string;
  serverName?: string;
}

export function QuickActions({ serverId, serverName }: QuickActionsProps) {
  const targetName = serverId === "local" ? "Local server" : serverName || serverId;
  const { safeMode, setSafeMode } = useSafeMode();
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [diskPreview, setDiskPreview] = useState<string | null>(null);
  const [diskResult, setDiskResult] = useState<(OperationResult & { evidence?: { target: string; commandCompleted: boolean; before?: string; after?: string } }) | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [diskBusy, setDiskBusy] = useState<string | null>(null);

  async function runDisk(action: "check-disk" | "clear-apt-cache") {
    if (busy.current || (action === "clear-apt-cache" && (safeMode || !diskPreview))) return;
    busy.current = true;
    setRunning(true);
    setDiskBusy(action);
    setConfirmCleanup(false);
    setDiskResult(null);
    setDiskPreview(null); // Every mutation consumes its preview; never offer a blind retry.
    let submitted = false;
    try {
      if (!navigator.onLine) { setDiskResult({ message: "You are offline. No command submitted.", risk: "safe", verified: false, outcome: "failed" }); return; }
      submitted = true;
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, safeModeOff: !safeMode }),
      });
      const json = await response.json();
      if (json.data) setDiskResult(json.data);
      else setDiskResult({ message: json.error || "Outcome unknown. Check disk before another cleanup.", risk: "danger", verified: false, outcome: response.status >= 500 ? "unverified" : "failed" });
      if (action === "check-disk" && response.ok && json.success && json.data?.verified && json.data?.evidence?.before) setDiskPreview(json.data.evidence.before);
    } catch {
      setDiskResult({ message: action === "clear-apt-cache" && submitted ? "Outcome unknown — connection lost after submission. Cleanup may have run. Check disk; do not blindly retry." : "Disk check unavailable. No cleanup submitted.", risk: "danger", verified: false, outcome: "unverified" });
    } finally { busy.current = false; setRunning(false); setDiskBusy(null); }
  }

  const updateResult = useCallback(
    (key: string, result: ActionResult) => {
      setResults((prev) => ({ ...prev, [key]: result }));
    },
    []
  );

  const executeAction = useCallback(
    async (actionKey: string, param?: string) => {
      if (busy.current) return;
      busy.current = true;
      setRunning(true);
      updateResult(actionKey, { status: "loading" });

      try {
        const body: Record<string, string | boolean> = { action: actionKey, safeModeOff: !safeMode };
        if (param) body.param = param;

        const res = await fetch(`/api/servers/${serverId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();

        if (json.success) {
          updateResult(actionKey, {
            status: json.data?.verified === true ? "success" : "warning",
            message: [json.data?.message, json.data?.output].filter(Boolean).join("\n") || "Command response received; outcome unverified",
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
          message: "Outcome unknown — connection lost. Check server state before any new action; do not blindly retry.",
          timestamp: Date.now(),
        });
      } finally { busy.current = false; setRunning(false); }
    },
    [safeMode, serverId, updateResult]
  );

  function handleActionClick(action: ActionDef) {
    // If action needs input, show input prompt first
    if (action.promptInput) {
      setConfirming(action.key);
      return;
    }
    if (action.confirmMessage || action.risk === "danger") {
      setConfirming(action.key);
    } else {
      executeAction(action.key);
    }
  }

  function handleConfirm(action: ActionDef) {
    const param = action.promptInput ? inputValues[action.key]?.trim() : undefined;
    // Validate IP if needed
    if (action.promptInput && (!param || !/^[\d.:a-fA-F]+$/.test(param))) {
      return; // Don't proceed without valid input
    }
    setConfirming(null);
    executeAction(action.key, param);
  }

  // Group actions by category
  const visibleActions = ACTIONS.map((action) => ({
    ...action,
    risk: action.risk ?? (action.confirmMessage ? "danger" : "safe"),
  })).filter((action) => !safeMode || action.risk !== "danger");

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    actions: visibleActions.filter((a) => a.category === cat),
  })).filter((g) => g.actions.length > 0);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Safe Mode</h3>
            <p className="text-xs text-gray-400">
              {safeMode ? "Dangerous actions are hidden. Turn off only when you know exactly what will change." : "Advanced actions are visible. Panel backups do not protect server files or containers."}
            </p>
          </div>
          <Button variant={safeMode ? "secondary" : "danger"} size="sm" onClick={() => setSafeMode(!safeMode)}>
            {safeMode ? "Show advanced actions" : "Return to Safe Mode"}
          </Button>
        </div>
      </div>
      <section aria-label="Guided disk cleanup" className="space-y-3 border-b border-gray-700 pb-6">
        <h3 className="text-sm font-semibold text-white">Guided disk cleanup · {targetName}</h3>
        <p className="text-xs text-gray-400">Check disk first. Only downloaded package files in /var/cache/apt/archives can be cleared; packages stay installed.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={running} loading={diskBusy === "check-disk"} onClick={() => runDisk("check-disk")}>Check disk</Button>
          <Button size="sm" variant="primary" disabled={running || safeMode || !diskPreview} loading={diskBusy === "clear-apt-cache"} onClick={() => setConfirmCleanup(true)}>Clear package cache</Button>
        </div>
        {safeMode && <p className="text-xs text-amber-300">Safe Mode allows checks only. Turn it off in the header to clear the package cache.</p>}
        {diskPreview && <p className="text-xs text-gray-400">Preview: downloaded package cache only. Databases, apps, uploads, Docker volumes, images, backups and active assets are not targeted. No rollback: packages may need downloading again.</p>}
        {diskResult && <div role="status" className={`space-y-2 text-sm ${diskResult.outcome === "failed" ? "text-red-300" : diskResult.verified ? "text-emerald-300" : "text-amber-300"}`}>
          <p>{diskResult.message}</p>
          {diskResult.evidence?.before && <details><summary className="cursor-pointer text-xs">{diskResult.evidence.after ? "Before / after disk evidence" : "Disk evidence"}</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{diskResult.evidence.before}{diskResult.evidence.after ? `\n\nAfter:\n${diskResult.evidence.after}` : ""}</pre></details>}
        </div>}
        <ConfirmDialog open={confirmCleanup} title={`Clear package cache · ${targetName}`} message="Remove downloaded package files from /var/cache/apt/archives only. Installed packages and application data are kept. This does not delete logs, temporary files, Docker resources, backups or rollback images. Downloads may be needed again; no rollback is offered." confirmLabel="Clear package cache once" variant="danger" onConfirm={() => runDisk("clear-apt-cache")} onCancel={() => setConfirmCleanup(false)} />
      </section>
      {!safeMode && <p className="text-xs text-amber-300">Advanced operations below are not guided cleanup. Review each impact separately.</p>}
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
                disabled={running}
                confirming={confirming === action.key}
                inputValue={inputValues[action.key] || ""}
                onInputChange={(v) => setInputValues((prev) => ({ ...prev, [action.key]: v }))}
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
   Action Card
   ══════════════════════════════════════════════════════════ */
function ActionCard({
  action,
  result,
  disabled,
  confirming,
  inputValue,
  onInputChange,
  onRun,
  onConfirm,
  onCancel,
}: {
  action: ActionDef;
  result: ActionResult;
  disabled: boolean;
  confirming: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
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
    warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
  };

  const borderColor = {
    idle: "border-gray-700",
    loading: "border-brand-500/40",
    success: "border-emerald-500/30",
    error: "border-red-500/30",
    warning: "border-amber-500/30",
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

      {/* Confirm / Input Dialog (inline) */}
      {confirming && (
        <div className="mb-3 p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          {/* Input prompt */}
          {action.promptInput && (
            <div className="mb-2">
              <label className="text-xs text-gray-300 font-medium block mb-1">
                {action.promptInput.label}
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={action.promptInput.placeholder}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConfirm();
                  if (e.key === "Escape") onCancel();
                }}
                //                autoFocus
              />
            </div>
          )}
          {/* Confirm message */}
          {action.confirmMessage && (
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-yellow-300">{action.confirmMessage}</p>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <Button variant="danger" size="sm" disabled={disabled} onClick={onConfirm}>
              Yes, proceed
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Result area */}
      {(result.status === "success" || result.status === "warning") && result.message && (
        <div className="mb-3">
          <div
            className={`text-xs ${result.status === "warning" ? "text-amber-300 border-amber-500/20" : "text-emerald-300 border-emerald-500/20"} border rounded-lg p-2.5 font-mono leading-relaxed cursor-pointer`}
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
          disabled={disabled || isLoading}
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
