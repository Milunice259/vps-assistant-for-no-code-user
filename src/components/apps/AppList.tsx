"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AppWindow,
  RefreshCw,
  FileText,
  Server,
} from "lucide-react";
import type { AppInfo, ApiResponse, AppStatusType } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AppLogViewer } from "@/components/apps/AppLogViewer";

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

export function AppList() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string } | null>(null);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/apps");
      const json: ApiResponse<AppInfo[]> = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load apps");
      setApps(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  // Group apps by server
  const grouped = apps.reduce<Record<string, { serverName: string; apps: AppInfo[] }>>(
    (acc, app) => {
      if (!acc[app.serverId]) {
        acc[app.serverId] = { serverName: app.serverName, apps: [] };
      }
      acc[app.serverId].apps.push(app);
      return acc;
    },
    {}
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchApps}>
          Retry
        </Button>
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <AppWindow className="h-10 w-10 text-gray-600" />
        <p className="text-gray-400">No applications found</p>
        <p className="text-xs text-gray-600 max-w-sm text-center">
          Applications are auto-discovered from Docker containers running on your servers.
          Make sure you have servers configured and Docker containers running.
        </p>
        <Button variant="secondary" size="sm" onClick={fetchApps}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>
    );
  }

  const runningCount = apps.filter((a) => a.status === "RUNNING").length;
  const stoppedCount = apps.filter((a) => a.status === "STOPPED").length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            Total: <span className="text-white">{apps.length}</span>
          </span>
          <span className="text-gray-400">
            Running: <span className="text-emerald-400">{runningCount}</span>
          </span>
          {stoppedCount > 0 && (
            <span className="text-gray-400">
              Stopped: <span className="text-red-400">{stoppedCount}</span>
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchApps}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Grouped by server */}
      {Object.entries(grouped).map(([serverId, group]) => (
        <div key={serverId}>
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-300">{group.serverName}</h3>
            <Badge variant="default">{group.apps.length}</Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Image</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Domain</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {group.apps.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-800/50">
                    <td className="py-3 text-white font-medium">
                      <div className="flex items-center gap-2">
                        <AppWindow className="h-4 w-4 text-blue-400 shrink-0" />
                        <span className="truncate max-w-[200px]">{app.name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-gray-400 text-xs truncate max-w-[200px]">
                      {app.image || "—"}
                    </td>
                    <td className="py-3">
                      <Badge variant={statusBadgeVariant(app.status)}>
                        {app.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-gray-400 text-xs">
                      {app.domain || "—"}
                    </td>
                    <td className="py-3 text-right">
                      {app.containerId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setViewingLogs({ id: app.id, name: app.name })
                          }
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" />
                          Logs
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Log Viewer Modal */}
      {viewingLogs && (
        <AppLogViewer
          appId={viewingLogs.id}
          appName={viewingLogs.name}
          onClose={() => setViewingLogs(null)}
        />
      )}
    </div>
  );
}
