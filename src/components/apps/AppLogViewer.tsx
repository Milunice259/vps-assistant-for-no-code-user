"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X, RefreshCw, Terminal, Search, Download, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface AppLogViewerProps {
  appId: string;
  appName: string;
  onClose: () => void;
}

export function AppLogViewer({ appId, appName, onClose }: AppLogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);

  // Keep paused ref in sync
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Auto-scroll
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, paused]);

  // Fetch initial logs (non-streaming)
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/logs?lines=200`);
      const json: ApiResponse<{ logs: string }> = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch logs");
      const logText = json.data?.logs || "(no output)";
      setLines(logText.split("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  // Start SSE streaming
  const startStream = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setError(null);

    const eventSource = new EventSource(`/api/apps/${appId}/logs/stream?lines=200`);

    eventSource.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const line = JSON.parse(event.data) as string;
        setLines((prev) => {
          const next = [...prev, line];
          // Keep max 5000 lines
          return next.length > 5000 ? next.slice(-5000) : next;
        });
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setStreaming(false);
    };

    // Cleanup on abort
    controller.signal.addEventListener("abort", () => {
      eventSource.close();
      setStreaming(false);
    });

    return () => {
      eventSource.close();
      setStreaming(false);
    };
  }, [appId]);

  // Load initial logs on mount
  useEffect(() => {
    fetchLogs();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchLogs]);

  function toggleStream() {
    if (streaming) {
      if (abortRef.current) abortRef.current.abort();
      setStreaming(false);
    } else {
      setLines([]); // Clear before streaming
      startStream();
    }
  }

  function downloadLogs() {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${appName}-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Line coloring
  function lineClass(line: string): string {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("fatal") || lower.includes("panic")) {
      return "text-red-400";
    }
    if (lower.includes("warn")) {
      return "text-amber-400";
    }
    if (lower.includes("info")) {
      return "text-blue-300";
    }
    return "text-gray-300";
  }

  // Search filter
  const displayLines = searchTerm
    ? lines.filter((l) => l.toLowerCase().includes(searchTerm.toLowerCase()))
    : lines;

  return (
    <div className="bg-gray-950 border border-gray-700 rounded-xl flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-white">
            Logs: {appName}
            {streaming && (
              <span className="ml-2 text-xs text-emerald-400 animate-pulse">● Live</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-gray-500 hover:text-gray-300 p-1.5"
            title="Search"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={downloadLogs}
            className="text-gray-500 hover:text-gray-300 p-1.5"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {streaming && (
            <button
              onClick={() => setPaused(!paused)}
              className="text-gray-500 hover:text-gray-300 p-1.5"
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
          <Button
            variant={streaming ? "danger" : "secondary"}
            size="sm"
            onClick={toggleStream}
          >
            {streaming ? "Stop" : "Stream"}
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchLogs} loading={loading} disabled={streaming}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1.5">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="px-4 py-2 border-b border-gray-800">
          <input
            type="text"
            placeholder="Filter logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white font-mono placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            autoFocus
          />
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-4">
        {loading && lines.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={fetchLogs}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed">
            {displayLines.map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line || "\u00A0"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600 flex justify-between">
        <span>{displayLines.length} lines{searchTerm ? ` (filtered from ${lines.length})` : ""}</span>
        {paused && <span className="text-amber-400">Paused</span>}
      </div>
    </div>
  );
}
