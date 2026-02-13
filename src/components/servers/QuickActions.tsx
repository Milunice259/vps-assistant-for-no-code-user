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
} from "lucide-react";
import { Button } from "@/components/ui/Button";

/* ── Friendly error mapping ── */
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
  // Truncate very long technical messages
  if (raw.length > 300) {
    return raw.slice(0, 250) + "… (truncated)";
  }
  return raw;
}

/* ── Action result type ── */
interface ActionResult {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  timestamp?: number;
}

/* ── Action definition ── */
interface ActionDef {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: "maintenance" | "cleanup" | "info" | "system";
  confirmMessage?: string;
  autoRun?: boolean; // Actions that run automatically on first load
}

const ACTIONS: ActionDef[] = [
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
    autoRun: true,
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

  // Info
  {
    key: "check-disk",
    label: "Disk Usage",
    description: "Show how much disk space is used on each partition",
    icon: <HardDrive className="h-4 w-4" />,
    category: "info",
    autoRun: true,
  },
  {
    key: "docker-stats",
    label: "Docker Stats",
    description: "Show CPU, memory, and network usage for all containers",
    icon: <Container className="h-4 w-4" />,
    category: "info",
    autoRun: true,
  },
  {
    key: "check-uptime",
    label: "System Uptime",
    description: "Show how long the server has been running",
    icon: <Timer className="h-4 w-4" />,
    category: "info",
    autoRun: true,
  },
  {
    key: "check-memory",
    label: "Memory Details",
    description: "Show detailed memory (RAM) usage breakdown",
    icon: <MemoryStick className="h-4 w-4" />,
    category: "info",
    autoRun: true,
  },
  {
    key: "check-connections",
    label: "Network Summary",
    description: "Show a summary of all active network connections",
    icon: <Network className="h-4 w-4" />,
    category: "info",
  },
  {
    key: "check-docker-version",
    label: "Docker Version",
    description: "Show the installed Docker engine version",
    icon: <Info className="h-4 w-4" />,
    category: "info",
    autoRun: true,
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
  info: "📊 Information",
  system: "⚙️ System",
};

const CATEGORY_ORDER = ["info", "maintenance", "cleanup", "system"];

/* ── localStorage key for auto-run timestamps ── */
function autoRunKey(serverId: string): string {
  return `quickactions-autorun-${serverId}`;
}

function getLastAutoRun(serverId: string): number {
  try {
    const raw = localStorage.getItem(autoRunKey(serverId));
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastAutoRun(serverId: string): void {
  try {
    localStorage.setItem(autoRunKey(serverId), String(Date.now()));
  } catch {
    // Ignore
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/* ── Main component ── */

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
    async (action: ActionDef) => {
      updateResult(action.key, { status: "loading" });

      try {
        const res = await fetch(`/api/servers/${serverId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action.key }),
        });
        const json = await res.json();

        if (json.success) {
          updateResult(action.key, {
            status: "success",
            message: json.data?.output || "Done",
            timestamp: Date.now(),
          });
        } else {
          updateResult(action.key, {
            status: "error",
            message: friendlyErrorMessage(json.error || json.data?.output || "Action failed"),
            timestamp: Date.now(),
          });
        }
      } catch {
        updateResult(action.key, {
          status: "error",
          message: "Network error — could not reach the server.",
          timestamp: Date.now(),
        });
      }
    },
    [serverId, updateResult]
  );

  // Auto-run informational actions once per day
  useEffect(() => {
    const lastRun = getLastAutoRun(serverId);
    const now = Date.now();

    if (now - lastRun < ONE_DAY_MS) return; // Already ran today

    const autoActions = ACTIONS.filter((a) => a.autoRun);
    setLastAutoRun(serverId);

    // Stagger execution to avoid overloading the server
    autoActions.forEach((action, idx) => {
      setTimeout(() => executeAction(action), idx * 800);
    });
  }, [serverId, executeAction]);

  function handleActionClick(action: ActionDef) {
    if (action.confirmMessage) {
      setConfirming(action.key);
    } else {
      executeAction(action);
    }
  }

  function handleConfirm(action: ActionDef) {
    setConfirming(null);
    executeAction(action);
  }

  // Group by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    actions: ACTIONS.filter((a) => a.category === cat),
  }));

  return (
    <div className="space-y-6">
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

/* ── Action Card ── */
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

  // Status indicator color
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
