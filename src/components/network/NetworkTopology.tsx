"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Layers,
  HardDrive,
  Workflow,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import type { NetworkTopology, ApiResponse, ServerInfo, DockerNetworkContainer } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// ─── Color helpers ───

function containerStateColor(state?: string) {
  switch (state?.toLowerCase()) {
    case "running":
      return { dot: "#34d399", stroke: "#059669", bg: "#064e3b", text: "text-emerald-400" };
    case "exited":
    case "dead":
      return { dot: "#f87171", stroke: "#dc2626", bg: "#450a0a", text: "text-red-400" };
    case "restarting":
      return { dot: "#fbbf24", stroke: "#d97706", bg: "#451a03", text: "text-yellow-400" };
    case "paused":
      return { dot: "#fb923c", stroke: "#ea580c", bg: "#431407", text: "text-orange-400" };
    default:
      return { dot: "#9ca3af", stroke: "#6b7280", bg: "#1f2937", text: "text-gray-400" };
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

const NETWORK_COLORS = [
  { fill: "#7c3aed20", stroke: "#7c3aed", text: "#a78bfa", label: "text-purple-400" },
  { fill: "#3b82f620", stroke: "#3b82f6", text: "#60a5fa", label: "text-blue-400" },
  { fill: "#06b6d420", stroke: "#06b6d4", text: "#22d3ee", label: "text-cyan-400" },
  { fill: "#14b8a620", stroke: "#14b8a6", text: "#2dd4bf", label: "text-teal-400" },
  { fill: "#6366f120", stroke: "#6366f1", text: "#818cf8", label: "text-indigo-400" },
  { fill: "#ec489920", stroke: "#ec4899", text: "#f472b6", label: "text-pink-400" },
];

// ─── Layout constants ───

const NET_CARD_W = 220;
const NET_CARD_H = 60;
const CONT_CARD_W = 180;
const CONT_CARD_H = 70;
const NET_GAP_X = 280;
const CONT_GAP_X = 200;
const NET_Y = 30;
const CONT_Y = 160;
const PADDING = 40;

// ─── SVG Container Card ───

function SvgContainerCard({
  container,
  x,
  y,
  onAction,
  actionLoading,
}: {
  container: DockerNetworkContainer;
  x: number;
  y: number;
  onAction: (id: string, action: "start" | "stop" | "restart") => void;
  actionLoading: string | null;
}) {
  const colors = containerStateColor(container.state);
  const isRunning = container.state?.toLowerCase() === "running";
  const [hovered, setHovered] = useState(false);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: "pointer" }}
    >
      {/* Card background */}
      <rect
        x={x}
        y={y}
        width={CONT_CARD_W}
        height={hovered ? CONT_CARD_H + 30 : CONT_CARD_H}
        rx={10}
        fill={colors.bg}
        stroke={hovered ? colors.stroke : "#374151"}
        strokeWidth={hovered ? 2 : 1}
        style={{ transition: "all 0.2s ease" }}
      />

      {/* Status indicator bar */}
      <rect
        x={x}
        y={y}
        width={4}
        height={hovered ? CONT_CARD_H + 30 : CONT_CARD_H}
        rx={2}
        fill={colors.dot}
      />

      {/* Status dot */}
      <circle cx={x + 20} cy={y + 18} r={4} fill={colors.dot} />

      {/* Container name */}
      <text
        x={x + 32}
        y={y + 22}
        fill="white"
        fontSize={12}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
      >
        {container.name.length > 16
          ? container.name.slice(0, 15) + "…"
          : container.name}
      </text>

      {/* Status badge */}
      <text
        x={x + 20}
        y={y + 42}
        fill={colors.dot}
        fontSize={10}
        fontFamily="system-ui, sans-serif"
      >
        {stateLabel(container.state)}
      </text>

      {/* IP address */}
      {container.ipv4 && (
        <text
          x={x + 80}
          y={y + 42}
          fill="#9ca3af"
          fontSize={9}
          fontFamily="monospace"
        >
          {container.ipv4}
        </text>
      )}

      {/* Image name */}
      {container.image && (
        <text
          x={x + 20}
          y={y + 58}
          fill="#6b7280"
          fontSize={9}
          fontFamily="monospace"
        >
          {container.image.length > 22
            ? container.image.slice(0, 21) + "…"
            : container.image}
        </text>
      )}

      {/* Action buttons — appear on hover */}
      {hovered && (
        <g>
          {isRunning ? (
            <>
              <rect
                x={x + 16}
                y={y + CONT_CARD_H + 4}
                width={48}
                height={20}
                rx={4}
                fill="#dc262630"
                stroke="#dc262650"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onClick={() => onAction(container.name, "stop")}
              />
              <text
                x={x + 27}
                y={y + CONT_CARD_H + 18}
                fill="#f87171"
                fontSize={9}
                fontWeight={500}
                fontFamily="system-ui"
                style={{ pointerEvents: "none" }}
              >
                Stop
              </text>

              <rect
                x={x + 72}
                y={y + CONT_CARD_H + 4}
                width={60}
                height={20}
                rx={4}
                fill="#d9770630"
                stroke="#d9770650"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onClick={() => onAction(container.name, "restart")}
              />
              <text
                x={x + 80}
                y={y + CONT_CARD_H + 18}
                fill="#fbbf24"
                fontSize={9}
                fontWeight={500}
                fontFamily="system-ui"
                style={{ pointerEvents: "none" }}
              >
                Restart
              </text>
            </>
          ) : (
            <>
              <rect
                x={x + 16}
                y={y + CONT_CARD_H + 4}
                width={48}
                height={20}
                rx={4}
                fill="#05966830"
                stroke="#05966850"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onClick={() => onAction(container.name, "start")}
              />
              <text
                x={x + 27}
                y={y + CONT_CARD_H + 18}
                fill="#34d399"
                fontSize={9}
                fontWeight={500}
                fontFamily="system-ui"
                style={{ pointerEvents: "none" }}
              >
                Start
              </text>
            </>
          )}
        </g>
      )}
    </g>
  );
}

