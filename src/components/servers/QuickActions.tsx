"use client";

import { useState, useCallback } from "react";
import {
  Download,
  Trash2,
  RotateCw,
  WifiOff,
  Terminal,
  HardDrive,
  ScrollText,
  Shield,
  BarChart3,
  Clock,
  Power,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface QuickActionsProps {
  serverId: string;
}

interface ActionConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  confirmTitle: string;
  confirmMessage: string;
  variant: "primary" | "secondary" | "danger";
  category: "maintenance" | "cleanup" | "info" | "system";
}

const ACTIONS: ActionConfig[] = [
  // ── Maintenance ──
  {
    key: "system-update",
    label: "System Update",
    description: "Update and upgrade all system packages",
    icon: <Download className="h-5 w-5" />,
    confirmTitle: "System Update",
    confirmMessage:
      "This will run 'apt update && apt upgrade -y' to update all system packages. This may take several minutes.",
    variant: "primary",
    category: "maintenance",
  },
  {
    key: "security-updates",
    label: "Check Updates",
    description: "List available package upgrades",
    icon: <Shield className="h-5 w-5" />,
    confirmTitle: "Check Available Updates",
    confirmMessage:
      "This will refresh the package list and show which packages have updates available. No changes will be made.",
    variant: "secondary",
    category: "maintenance",
  },
  {
    key: "sync-time",
    label: "Sync Clock",
    description: "Synchronize system clock with NTP servers",
    icon: <Clock className="h-5 w-5" />,
    confirmTitle: "Sync System Clock",
    confirmMessage:
      "This will enable NTP and synchronize the system clock. This is safe and usually instant.",
    variant: "secondary",
    category: "maintenance",
  },

  // ── Cleanup ──
  {
    key: "docker-prune",
    label: "Docker Cleanup",
    description: "Remove unused images, containers, and volumes",
    icon: <Trash2 className="h-5 w-5" />,
    confirmTitle: "Clean Docker System",
    confirmMessage:
      "This will run 'docker system prune -af' and remove all unused Docker images, containers, networks, and volumes. This action cannot be undone.",
    variant: "danger",
    category: "cleanup",
  },
  {
    key: "clear-apt-cache",
    label: "Clear APT Cache",
    description: "Remove downloaded package cache files",
    icon: <Sparkles className="h-5 w-5" />,
    confirmTitle: "Clear APT Cache",
    confirmMessage:
      "This will run 'apt clean && apt autoclean' to remove cached package files. This is safe and frees disk space.",
    variant: "secondary",
    category: "cleanup",
  },
  {
    key: "clear-logs",
    label: "Clear Old Logs",
    description: "Remove system logs older than 3 days",
    icon: <ScrollText className="h-5 w-5" />,
    confirmTitle: "Clear Old Logs",
    confirmMessage:
      "This will run 'journalctl --vacuum-time=3d' to remove system logs older than 3 days. Recent logs will be kept.",
    variant: "secondary",
    category: "cleanup",
  },

  // ── Info ──
  {
    key: "check-disk",
    label: "Disk Usage",
    description: "Show disk space usage for all filesystems",
    icon: <HardDrive className="h-5 w-5" />,
    confirmTitle: "Check Disk Usage",
    confirmMessage: "This will display disk space usage. No changes will be made.",
    variant: "secondary",
    category: "info",
  },
  {
    key: "docker-stats",
    label: "Docker Stats",
    description: "Show CPU and memory usage per container",
    icon: <BarChart3 className="h-5 w-5" />,
    confirmTitle: "Docker Container Stats",
    confirmMessage:
      "This will show a snapshot of CPU, memory, and network usage for each running container.",
    variant: "secondary",
    category: "info",
  },

  // ── System ──
  {
    key: "restart-docker",
    label: "Restart Docker",
    description: "Restart the Docker daemon service",
    icon: <RotateCw className="h-5 w-5" />,
    confirmTitle: "Restart Docker Service",
    confirmMessage:
      "This will restart the Docker daemon. Running containers will be briefly interrupted while the service restarts.",
    variant: "secondary",
    category: "system",
  },
  {
    key: "restart-server",
    label: "Restart Server",
    description: "Reboot the entire server",
    icon: <Power className="h-5 w-5" />,
    confirmTitle: "⚠ Restart Server",
    confirmMessage:
      "This will REBOOT the entire server. All running services and containers will be stopped. The server will be unavailable for 1-2 minutes. Are you absolutely sure?",
    variant: "danger",
    category: "system",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: "🔧 Maintenance",
  cleanup: "🧹 Cleanup",
  info: "📊 Information",
  system: "⚙ System",
};

const CATEGORY_ORDER = ["maintenance", "cleanup", "info", "system"];

export function QuickActions({ serverId }: QuickActionsProps) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputAction, setOutputAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);

  // Confirmation dialog state
  const [pendingAction, setPendingAction] = useState<ActionConfig | null>(null);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    setRunningAction(action.key);
    setOutput(null);
    setOutputAction(null);
    setError(null);
    setDisconnected(false);

    try {
      const res = await fetch(`/api/servers/${serverId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.key }),
      });
      const json = await res.json();

      if (json.code === "DISCONNECTED") {
        setDisconnected(true);
        return;
      }

      if (!json.success) {
        setError(json.error || "Action failed");
        return;
      }

      setOutput(json.data?.output || "Done (no output)");
      setOutputAction(action.label);
    } catch {
      setError("Failed to connect to server");
    } finally {
      setRunningAction(null);
    }
  }, [pendingAction, serverId]);

  // Group actions by category
  const groupedActions = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: ACTIONS.filter((a) => a.category === cat),
  }));

  return (
    <div className="space-y-6">
      {disconnected && (
        <div className="flex items-center gap-3 p-4 bg-gray-800 border border-gray-700 rounded-xl">
          <WifiOff className="h-5 w-5 text-gray-500" />
          <p className="text-sm text-gray-400">Server is offline or unreachable</p>
        </div>
      )}

      {groupedActions.map((group) => (
        <div key={group.category} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {group.label}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((action) => (
              <Card key={action.key} className="flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-gray-700/50 text-gray-300">
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-white">{action.label}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{action.description}</p>
                  </div>
                </div>
                <Button
                  variant={action.variant}
                  size="sm"
                  loading={runningAction === action.key}
                  disabled={runningAction !== null}
                  onClick={() => setPendingAction(action)}
                  className="w-full mt-auto"
                >
                  Run
                </Button>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Command output */}
      {(output || error) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Terminal className="h-4 w-4 text-gray-500" />
            <span className="text-gray-400">
              {error ? "Error" : `Output: ${outputAction}`}
            </span>
          </div>
          <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-gray-300 max-h-[300px] overflow-auto font-mono whitespace-pre-wrap">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              output
            )}
          </pre>
        </div>
      )}

      {/* Custom confirm dialog */}
      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.confirmTitle || ""}
        message={pendingAction?.confirmMessage || ""}
        confirmLabel="Run"
        variant={pendingAction?.variant === "danger" ? "danger" : "primary"}
        onConfirm={handleConfirm}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
