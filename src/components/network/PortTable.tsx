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

      if (!res.ok) throw new Error(json.error || "Failed to load ports");
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
        <h2 className="text-lg font-semibold text-white">Open Ports</h2>
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
              <th className="px-4 py-3">Protocol</th>
              <th className="px-4 py-3">Local Address</th>
              <th className="px-4 py-3">Port</th>
              <th className="px-4 py-3">Foreign Address</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Process</th>
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