// ─── Main Flowchart View ───

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
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

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

  // ── Compute layout ──
  const networksWithContainers = topology.networks.filter(n => n.containers.length > 0);
  const allContainers = topology.networks.flatMap((n) => n.containers);
  const totalContainers = allContainers.length;
  const runningContainers = allContainers.filter(c => c.state?.toLowerCase() === "running").length;
  const stoppedContainers = allContainers.filter(c => c.state?.toLowerCase() === "exited" || c.state?.toLowerCase() === "dead").length;
  const listeningPorts = topology.hostPorts.filter(p => p.localPort > 0 && p.process);

  // Calculate positions for flowchart layout
  let maxContainersInRow = 0;
  networksWithContainers.forEach(n => {
    if (n.containers.length > maxContainersInRow) maxContainersInRow = n.containers.length;
  });

  const svgWidth = Math.max(
    networksWithContainers.length * NET_GAP_X + PADDING * 2,
    maxContainersInRow * CONT_GAP_X + PADDING * 2,
    800
  );
  const svgHeight = CONT_Y + CONT_CARD_H + 60 + PADDING;

  return (
    <div className="space-y-6">
      {/* ── Summary Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Network className="h-4 w-4 text-purple-400" />
            <span className="text-xs text-gray-400">Networks</span>
            <span className="text-sm font-semibold text-white">{topology.networks.length}</span>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Box className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-gray-400">Containers</span>
            <span className="text-sm font-semibold text-white">{totalContainers}</span>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <div className="h-2 w-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
            <span className="text-xs text-gray-400">Running</span>
            <span className="text-sm font-semibold text-emerald-400">{runningContainers}</span>
          </div>
          {stoppedContainers > 0 && (
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
              <div className="h-2 w-2 rounded-full bg-red-400 ring-4 ring-red-400/20" />
              <span className="text-xs text-gray-400">Stopped</span>
              <span className="text-sm font-semibold text-red-400">{stoppedContainers}</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
            <Globe className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-gray-400">Ports</span>
            <span className="text-sm font-semibold text-white">{listeningPorts.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg border border-gray-700 p-0.5">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-500 px-1 min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Reset zoom"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchTopology}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
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

      {/* ── Flowchart SVG ── */}
      {networksWithContainers.length === 0 && topology.networks.length > 0 ? (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center">
          <Box className="h-8 w-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No containers connected to any network</p>
          <p className="text-xs text-gray-600 mt-1">
            {topology.networks.length} empty network(s) found
          </p>
        </div>
      ) : (
        <div className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-x-auto">
          <svg
            ref={svgRef}
            width={svgWidth * zoom}
            height={svgHeight * zoom}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full"
            style={{ minHeight: 300 }}
          >
            {/* Background grid pattern */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Render networks and connections */}
            {networksWithContainers.map((net, netIdx) => {
              const netColor = NETWORK_COLORS[netIdx % NETWORK_COLORS.length];
              const netX = PADDING + netIdx * NET_GAP_X + (NET_GAP_X - NET_CARD_W) / 2;
              const netCenterX = netX + NET_CARD_W / 2;
              const netBottomY = NET_Y + NET_CARD_H;

              // Position containers evenly below their network
              const contCount = net.containers.length;
              const totalContW = contCount * CONT_CARD_W + (contCount - 1) * 20;
              const contStartX = netCenterX - totalContW / 2;

              return (
                <g key={net.id}>
                  {/* Network card */}
                  <rect
                    x={netX}
                    y={NET_Y}
                    width={NET_CARD_W}
                    height={NET_CARD_H}
                    rx={12}
                    fill={netColor.fill}
                    stroke={netColor.stroke}
                    strokeWidth={1.5}
                  />
                  {/* Network icon placeholder (circle) */}
                  <circle
                    cx={netX + 22}
                    cy={NET_Y + NET_CARD_H / 2}
                    r={8}
                    fill={netColor.stroke}
                    opacity={0.3}
                  />
                  <text
                    x={netX + 22}
                    y={NET_Y + NET_CARD_H / 2 + 4}
                    fill={netColor.text}
                    fontSize={10}
                    textAnchor="middle"
                    fontFamily="system-ui"
                  >
                    🌐
                  </text>

                  {/* Network name */}
                  <text
                    x={netX + 38}
                    y={NET_Y + 24}
                    fill={netColor.text}
                    fontSize={13}
                    fontWeight={600}
                    fontFamily="system-ui, sans-serif"
                  >
                    {net.name.length > 16 ? net.name.slice(0, 15) + "…" : net.name}
                  </text>

                  {/* Driver label */}
                  <text
                    x={netX + 38}
                    y={NET_Y + 42}
                    fill="#9ca3af"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                  >
                    {net.driver} · {contCount} container{contCount !== 1 ? "s" : ""}
                  </text>

                  {/* Connection lines from network to containers */}
                  {net.containers.map((cont, contIdx) => {
                    const contX = contStartX + contIdx * (CONT_CARD_W + 20);
                    const contCenterX = contX + CONT_CARD_W / 2;
                    const contTopY = CONT_Y;

                    // Curved connection line
                    const midY = netBottomY + (contTopY - netBottomY) / 2;

                    return (
                      <g key={cont.id || cont.name}>
                        {/* Connection path */}
                        <path
                          d={`M ${netCenterX} ${netBottomY} C ${netCenterX} ${midY}, ${contCenterX} ${midY}, ${contCenterX} ${contTopY}`}
                          fill="none"
                          stroke={netColor.stroke}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          opacity={0.5}
                        />

                        {/* Connection dot at container end */}
                        <circle
                          cx={contCenterX}
                          cy={contTopY}
                          r={3}
                          fill={netColor.stroke}
                          opacity={0.7}
                        />

                        {/* Container card */}
                        <SvgContainerCard
                          container={cont}
                          x={contX}
                          y={contTopY}
                          onAction={handleContainerAction}
                          actionLoading={actionLoading}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
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
