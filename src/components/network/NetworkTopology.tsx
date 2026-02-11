"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Globe,
  Box,
  Network,
  RefreshCw,
  WifiOff,
  Play,
  Square,
  RotateCw,
  ChevronDown,
  ChevronRight,
  Layers,
  HardDrive,
  Workflow,
} from "lucide-react";
import type { NetworkTopology, ApiResponse, ServerInfo, DockerNetworkContainer } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// ─── Helpers ───

function containerStateColor(state?: string) {
  switch (state?.toLowerCase()) {
    case "running":
      return { dot: "bg-emerald-400", ring: "ring-emerald-400/20", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
    case "exited":
    case "dead":
      return { dot: "bg-red-400", ring: "ring-red-400/20", text: "text-red-400", bg: "bg-red-500/10 border-red-500/20" };
    case "restarting":
      return { dot: "bg-yellow-400", ring: "ring-yellow-400/20", text: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" };
    case "paused":
      return { dot: "bg-orange-400", ring: "ring-orange-400/20", text: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" };
    default:
      return { dot: "bg-gray-400", ring: "ring-gray-400/20", text: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20" };
  }
}

function stateLabel(state?: string): string {
  const s = state?.toLowerCase();
  if (s === "running") return "Running";
  if (s === "exited" || s === "dead") return "Stopped";
  if (s === "restarting") return "Restarting";
  if (s === "paused") return "Paused";
  if (s === "created") return "Created";
  return state || "Unknown";
}

function networkColor(index: number) {
  const colors = [
    { border: "border-purple-500/30", bg: "bg-purple-500/5", header: "bg-purple-500/10", text: "text-purple-400", icon: "text-purple-400" },
    { border: "border-blue-500/30", bg: "bg-blue-500/5", header: "bg-blue-500/10", text: "text-blue-400", icon: "text-blue-400" },
    { border: "border-cyan-500/30", bg: "bg-cyan-500/5", header: "bg-cyan-500/10", text: "text-cyan-400", icon: "text-cyan-400" },
    { border: "border-teal-500/30", bg: "bg-teal-500/5", header: "bg-teal-500/10", text: "text-teal-400", icon: "text-teal-400" },
    { border: "border-indigo-500/30", bg: "bg-indigo-500/5", header: "bg-indigo-500/10", text: "text-indigo-400", icon: "text-indigo-400" },
    { border: "border-pink-500/30", bg: "bg-pink-500/5", header: "bg-pink-500/10", text: "text-pink-400", icon: "text-pink-400" },
  ];
  return colors[index % colors.length];
}

// ─── Container Card ───

interface ContainerCardProps {
  container: DockerNetworkContainer;
  serverId: string;
  onAction: (containerId: string, action: "start" | "stop" | "restart") => void;
  actionLoading: string | null;
}

function ContainerCard({ container, serverId: _serverId, onAction, actionLoading }: ContainerCardProps) {
  const colors = containerStateColor(container.state);
  const isRunning = container.state?.toLowerCase() === "running";

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border ${colors.bg} backdrop-blur-sm transition-all duration-200 hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20`}
    >
      {/* Status indicator bar */}
      <div className={`absolute left-0 top-0 h-full w-1 ${colors.dot} rounded-l-xl`} />

      <div className="pl-4 pr-3 py-3">
        {/* Header: name + status */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2 w-2 rounded-full ${colors.dot} ring-4 ${colors.ring} shrink-0`} />
            <span className="text-sm font-semibold text-white truncate">
              {container.name}
            </span>
          </div>
          <Badge variant={isRunning ? "success" : container.state?.toLowerCase() === "exited" ? "danger" : "default"}>
            {stateLabel(container.state)}
          </Badge>
        </div>

        {/* Details grid */}
        <div className="space-y-1.5 ml-4">
          {container.image && (
            <div className="flex items-center gap-2 text-xs">
              <HardDrive className="h-3 w-3 text-gray-500 shrink-0" />
              <span className="text-gray-400 truncate" title={container.image}>
                {container.image}
              </span>
            </div>
          )}
          {container.ipv4 && (
            <div className="flex items-center gap-2 text-xs">
              <Workflow className="h-3 w-3 text-gray-500 shrink-0" />
              <span className="font-mono text-gray-300">{container.ipv4}</span>
            </div>
          )}
          {container.ports && (
            <div className="flex items-center gap-2 text-xs">
              <Globe className="h-3 w-3 text-gray-500 shrink-0" />
              <span className="text-gray-400 truncate" title={container.ports}>
                {container.ports || "—"}
              </span>
            </div>
          )}
        </div>

        {/* Action buttons — visible on hover */}
        <div className="flex gap-1 mt-2.5 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {isRunning ? (
            <>
              <button
                onClick={() => onAction(container.name, "stop")}
                disabled={actionLoading === `${container.name}-stop`}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
              <button
                onClick={() => onAction(container.name, "restart")}
                disabled={actionLoading === `${container.name}-restart`}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
              >
                <RotateCw className="h-3 w-3" />
                Restart
              </button>
            </>
          ) : (
            <button
              onClick={() => onAction(container.name, "start")}
              disabled={actionLoading === `${container.name}-start`}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <Play className="h-3 w-3" />
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Network Section ───

interface NetworkSectionProps {
  network: { id: string; name: string; driver: string; containers: DockerNetworkContainer[] };
  index: number;
  serverId: string;
  onAction: (containerId: string, action: "start" | "stop" | "restart") => void;
  actionLoading: string | null;
}

function NetworkSection({ network, index, serverId, onAction, actionLoading }: NetworkSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const colors = networkColor(index);
  const runningCount = network.containers.filter(c => c.state?.toLowerCase() === "running").length;
  const totalCount = network.containers.length;

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all duration-200`}>
      {/* Network header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 ${colors.header} transition-colors hover:brightness-110`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Network className={`h-4 w-4 ${colors.icon} shrink-0`} />
          <span className={`font-semibold text-sm ${colors.text}`}>{network.name}</span>
          <Badge variant="default">{network.driver}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Layers className="h-3 w-3" />
            <span>
              <span className="text-emerald-400">{runningCount}</span>
              <span className="text-gray-600"> / </span>
              {totalCount}
            </span>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Container cards grid */}
      {expanded && (
        <div className="p-3">
          {totalCount === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              No containers attached to this network
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {network.containers.map((c) => (
                <ContainerCard
                  key={c.id || c.name}
                  container={c}
                  serverId={serverId}
                  onAction={onAction}
                  actionLoading={actionLoading}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Topology View ───

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

  async function handleContainerAction(containerId: string, action: "start" | "stop" | "restart") {
    setActionLoading(`${containerId}-${action}`);
    try {
      await fetch(`/api/servers/${serverId}/docker/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId, action }),
      });
      await fetchTopology();
    } catch {
      // ignore — will reflect on next refresh
    } finally {
      setActionLoading(null);
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading network topology...</p>
        </div>
      </div>
    );
  }

  // ── Disconnected ──
  if (disconnected) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 bg-gray-800/50 rounded-xl border border-gray-700">
        <WifiOff className="h-10 w-10 text-gray-500" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-300">Server Offline</p>
          <p className="text-xs text-gray-500 mt-1">Unable to connect to the server</p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchTopology}>
          <RefreshCw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 bg-red-500/5 rounded-xl border border-red-500/20">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-red-400 max-w-md text-center">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchTopology}>
          <RefreshCw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  if (!topology) return null;

  // ── Compute stats ──
  const allContainers = topology.networks.flatMap((n) => n.containers);
  const totalContainers = allContainers.length;
  const runningContainers = allContainers.filter(c => c.state?.toLowerCase() === "running").length;
  const stoppedContainers = allContainers.filter(c => c.state?.toLowerCase() === "exited" || c.state?.toLowerCase() === "dead").length;
  const networksWithContainers = topology.networks.filter(n => n.containers.length > 0);
  const listeningPorts = topology.hostPorts.filter(p => p.localPort > 0 && p.process);

  return (
    <div className="space-y-6">
      {/* ── Summary Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          {/* Networks */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Network className="h-4 w-4 text-purple-400" />
            <span className="text-xs text-gray-400">Networks</span>
            <span className="text-sm font-semibold text-white">{topology.networks.length}</span>
          </div>
          {/* Containers */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Box className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-gray-400">Containers</span>
            <span className="text-sm font-semibold text-white">{totalContainers}</span>
          </div>
          {/* Running */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <div className="h-2 w-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
            <span className="text-xs text-gray-400">Running</span>
            <span className="text-sm font-semibold text-emerald-400">{runningContainers}</span>
          </div>
          {/* Stopped */}
          {stoppedContainers > 0 && (
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
              <div className="h-2 w-2 rounded-full bg-red-400 ring-4 ring-red-400/20" />
              <span className="text-xs text-gray-400">Stopped</span>
              <span className="text-sm font-semibold text-red-400">{stoppedContainers}</span>
            </div>
          )}
          {/* Ports */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Globe className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-gray-400">Ports</span>
            <span className="text-sm font-semibold text-white">{listeningPorts.length}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchTopology}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Warning ── */}
      {warning && (
        <div className="flex items-center gap-2 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-sm text-yellow-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {warning}
        </div>
      )}

      {/* ── Host Ports Section ── */}
      {listeningPorts.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 text-amber-400" />
            Host Listening Ports
          </h4>
          <div className="flex flex-wrap gap-2">
            {listeningPorts.map((p, i) => (
              <div
                key={`${p.protocol}-${p.localPort}-${i}`}
                className="flex items-center gap-2 bg-gray-900/70 border border-gray-700/50 rounded-lg px-3 py-1.5 hover:border-gray-600 transition-colors"
              >
                <Badge variant="info">{p.protocol}</Badge>
                <span className="text-white text-sm font-mono font-semibold">:{p.localPort}</span>
                {p.process && (
                  <span className="text-xs text-gray-500">{p.process}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Networks & Containers ── */}
      {networksWithContainers.length === 0 && topology.networks.length > 0 ? (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center">
          <Box className="h-8 w-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No containers connected to any network</p>
          <p className="text-xs text-gray-600 mt-1">
            {topology.networks.length} empty network(s) found
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {topology.networks
            .filter((n) => n.containers.length > 0)
            .map((net, i) => (
              <NetworkSection
                key={net.id}
                network={net}
                index={i}
                serverId={serverId}
                onAction={handleContainerAction}
                actionLoading={actionLoading}
              />
            ))}
        </div>
      )}
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
