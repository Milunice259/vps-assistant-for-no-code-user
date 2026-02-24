"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Box, Play, Square, RotateCw, RefreshCw, WifiOff } from "lucide-react";
import type { ContainerInfo, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface DockerContainerListProps {
  serverId: string;
}

function stateBadgeVariant(state: string) {
  const s = state.toLowerCase();
  if (s === "running") return "success" as const;
  if (s === "exited" || s === "dead") return "danger" as const;
  if (s === "restarting") return "warning" as const;
  if (s === "paused" || s === "created") return "default" as const;
  return "default" as const;
}

export function DockerContainerList({ serverId }: DockerContainerListProps) {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisconnected(false);
    try {
      const res = await fetch(`/api/servers/${serverId}/docker`);
      const json: ApiResponse<ContainerInfo[]> = await res.json();
      if (!res.ok) {
        if (json.code === "DISCONNECTED") {
          setDisconnected(true);
          return;
        }
        throw new Error(json.error || "Failed to load containers");
      }
      setContainers(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  async function handleAction(containerId: string, action: string) {
    setActionLoading(`${containerId}-${action}`);
    try {
      const res = await fetch(`/api/servers/${serverId}/docker/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId, action }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(`Action failed: ${json.error}`);
      }
      // Refresh container list after action
      await fetchContainers();
    } catch {
      alert("Failed to perform action");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (disconnected) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <WifiOff className="h-8 w-8 text-gray-500" />
        <p className="text-sm text-gray-400">Server is offline</p>
        <Button variant="secondary" size="sm" onClick={fetchContainers}>
          Retry
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchContainers}>
          Retry
        </Button>
      </div>
    );
  }

  if (containers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <Box className="h-8 w-8 text-gray-500" />
        <p className="text-sm text-gray-400">No applications found on this server</p>
        <p className="text-xs text-gray-600">Deploy an application to see it here. Check the Deploy page to get started.</p>
        <Button variant="secondary" size="sm" onClick={fetchContainers}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{containers.length} application(s)</p>
        <Button variant="ghost" size="sm" onClick={fetchContainers}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Template</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Uptime</th>
              <th className="pb-3 font-medium">Connections</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {containers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-800/50">
                <td className="py-3 text-white font-medium">
                  <div className="flex items-center gap-2">
                    <Box className="h-4 w-4 text-blue-400 shrink-0" />
                    <span className="truncate max-w-[180px]">{c.name}</span>
                  </div>
                </td>
                <td className="py-3 text-gray-400 truncate max-w-[200px]">{c.image}</td>
                <td className="py-3">
                  <Badge variant={stateBadgeVariant(c.state)}>{c.state}</Badge>
                </td>
                <td className="py-3 text-gray-400 text-xs">{c.uptime}</td>
                <td className="py-3 text-gray-400 text-xs truncate max-w-[200px]">
                  {c.ports || "—"}
                </td>
                <td className="py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    {c.state.toLowerCase() !== "running" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={actionLoading === `${c.id}-start`}
                        onClick={() => handleAction(c.id, "start")}
                        title="Start"
                      >
                        <Play className="h-3.5 w-3.5 text-green-400" />
                      </Button>
                    )}
                    {c.state.toLowerCase() === "running" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={actionLoading === `${c.id}-stop`}
                        onClick={() => handleAction(c.id, "stop")}
                        title="Stop"
                      >
                        <Square className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={actionLoading === `${c.id}-restart`}
                      onClick={() => handleAction(c.id, "restart")}
                      title="Restart"
                    >
                      <RotateCw className="h-3.5 w-3.5 text-yellow-400" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
