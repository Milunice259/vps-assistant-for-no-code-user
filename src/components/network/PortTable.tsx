"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Monitor } from "lucide-react";
import type { PortInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function PortTable() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  const fetchPorts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlatformError(null);
    try {
      const res = await fetch("/api/network/ports");
      const json = await res.json();

      // Handle platform-specific error with friendly message
      if (json.error === "UNSUPPORTED_PLATFORM") {
        setPlatformError(json.message);
        return;
      }
      // Port listing unavailable (e.g. ss not found in container)
      if (json.error === "COMMAND_FAILED") {
        setPlatformError(json.message ?? "Port listing is not available in this environment.");
        return;
      }

      if (!res.ok) throw new Error(json.error || json.message || "Failed to load ports");
      setPorts(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  const stateVariant = (state: string) => {
    switch (state.toUpperCase()) {
      case "LISTEN":
        return "success" as const;
      case "ESTABLISHED":
        return "info" as const;
      case "TIME_WAIT":
      case "CLOSE_WAIT":
        return "warning" as const;
      default:
        return "default" as const;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Open Ports</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Ports currently in use on this server. Each port represents a service accepting connections.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchPorts} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Friendly platform warning */}
      {platformError && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-4">
          <Monitor className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-400" />
          <div>
            <p className="font-medium text-yellow-300">
              Linux Server Required
            </p>
            <p className="mt-1 text-sm text-yellow-200/70">
              {platformError}
            </p>
            <p className="mt-2 text-xs text-yellow-200/50">
              Port scanning uses the <code className="bg-yellow-500/10 px-1 rounded">ss</code> command which is only available on Linux servers.
              When deployed on a VPS, this section will show all active connections.
            </p>
          </div>
        </div>
      )}

      {/* Regular errors */}
      {error && !platformError && (
        <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {!platformError && (
      <div className="overflow-x-auto rounded-xl border border-gray-700">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-700 bg-gray-800/50 text-xs uppercase text-gray-400">
            <tr>
              <th className="px-4 py-3 relative group cursor-help">
                Protocol
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  TCP or UDP — the communication method used
                </span>
              </th>
              <th className="px-4 py-3 relative group cursor-help">
                Local Address
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  The IP address on this server where the service is listening
                </span>
              </th>
              <th className="px-4 py-3 relative group cursor-help">
                Port
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  A numbered address where the program listens for network traffic
                </span>
              </th>
              <th className="px-4 py-3 relative group cursor-help">
                Foreign Address
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  The remote address that is connected (or * if waiting for connections)
                </span>
              </th>
              <th className="px-4 py-3 relative group cursor-help">
                State
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  LISTEN = waiting for connections, ESTABLISHED = active connection
                </span>
              </th>
              <th className="px-4 py-3 relative group cursor-help">
                Process
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal">
                  The program or service using this port
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {loading && ports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  Loading ports...
                </td>
              </tr>
            ) : ports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No ports found.
                </td>
              </tr>
            ) : (
              ports.map((port, idx) => (
                <tr key={idx} className="bg-gray-800 transition-colors hover:bg-gray-750">
                  <td className="px-4 py-2 font-mono text-xs uppercase text-gray-300">
                    {port.protocol}
                  </td>
                  <td className="px-4 py-2 font-mono text-gray-300">
                    {port.localAddress}
                  </td>
                  <td className="px-4 py-2 font-mono text-white">
                    {port.localPort}
                  </td>
                  <td className="px-4 py-2 font-mono text-gray-300">
                    {port.foreignAddress}:{port.foreignPort}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={stateVariant(port.state)}>
                      {port.state}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-gray-400">{port.process}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
