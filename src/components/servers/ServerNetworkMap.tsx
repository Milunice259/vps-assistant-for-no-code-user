"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Globe,
  Box,
  Network,
  RefreshCw,
  WifiOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Server,
  Info,
  Container,
} from "lucide-react";
import type {
  NetworkTopology,
  ApiResponse,
  DockerNetworkInfo,
  PortInfo,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/* ══════════════════════════════════════════════════════════
   Color palettes
   ══════════════════════════════════════════════════════════ */

const NETWORK_PALETTE = [
  { bg: "#7c3aed", bgFade: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.4)", text: "#c4b5fd" },
  { bg: "#3b82f6", bgFade: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.4)", text: "#93c5fd" },
  { bg: "#06b6d4", bgFade: "rgba(6,182,212,0.12)", border: "rgba(6,182,212,0.4)", text: "#67e8f9" },
  { bg: "#14b8a6", bgFade: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.4)", text: "#5eead4" },
  { bg: "#f59e0b", bgFade: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", text: "#fde68a" },
  { bg: "#ec4899", bgFade: "rgba(236,72,153,0.12)", border: "rgba(236,72,153,0.4)", text: "#f9a8d4" },
];

function containerStatusColor(state?: string) {
  switch (state?.toLowerCase()) {
    case "running": return { dot: "#34d399", bg: "rgba(5,150,105,0.15)", border: "rgba(52,211,153,0.3)", label: "Running" };
    case "exited": case "dead": return { dot: "#f87171", bg: "rgba(220,38,38,0.12)", border: "rgba(248,113,113,0.3)", label: "Stopped" };
    case "restarting": return { dot: "#fbbf24", bg: "rgba(217,119,6,0.12)", border: "rgba(251,191,36,0.3)", label: "Restarting" };
    case "paused": return { dot: "#fb923c", bg: "rgba(234,88,12,0.12)", border: "rgba(251,146,60,0.3)", label: "Paused" };
    default: return { dot: "#9ca3af", bg: "rgba(107,114,128,0.12)", border: "rgba(156,163,175,0.3)", label: state || "Unknown" };
  }
}

/* ══════════════════════════════════════════════════════════
   Port helpers
   ══════════════════════════════════════════════════════════ */

/** Parse port string like "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp" */
function parsePortString(ports?: string): { host: number; container: number; proto: string }[] {
  if (!ports) return [];
  const results: { host: number; container: number; proto: string }[] = [];
  const parts = ports.split(",").map(s => s.trim());
  for (const part of parts) {
    const match = part.match(/:(\d+)->(\d+)\/(tcp|udp)/i);
    if (match) {
      results.push({ host: parseInt(match[1]), container: parseInt(match[2]), proto: match[3] });
    }
  }
  return results;
}

function formatPortsBadge(ports?: string): string {
  const parsed = parsePortString(ports);
  if (parsed.length === 0) return "";
  return parsed.map(p => `:${p.host}`).join(", ");
}

/* ══════════════════════════════════════════════════════════
   Layout computation — top-down tree
   ══════════════════════════════════════════════════════════ */

interface CardRect {
  id: string;
  type: "internet" | "server" | "network" | "container";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeDef {
  fromId: string;
  toId: string;
  color: string;
  label?: string;
}

const INTERNET_W = 160;
const INTERNET_H = 60;
const SERVER_W = 180;
const SERVER_H = 70;
const NETWORK_W = 220;
const NETWORK_H = 64;
const CONTAINER_W = 280;
const CONTAINER_H = 100;

const ROW_GAP = 80;
const COL_GAP = 24;

interface LayoutResult {
  cards: CardRect[];
  edges: EdgeDef[];
  canvasW: number;
  canvasH: number;
}

function computeLayout(
  networks: DockerNetworkInfo[],
  hostPorts: PortInfo[],
): LayoutResult {
  const cards: CardRect[] = [];
  const edges: EdgeDef[] = [];

  const PADDING = 60;
  let row0Y = PADDING;

  // Row 0: Internet
  const internetId = "internet";

  // Row 1: Server
  const serverId = "server";
  const row1Y = row0Y + INTERNET_H + ROW_GAP;

  // Row 2: Networks
  const netsWithContainers = networks.filter(n => n.containers.length > 0);
  const emptyNets = networks.filter(n => n.containers.length === 0);
  const orderedNets = [...netsWithContainers, ...emptyNets];
  const row2Y = row1Y + SERVER_H + ROW_GAP;

  // Row 3: Containers (per network column)
  const row3Y = row2Y + NETWORK_H + ROW_GAP;

  // Calculate widths needed for each network column (based on container count)
  const netColumnWidths: number[] = orderedNets.map(net => {
    const contCount = net.containers.length;
    if (contCount === 0) return NETWORK_W;
    return Math.max(NETWORK_W, contCount * (CONTAINER_W + COL_GAP) - COL_GAP);
  });

  const totalNetsWidth = netColumnWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, orderedNets.length - 1) * COL_GAP * 2;
  const canvasW = Math.max(totalNetsWidth + PADDING * 2, 600);

  // Place Internet card
  cards.push({
    id: internetId,
    type: "internet",
    x: canvasW / 2 - INTERNET_W / 2,
    y: row0Y,
    w: INTERNET_W,
    h: INTERNET_H,
  });

  // Place Server card
  cards.push({
    id: serverId,
    type: "server",
    x: canvasW / 2 - SERVER_W / 2,
    y: row1Y,
    w: SERVER_W,
    h: SERVER_H,
  });

  // Edge: Internet → Server
  const openPorts = hostPorts.filter(p => p.localPort > 0 && p.process);
  const portLabels = openPorts.length > 0
    ? openPorts.slice(0, 5).map(p => `:${p.localPort}`).join("  ") + (openPorts.length > 5 ? ` +${openPorts.length - 5}` : "")
    : "";
  edges.push({ fromId: internetId, toId: serverId, color: "#f59e0b", label: portLabels || undefined });

  // Place Network cards
  let netStartX = (canvasW - totalNetsWidth) / 2;

  orderedNets.forEach((net, i) => {
    const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
    const colW = netColumnWidths[i];
    const netX = netStartX + colW / 2 - NETWORK_W / 2;
    const netId = `net-${net.id}`;

    cards.push({
      id: netId,
      type: "network",
      x: netX,
      y: row2Y,
      w: NETWORK_W,
      h: NETWORK_H,
    });

    edges.push({ fromId: serverId, toId: netId, color: palette.bg });

    // Place containers in this column
    const contCount = net.containers.length;
    if (contCount > 0) {
      const contsWidth = contCount * (CONTAINER_W + COL_GAP) - COL_GAP;
      let contStartX = netStartX + colW / 2 - contsWidth / 2;

      net.containers.forEach((cont, ci) => {
        const contId = `cont-${cont.id || cont.name}-${i}`;
        const cx = contStartX + ci * (CONTAINER_W + COL_GAP);

        cards.push({
          id: contId,
          type: "container",
          x: cx,
          y: row3Y,
          w: CONTAINER_W,
          h: CONTAINER_H,
        });

        const portStr = formatPortsBadge(cont.ports);
        edges.push({ fromId: netId, toId: contId, color: palette.bg, label: portStr || undefined });
      });
    }

    netStartX += colW + COL_GAP * 2;
  });

  // Calculate canvas height
  const hasContainers = orderedNets.some(n => n.containers.length > 0);
  const canvasH = (hasContainers ? row3Y + CONTAINER_H : row2Y + NETWORK_H) + PADDING;

  return { cards, edges, canvasW, canvasH };
}

/* ══════════════════════════════════════════════════════════
   SVG edge with port label
   ══════════════════════════════════════════════════════════ */

function SvgEdge({
  from,
  to,
  color,
  label,
}: {
  from: CardRect;
  to: CardRect;
  color: string;
  label?: string;
}) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;

  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

  const labelX = (x1 + x2) / 2;
  const labelY = midY - 4;

  return (
    <g>
      {/* Shadow */}
      <path d={pathD} fill="none" stroke={`${color}15`} strokeWidth={6} />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={`${color}50`}
        strokeWidth={2}
        strokeDasharray="6 4"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="2s"
          repeatCount="indefinite"
        />
      </path>
      {/* Start dot */}
      <circle cx={x1} cy={y1} r={3} fill={color} opacity={0.5} />
      {/* End dot */}
      <circle cx={x2} cy={y2} r={3} fill={color} opacity={0.7} />
      {/* Port label */}
      {label && (
        <g>
          <rect
            x={labelX - Math.max(label.length * 3.5, 20) - 8}
            y={labelY - 10}
            width={Math.max(label.length * 7, 40) + 16}
            height={18}
            rx={9}
            fill="#1e293b"
            stroke={`${color}40`}
            strokeWidth={1}
          />
          <text
            x={labelX}
            y={labelY + 2}
            textAnchor="middle"
            fill={color}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
            fontWeight={600}
          >
            <title>{label}</title>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

/* ══════════════════════════════════════════════════════════
   HTML Card components
   ══════════════════════════════════════════════════════════ */

function InternetCard({ card }: { card: CardRect }) {
  return (
    <div
      className="absolute flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 backdrop-blur-sm cursor-default select-none transition-all hover:border-amber-400/50 hover:shadow-lg hover:shadow-amber-500/10"
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
    >
      <Globe className="h-5 w-5 text-amber-400" />
      <span className="text-sm font-semibold text-amber-200">Internet</span>
    </div>
  );
}

function ServerCard({ card, hostname }: { card: CardRect; hostname?: string }) {
  return (
    <div
      className="absolute flex items-center gap-3 rounded-2xl border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 backdrop-blur-sm px-4 cursor-default select-none transition-all hover:border-blue-400/50 hover:shadow-lg hover:shadow-blue-500/10"
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
    >
      <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
        <Server className="h-5 w-5 text-blue-400" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white truncate" title={hostname || "Server"}>{hostname || "Server"}</p>
        <p className="text-[10px] text-blue-300/60">Docker Host</p>
      </div>
    </div>
  );
}

function NetworkCard({
  card,
  net,
  colorIdx,
}: {
  card: CardRect;
  net: DockerNetworkInfo;
  colorIdx: number;
}) {
  const palette = NETWORK_PALETTE[colorIdx % NETWORK_PALETTE.length];

  return (
    <div
      className="absolute rounded-xl border backdrop-blur-sm px-3.5 py-2.5 cursor-default select-none transition-all hover:shadow-lg group"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        backgroundColor: palette.bgFade,
        borderColor: palette.border,
      }}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${palette.bg}20`, border: `1px solid ${palette.bg}40` }}
        >
          <Network className="h-3.5 w-3.5" style={{ color: palette.bg }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate" title={net.name}>{net.name}</p>
          <p className="text-[10px] text-gray-400" title={`${net.driver} · ${net.containers.length} container(s): ${net.containers.map(c => c.name).join(', ')}`}>
            {net.driver} · {net.containers.length} app{net.containers.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function ContainerCard({
  card,
  container,
  onSelect,
}: {
  card: CardRect;
  container: { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string };
  onSelect?: (container: { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string }) => void;
}) {
  const status = containerStatusColor(container.state);
  const ports = parsePortString(container.ports);
  const fullInfo = [container.name, container.image, container.ipv4, container.ports].filter(Boolean).join(' | ');

  return (
    <div
      className="absolute rounded-xl border backdrop-blur-sm px-3.5 py-3 cursor-pointer select-none transition-all hover:shadow-lg hover:brightness-110 group"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        backgroundColor: status.bg,
        borderColor: status.border,
      }}
      title={fullInfo}
      onClick={(e) => { e.stopPropagation(); onSelect?.(container); }}
    >
      {/* Status bar left */}
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full" style={{ backgroundColor: status.dot }} />

      <div className="ml-2 space-y-1">
        {/* Row 1: Name + status */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: status.dot }} />
          <p className="text-xs font-semibold text-white truncate flex-1" title={container.name}>{container.name}</p>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
            style={{ color: status.dot, backgroundColor: `${status.dot}15` }}
          >
            {status.label}
          </span>
        </div>

        {/* Row 2: Image */}
        {container.image && (
          <p className="text-[10px] text-gray-500 font-mono truncate pl-4" title={container.image}>
            {container.image.split(":")[0]?.split("/").pop()}
            {container.image.includes(":") ? `:${container.image.split(":")[1]}` : ""}
          </p>
        )}

        {/* Row 3: IP + Ports */}
        <div className="flex items-center gap-2 pl-4 flex-wrap">
          {container.ipv4?.trim() && (
            <span className="text-[10px] text-gray-500 font-mono">
              {container.ipv4.trim()}
            </span>
          )}
          {ports.length > 0 && (
            <div className="flex items-center gap-1">
              {ports.slice(0, 4).map((p, i) => (
                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">
                  :{p.host}→{p.container}
                </span>
              ))}
              {ports.length > 4 && (
                <span className="text-[9px] text-gray-600">+{ports.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Detail row for container info panel
   ══════════════════════════════════════════════════════════ */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-sm text-white font-mono break-all">{value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Summary stat
   ══════════════════════════════════════════════════════════ */

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5 border border-gray-700">
      <span className={color}>{icon}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

interface ServerNetworkMapProps {
  serverId: string;
}

export function ServerNetworkMap({ serverId }: ServerNetworkMapProps) {
  const [topology, setTopology] = useState<NetworkTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string } | null>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

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
        throw new Error(json.error || "Failed to load network data");
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

  /* ─── Mouse drag handlers ─── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /* ─── Scroll zoom ─── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(z => Math.min(2, Math.max(0.3, z + delta)));
  }, []);

  /* ─── Zoom controls ─── */
  const zoomIn = () => setZoom(z => Math.min(2, z + 0.15));
  const zoomOut = () => setZoom(z => Math.max(0.3, z - 0.15));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading network map...</p>
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
          <p className="text-xs text-gray-500 mt-1">Cannot connect to server</p>
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

  // ── Compute data ──
  const allContainers = topology.networks.flatMap(n => n.containers);
  const totalContainers = allContainers.length;
  const runningContainers = allContainers.filter(c => c.state?.toLowerCase() === "running").length;
  const stoppedContainers = allContainers.filter(c => ["exited", "dead"].includes(c.state?.toLowerCase() || "")).length;
  const listeningPorts = topology.hostPorts.filter(p => p.localPort > 0 && p.process);

  // Compute layout
  const { cards, edges, canvasW, canvasH } = computeLayout(topology.networks, topology.hostPorts);
  const cardMap = new Map(cards.map(c => [c.id, c]));

  // Flatten containers indexed by network
  const netsWithContainers = topology.networks.filter(n => n.containers.length > 0);
  const emptyNets = topology.networks.filter(n => n.containers.length === 0);
  const orderedNets = [...netsWithContainers, ...emptyNets];

  // Build a lookup of container data by card id
  const containerDataMap = new Map<string, typeof allContainers[number]>();
  orderedNets.forEach((net, i) => {
    net.containers.forEach(cont => {
      containerDataMap.set(`cont-${cont.id || cont.name}-${i}`, cont);
    });
  });

  return (
    <div className="space-y-4">
      {/* ── Summary Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <StatChip icon={<Network className="h-3.5 w-3.5" />} label="Networks" value={topology.networks.length} color="text-purple-400" />
          <StatChip icon={<Box className="h-3.5 w-3.5" />} label="Apps" value={totalContainers} color="text-blue-400" />
          <StatChip icon={<Container className="h-3.5 w-3.5" />} label="Running" value={runningContainers} color="text-emerald-400" />
          {stoppedContainers > 0 && (
            <StatChip icon={<Box className="h-3.5 w-3.5" />} label="Stopped" value={stoppedContainers} color="text-red-400" />
          )}
          <StatChip icon={<Globe className="h-3.5 w-3.5" />} label="Open Ports" value={listeningPorts.length} color="text-amber-400" />
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 bg-gray-800 rounded-lg border border-gray-700 p-0.5">
            <button onClick={zoomOut} className="p-1.5 text-gray-400 hover:text-white transition-colors rounded" title="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-500 px-1 min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={zoomIn} className="p-1.5 text-gray-400 hover:text-white transition-colors rounded" title="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button onClick={resetView} className="p-1.5 text-gray-400 hover:text-white transition-colors rounded" title="Reset view">
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

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          <span>Drag to pan · Scroll to zoom</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Running</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Stopped</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Ports exposed</span>
        </div>
      </div>

      {/* ── Map Viewport ── */}
      <div
        ref={viewportRef}
        className="bg-gray-900/50 rounded-xl border border-gray-700 overflow-hidden relative"
        style={{ height: Math.min(canvasH * zoom + 40, 700), cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {cards.length <= 2 ? (
          <div className="flex flex-col items-center gap-3 py-16 h-full justify-center">
            <Network className="h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-400">No Docker networks found</p>
            <p className="text-xs text-gray-600">This server has no internal networks configured</p>
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top center",
              width: canvasW,
              height: canvasH,
              position: "relative",
              transition: isDragging ? "none" : "transform 0.15s ease-out",
            }}
          >
            {/* Background grid pattern */}
            <svg
              width={canvasW}
              height={canvasH}
              className="absolute inset-0 pointer-events-none"
            >
              <defs>
                <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f293720" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mapGrid)" />

              {/* Render edges */}
              {edges.map((edge, i) => {
                const fromCard = cardMap.get(edge.fromId);
                const toCard = cardMap.get(edge.toId);
                if (!fromCard || !toCard) return null;
                return (
                  <SvgEdge
                    key={`edge-${i}`}
                    from={fromCard}
                    to={toCard}
                    color={edge.color}
                    label={edge.label}
                  />
                );
              })}
            </svg>

            {/* Render HTML cards */}
            {cards.map(card => {
              if (card.type === "internet") {
                return <InternetCard key={card.id} card={card} />;
              }
              if (card.type === "server") {
                return <ServerCard key={card.id} card={card} hostname={topology.networks[0]?.containers[0]?.name ? "Docker Host" : "Server"} />;
              }
              if (card.type === "network") {
                const netIdx = parseInt(card.id.replace("net-", "")) || 0;
                const netData = orderedNets.find(n => card.id === `net-${n.id}`);
                if (!netData) return null;
                const colorIdx = orderedNets.indexOf(netData);
                return <NetworkCard key={card.id} card={card} net={netData} colorIdx={colorIdx >= 0 ? colorIdx : 0} />;
              }
              if (card.type === "container") {
                const contData = containerDataMap.get(card.id);
                if (!contData) return null;
                return <ContainerCard key={card.id} card={card} container={contData} onSelect={setSelectedContainer} />;
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* ── Selected Container Detail Panel ── */}
      {selectedContainer && (
        <div className="relative bg-gray-800/80 backdrop-blur-sm rounded-xl border border-gray-700 p-4">
          <button
            onClick={() => setSelectedContainer(null)}
            className="absolute top-3 right-3 text-gray-500 hover:text-white text-sm transition-colors"
          >
            ✕
          </button>
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Box className="h-4 w-4 text-blue-400" />
            Container Detail
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <DetailRow label="Name" value={selectedContainer.name} />
            <DetailRow label="Status" value={containerStatusColor(selectedContainer.state).label} />
            {selectedContainer.image && <DetailRow label="Image" value={selectedContainer.image} />}
            {selectedContainer.ipv4?.trim() && <DetailRow label="IP Address" value={selectedContainer.ipv4.trim()} />}
            {selectedContainer.ports && <DetailRow label="Ports" value={selectedContainer.ports} />}
            {selectedContainer.id && <DetailRow label="Container ID" value={selectedContainer.id} />}
          </div>
        </div>
      )}

      {/* ── Open Ports Detail ── */}
      {listeningPorts.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
          <h4 className="text-sm font-medium text-gray-300 mb-1 flex items-center gap-2">
            <Globe className="h-4 w-4 text-amber-400" />
            Open Ports
          </h4>
          <p className="text-xs text-gray-500 mb-3">
            Ports currently listening for external connections.
          </p>
          <div className="flex flex-wrap gap-2">
            {listeningPorts.map((p, i) => (
              <div
                key={`${p.protocol}-${p.localPort}-${i}`}
                className="flex items-center gap-2 bg-gray-900/70 border border-gray-700/50 rounded-lg px-3 py-2 hover:border-amber-500/30 transition-colors"
              >
                <Badge variant="info">{p.protocol.toUpperCase()}</Badge>
                <span className="text-white text-sm font-mono font-semibold">:{p.localPort}</span>
                {p.process && (
                  <span className="text-xs text-gray-500 truncate max-w-[120px]">{p.process}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Network Details (collapsible cards) ── */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
          <Server className="h-4 w-4" />
          Network Details
        </h4>
        {orderedNets.map((net, i) => {
          const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
          return (
            <div key={net.id} className="bg-gray-900 border border-gray-700/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: palette.bg }} />
                <span className="text-sm font-medium text-white">{net.name}</span>
                <Badge variant="default">{net.driver}</Badge>
                <span className="text-xs text-gray-500 ml-auto">
                  {net.containers.length} container{net.containers.length !== 1 ? "s" : ""}
                </span>
              </div>

              {net.containers.length === 0 ? (
                <p className="text-xs text-gray-600 italic">No containers in this network</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {net.containers.map(cont => {
                    const colors = containerStatusColor(cont.state);
                    return (
                      <div key={cont.id || cont.name} className="flex items-start gap-2 bg-gray-800/60 rounded-lg p-2.5 border border-gray-700/40 cursor-pointer hover:bg-gray-800 hover:border-gray-600 transition-colors" onClick={() => setSelectedContainer(cont)} title="Click to view full details">
                        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: colors.dot }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-200 break-all" title={cont.name}>{cont.name}</p>
                          <p className="text-[10px] text-gray-500 break-all" title={cont.image || "—"}>{cont.image || "—"}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] font-medium" style={{ color: colors.dot }}>
                              {colors.label}
                            </span>
                            {cont.ipv4?.trim() && (
                              <span className="text-[10px] text-gray-600 font-mono">{cont.ipv4.trim()}</span>
                            )}
                            {cont.ports && (
                              <span className="text-[10px] text-amber-400/70 font-mono" title={cont.ports}>{formatPortsBadge(cont.ports)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
