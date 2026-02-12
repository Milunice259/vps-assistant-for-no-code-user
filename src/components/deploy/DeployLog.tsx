"use client";

import { useCallback, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";
import type { DeploymentInfo, DeployStatus } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useSSE } from "@/hooks/useSSE";

const statusVariant: Record<DeployStatus, "success" | "warning" | "danger" | "info" | "default"> = {
  PENDING: "default",
  CLONING: "info",
  BUILDING: "warning",
  RUNNING: "success",
  FAILED: "danger",
};

interface DeployStreamData {
  deployments: DeploymentInfo[];
}

export function DeployLog() {
  const { data: streamData } = useSSE<DeployStreamData>("/api/deploy/stream", {
    fallbackPollMs: 10_000,
  });
  const [manualData, setManualData] = useState<DeploymentInfo[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const deployments = manualData ?? streamData?.deployments ?? [];

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/deploy");
      const json = await res.json();
      if (json.success) {
        setManualData(json.data ?? []);
        // Clear manual override after next SSE update
        setTimeout(() => setManualData(null), 5_000);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loading = !streamData && !manualData;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Deployment History</h2>
        <Button variant="ghost" size="sm" onClick={handleRefresh} loading={refreshing}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {loading && deployments.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : deployments.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
          <Clock className="h-10 w-10" />
          <p>No deployments yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((deploy) => (
            <div
              key={deploy.id}
              className="rounded-xl border border-gray-700 bg-gray-800 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-white">
                    {deploy.repoUrl}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <span>Branch: {deploy.branch}</span>
                    <span>&middot;</span>
                    <span>Stack: {deploy.detectedStack}</span>
                    {deploy.domain && (
                      <>
                        <span>&middot;</span>
                        <span>{deploy.domain}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={statusVariant[deploy.status]}>
                    {deploy.status}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {new Date(deploy.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
