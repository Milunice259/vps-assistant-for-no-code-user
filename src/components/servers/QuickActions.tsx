"use client";

import { useState, useCallback } from "react";
import { Download, Trash2, RotateCw, WifiOff, Terminal } from "lucide-react";
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
}

const ACTIONS: ActionConfig[] = [
  {
    key: "apt-update",
    label: "Update APT",
    description: "Run apt update to refresh package lists",
    icon: <Download className="h-5 w-5" />,
    confirmTitle: "Update APT Packages",
    confirmMessage: "This will run 'sudo apt update -y' on the remote server. Continue?",
    variant: "primary",
  },
  {
    key: "docker-prune",
    label: "Clean Docker Images",
    description: "Remove unused Docker images, containers, and volumes",
    icon: <Trash2 className="h-5 w-5" />,
    confirmTitle: "Clean Docker Images",
    confirmMessage:
      "This will run 'docker system prune -af' and remove all unused Docker images, containers, networks, and volumes. This action cannot be undone.",
    variant: "danger",
  },
  {
    key: "restart-docker",
    label: "Restart Docker",
    description: "Restart the Docker daemon service",
    icon: <RotateCw className="h-5 w-5" />,
    confirmTitle: "Restart Docker Service",
    confirmMessage:
      "This will restart the Docker daemon. Running containers will be briefly interrupted while the service restarts.",
    variant: "secondary",
  },
];

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

  return (
    <div className="space-y-6">
      {disconnected && (
        <div className="flex items-center gap-3 p-4 bg-gray-800 border border-gray-700 rounded-xl">
          <WifiOff className="h-5 w-5 text-gray-500" />
          <p className="text-sm text-gray-400">Server is offline or unreachable</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {ACTIONS.map((action) => (
          <Card key={action.key} className="flex flex-col">
            <div className="flex items-start gap-3 mb-4">
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

      {/* Custom confirm dialog (replaces browser confirm()) */}
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
