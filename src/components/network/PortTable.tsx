"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PortInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function PortTable({ serverId = "local" }: { serverId?: string }) {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>("none");
  const [view, setView] = useState<"listening" | "established" | "all">("listening");

  const fetchPorts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(serverId === "local" ? "/api/network/ports" : `/api/servers/${serverId}/network`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to load ports");
      setPorts(serverId === "local" ? json.data ?? [] : json.data?.hostPorts ?? []);
      setSource(serverId === "local" ? json.source ?? "none" : "remote");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

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

  const filteredPorts = ports.filter((p) => {
    if (view === "listening") return p.state.toUpperCase() === "LISTEN";
    if (view === "established") return p.state.toUpperCase() !== "LISTEN";
    return true;
  });

  const emptyMessage = view === "listening"
    ? "No listening ports found."
    : view === "established"
      ? "No established connections found."
      : "No ports found.";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Network Ports</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Active ports on this server — services accepting connections and established traffic.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchPorts} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* View filter tabs */}
      <div className="flex items-center gap-2">
        <div className="flex gap-2">
          {(["listening", "established", "all"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${
                view === v
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              {v === "listening" ? "Listening Ports" : v === "established" ? "Established Connections" : "All"}
            </button>
          ))}
        </div>
        {/* Source indicator */}
        {source && source !== "none" && !loading && (
          <Badge variant={source === "ss" ? "success" : source === "docker" ? "info" : "default"}>
            {source === "remote" ? "Remote Host" : source === "ss" ? "Host" : source === "container" ? "Container" : source === "docker" ? "Docker" : source}
          </Badge>
        )}
      </div>

      {/* Regular errors */}
      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="space-y-3 md:hidden">
        {loading && ports.length === 0 ? (
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-8 text-center text-gray-500">
            <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Loading ports...
          </div>
        ) : filteredPorts.length === 0 ? (
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-8 text-center text-gray-500">{emptyMessage}</div>
        ) : filteredPorts.map((port, idx) => (
          <div key={idx} className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-white">{port.localAddress}:{port.localPort}</p>
                <p className="mt-1 font-mono text-xs uppercase text-gray-500">{port.protocol}</p>
              </div>
              <Badge variant={stateVariant(port.state)}>{port.state}</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-400">
              <p className="break-all">Foreign: {port.foreignAddress || "*"}:{port.foreignPort || "*"}</p>
              <p className="break-all">Process: {port.process || "—"}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-gray-700 md:block">
        <table className="min-w-[760px] w-full text-left text-sm">
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
            ) : filteredPorts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filteredPorts.map((port, idx) => (
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
    </div>
  );
}

