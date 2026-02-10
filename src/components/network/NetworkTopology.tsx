"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Globe,
  Box,
  Network,
  RefreshCw,
  WifiOff,
  ArrowRight,
  Play,
  Square,
} from "lucide-react";
import type { NetworkTopology, ApiResponse, ServerInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface NetworkTopologyViewProps {
  serverId: string;
}

export function NetworkTopologyView({ serverId }: NetworkTopologyViewProps) {
  const [topology, setTopology] = useState<NetworkTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisconnected(false);
    setWarning(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/network`);
      const json: ApiResponse<NetworkTopology> = await res.json();
      if (!res.ok) {
        if (json.code === "DISCONNECTED") {
          setDisconnected(true);
          return;
        }
        throw new Error(json.error || "Failed to load topology");
      }
      setTopology(json.data || null);
      if (json.warning) setWarning(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  async function handleContainerAction(containerId: string, action: "start" | "stop") {
    setActionLoading(`${containerId}-${action}`);
    try {
      await fetch(`/api/servers/${serverId}/docker/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId, action }),
      });
      await fetchTopology();
    } catch {
      // ignore
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
        <Button variant="secondary" size="sm" onClick={fetchTopology}>
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
        <Button variant="secondary" size="sm" onClick={fetchTopology}>
          Retry
        </Button>
      </div>
    );
  }

  if (!topology) return null;

  // Gather unique listening ports and container port mappings
  const listeningPorts = topology.hostPorts.filter(
    (p) => p.localPort > 0 && p.process
  );

  // Filter networks that have containers
  const networksWithContainers = topology.networks.filter(
    (n) => n.containers.length > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          {topology.networks.length} network(s) &middot; {listeningPorts.length} listening port(s)
        </p>
        <Button variant="ghost" size="sm" onClick={fetchTopology}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {warning && (
        <div className="p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-sm text-yellow-400">
          {warning}
        </div>
      )}

      {/* Topology Grid: Host Ports → Containers */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-start">
        {/* Left: Host Ports */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h4 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-400" />
            Host Ports
          </h4>
          {listeningPorts.length === 0 ? (
            <p className="text-xs text-gray-500">No listening ports detected</p>
          ) : (
            <div className="space-y-2">
              {listeningPorts.slice(0, 20).map((p, i) => (
                <div
                  key={`${p.protocol}-${p.localPort}-${i}`}
                  className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="info">{p.protocol}</Badge>
                    <span className="text-white text-sm font-mono">:{p.localPort}</span>
                  </div>
                  <span className="text-xs text-gray-500">{p.process}</span>
                </div>
              ))}
              {listeningPorts.length > 20 && (
                <p className="text-xs text-gray-500 text-center">
                  +{listeningPorts.length - 20} more
                </p>
              )}
            </div>
          )}
        </div>

        {/* Center: Arrow */}
        <div className="hidden lg:flex items-center justify-center py-12">
          <ArrowRight className="h-6 w-6 text-gray-600" />
        </div>

        {/* Right: Docker Networks & Containers */}
        <div className="space-y-4">
          {networksWithContainers.length === 0 ? (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
              <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Network className="h-4 w-4 text-purple-400" />
                Docker Networks
              </h4>
              <p className="text-xs text-gray-500">No containers connected to any network</p>
            </div>
          ) : (
            networksWithContainers.map((net) => (
              <div
                key={net.id}
                className="bg-gray-800 border border-gray-700 rounded-xl p-5"
              >
                <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <Network className="h-4 w-4 text-purple-400" />
                  {net.name}
                  <Badge variant="default">{net.driver}</Badge>
                </h4>
                <div className="space-y-2">
                  {net.containers.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Box className="h-3.5 w-3.5 text-blue-400" />
                        <span className="text-white text-sm">{c.name}</span>
                        {c.ipv4 && (
                          <span className="text-xs text-gray-500 font-mono">{c.ipv4}</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={actionLoading === `${c.name}-stop`}
                          onClick={() => handleContainerAction(c.name, "stop")}
                          title="Stop"
                        >
                          <Square className="h-3 w-3 text-red-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={actionLoading === `${c.name}-start`}
                          onClick={() => handleContainerAction(c.name, "start")}
                          title="Start"
                        >
                          <Play className="h-3 w-3 text-green-400" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Server Selector ───

interface ServerSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ServerSelector({ selectedId, onSelect }: ServerSelectorProps) {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/servers")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setServers(json.data || []);
          // Auto-select first server if none selected
          if (!selectedId && json.data?.length > 0) {
            onSelect(json.data[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return null;

  if (servers.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No servers configured. Add a server first.
      </p>
    );
  }

  return (
    <select
      value={selectedId || ""}
      onChange={(e) => onSelect(e.target.value)}
      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      <option value="" disabled>
        Select a server...
      </option>
      {servers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.host})
        </option>
      ))}
    </select>
  );
}
