"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface AppLogViewerProps {
  appId: string;
  appName: string;
  onClose: () => void;
}

export function AppLogViewer({ appId, appName, onClose }: AppLogViewerProps) {
  const [logs, setLogs] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/logs?lines=200`);
      const json: ApiResponse<{ logs: string }> = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch logs");
      }
      setLogs(json.data?.logs || "(no output)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-medium text-white">
              Logs: {appName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchLogs} loading={loading}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && !logs ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-400">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={fetchLogs}
              >
                Retry
              </Button>
            </div>
          ) : (
            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
              {logs}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
