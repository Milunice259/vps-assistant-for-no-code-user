"use client";

import { useState, useCallback } from "react";
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
  status: "idle" | "loading" | "success" | "error";
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
    description: "Remove unused images, containers, and volumes to free space",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
    confirmMessage: "This will remove all unused Docker resources. Running containers are not affected. Continue?",
    risk: "danger",
  },
  {
    key: "clear-apt-cache",
    label: "Clear Package Cache",
    description: "Remove cached package files to free disk space",
    icon: <Trash2 className="h-4 w-4" />,
    category: "cleanup",
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
}

export function QuickActions({ serverId }: QuickActionsProps) {
  const { safeMode, setSafeMode } = useSafeMode();
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const updateResult = useCallback(
    (key: string, result: ActionResult) => {
      setResults((prev) => ({ ...prev, [key]: result }));
    },
    []
  );

  const executeAction = useCallback(
    async (actionKey: string, param?: string) => {
      updateResult(actionKey, { status: "loading" });

      try {
        if (["os-update", "docker-prune", "restart-docker", "restart-server"].includes(actionKey)) {
          await fetch("/api/backup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: `pre-${actionKey}`, serverId }),
          });
        }
        const body: Record<string, string> = { action: actionKey };
        if (param) body.param = param;

        const res = await fetch(`/api/servers/${serverId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

  function handleActionClick(action: ActionDef) {
    // If action needs input, show input prompt first
    if (action.promptInput) {
      setConfirming(action.key);
      return;
    }
    if (action.confirmMessage) {
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
              {safeMode ? "Dangerous actions are hidden. Turn off only when you know exactly what will change." : "Advanced actions are visible. Large actions create a database snapshot first."}
            </p>
          </div>
          <Button variant={safeMode ? "secondary" : "danger"} size="sm" onClick={() => setSafeMode(!safeMode)}>
            {safeMode ? "Show advanced actions" : "Return to Safe Mode"}
          </Button>
        </div>
      </div>
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
  confirming,
  inputValue,
  onInputChange,
  onRun,
  onConfirm,
  onCancel,
}: {
  action: ActionDef;
  result: ActionResult;
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
