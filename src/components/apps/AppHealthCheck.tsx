"use client";

import { useState, useCallback, useEffect } from "react";
import { HeartPulse, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface AppHealthCheckProps {
  appId: string;
}

interface HealthResult {
  status: "healthy" | "unhealthy" | "unknown";
  output: string;
  checkedAt: string;
  containerState: string;
}

export function AppHealthCheck({ appId }: AppHealthCheckProps) {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/health`);
      const json: ApiResponse<HealthResult> = await res.json();
      if (json.success && json.data) {
        setResult(json.data);
      } else {
        setError(json.error || "Health check failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  // Auto-run health check on mount
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const statusColor = {
    healthy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    unhealthy: "text-red-400 bg-red-500/10 border-red-500/20",
    unknown: "text-gray-400 bg-gray-500/10 border-gray-500/20",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-medium text-white">Health Check</span>
        <Button variant="ghost" size="sm" onClick={runCheck} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Check Now
        </Button>
      </div>

      <p className="text-xs text-gray-500">
        Health checks verify your app is responding correctly. A &quot;healthy&quot; status means the container is running and passing its configured health test.
      </p>

      {error && (
        <div className="text-xs text-red-400 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          {error}
        </div>
      )}

      {result && (
        <div className={`rounded-lg border p-4 ${statusColor[result.status]}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold capitalize">{result.status}</span>
            <span className="text-xs text-gray-500">
              {new Date(result.checkedAt).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-xs opacity-80">{result.output}</p>
          <p className="text-xs text-gray-500 mt-1">Container: {result.containerState}</p>
        </div>
      )}

      {!result && !error && loading && (
        <p className="text-xs text-gray-500">Running health check…</p>
      )}
    </div>
  );
}
