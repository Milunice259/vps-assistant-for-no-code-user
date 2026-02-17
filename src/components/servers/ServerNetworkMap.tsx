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
  Wifi,
  Info,
} from "lucide-react";
import type {
  NetworkTopology,
  ApiResponse,
  DockerNetworkInfo,
  DockerNetworkContainer,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/* ══════════════════════════════════════════════════════════
   Color helpers
   ══════════════════════════════════════════════════════════ */

const NETWORK_PALETTE = [
  { bg: "#7c3aed", bgFade: "#7c3aed25", text: "#c4b5fd", label: "purple" },
  { bg: "#3b82f6", bgFade: "#3b82f625", text: "#93c5fd", label: "blue" },
  { bg: "#06b6d4", bgFade: "#06b6d425", text: "#67e8f9", label: "cyan" },
  { bg: "#14b8a6", bgFade: "#14b8a625", text: "#5eead4", label: "teal" },
  { bg: "#f59e0b", bgFade: "#f59e0b25", text: "#fde68a", label: "amber" },
  { bg: "#ec4899", bgFade: "#ec489925", text: "#f9a8d4", label: "pink" },
];

function containerColor(state?: string) {
  switch (state?.toLowerCase()) {
    case "running":
      return { dot: "#34d399", ring: "#059669", bg: "#064e3b" };
    case "exited":
    case "dead":
      return { dot: "#f87171", ring: "#dc2626", bg: "#450a0a" };
    case "restarting":
      return { dot: "#fbbf24", ring: "#d97706", bg: "#451a03" };
    case "paused":
      return { dot: "#fb923c", ring: "#ea580c", bg: "#431407" };
    default:
      return { dot: "#9ca3af", ring: "#6b7280", bg: "#1f2937" };
  }
}

function stateEmoji(state?: string) {
  switch (state?.toLowerCase()) {
    case "running": return "✅";
    case "exited": case "dead": return "⛔";
    case "restarting": return "🔄";
    case "paused": return "⏸️";
    default: return "❓";
  }
}

function stateLabel(state?: string) {
  switch (state?.toLowerCase()) {
    case "running": return "Đang chạy";
    case "exited": case "dead": return "Đã dừng";
    case "restarting": return "Đang khởi động lại";
    case "paused": return "Tạm dừng";
    case "created": return "Đã tạo";
    default: return state || "Không rõ";
  }
}

/* ══════════════════════════════════════════════════════════
   Layout computation — radial tree
   ══════════════════════════════════════════════════════════ */

interface LayoutNode {
  id: string;
  type: "server" | "network" | "container";
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  color: string;
  bgColor: string;
  state?: string;
  ip?: string;
  image?: string;
  ports?: string;
  networkIdx?: number;
  parentId?: string;
}

interface LayoutEdge {
  from: string;
  to: string;
  color: string;
}

function computeLayout(
  networks: DockerNetworkInfo[],
  width: number,
  height: number
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const centerX = width / 2;
  const centerY = height / 2;

  // Server node at center
  nodes.push({
    id: "server",
    type: "server",
    label: "Server",
    x: centerX,
    y: centerY,
    color: "#60a5fa",
    bgColor: "#1e3a5f",
  });

  const networksWithContainers = networks.filter((n) => n.containers.length > 0);
  const emptyNetworks = networks.filter((n) => n.containers.length === 0);

  if (networksWithContainers.length === 0 && emptyNetworks.length === 0) {
    return { nodes, edges };
  }

  // Place networks in a ring around the server
  const allNets = [...networksWithContainers, ...emptyNetworks];
  const netCount = allNets.length;
  const netRadius = Math.min(width, height) * 0.3;
  const startAngle = -Math.PI / 2; // Start from top

  allNets.forEach((net, i) => {
    const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
    const angle = startAngle + (2 * Math.PI * i) / netCount;
    const nx = centerX + netRadius * Math.cos(angle);
    const ny = centerY + netRadius * Math.sin(angle);

    const netId = `net-${net.id}`;
    nodes.push({
      id: netId,
      type: "network",
      label: net.name,
      sublabel: `${net.driver} · ${net.containers.length} app${net.containers.length !== 1 ? "s" : ""}`,
      x: nx,
      y: ny,
      color: palette.bg,
      bgColor: palette.bgFade,
      networkIdx: i,
    });
    edges.push({ from: "server", to: netId, color: palette.bg });

    // Place containers around this network
    const contCount = net.containers.length;
    if (contCount === 0) return;

    const contRadius = Math.min(width, height) * 0.18;
    // Spread containers in an arc facing outward from center
    const arcSpread = Math.min(Math.PI * 0.6, (Math.PI * 0.4 * contCount) / Math.max(contCount, 1));
    const contStartAngle = angle - arcSpread / 2;

    net.containers.forEach((cont, ci) => {
      const contAngle = contCount === 1
        ? angle
        : contStartAngle + (arcSpread * ci) / (contCount - 1);
      const cx = nx + contRadius * Math.cos(contAngle);
      const cy = ny + contRadius * Math.sin(contAngle);

      const contId = `cont-${cont.id || cont.name}-${i}`;
      const colors = containerColor(cont.state);
      nodes.push({
        id: contId,
        type: "container",
        label: cont.name,
        sublabel: cont.image?.split(":")[0]?.split("/").pop() || "",
        x: cx,
        y: cy,
        color: colors.dot,
        bgColor: colors.bg,
        state: cont.state,
        ip: cont.ipv4,
        image: cont.image,
        ports: cont.ports,
        networkIdx: i,
        parentId: netId,
      });
      edges.push({ from: netId, to: contId, color: palette.bg });
    });
  });

  return { nodes, edges };
}

/* ══════════════════════════════════════════════════════════
   SVG Tooltip (appears on hover)
   ══════════════════════════════════════════════════════════ */

function SvgTooltip({
  node,
  visible,
}: {
  node: LayoutNode;
  visible: boolean;
}) {
  if (!visible) return null;

  const lines: string[] = [];

  if (node.type === "server") {
    lines.push("🖥️ Đây là máy chủ (server) của bạn");
    lines.push("Tất cả ứng dụng đều chạy bên trong máy này");
  } else if (node.type === "network") {
    lines.push(`🌐 Mạng nội bộ "${node.label}"`);
    lines.push("Mạng là 'đường dây' kết nối các ứng dụng");
    lines.push("giúp chúng giao tiếp được với nhau");
    if (node.sublabel) lines.push(`📋 ${node.sublabel}`);
  } else if (node.type === "container") {
    lines.push(`📦 Ứng dụng "${node.label}"`);
    lines.push(`Trạng thái: ${stateEmoji(node.state)} ${stateLabel(node.state)}`);
    if (node.ip) lines.push(`🔗 Địa chỉ nội bộ: ${node.ip}`);
    if (node.image) lines.push(`📀 Image: ${node.image}`);
    if (node.ports) lines.push(`🚪 Cổng: ${node.ports}`);
  }

  const maxLen = Math.max(...lines.map((l) => l.length));
  const boxW = Math.min(maxLen * 7.5 + 20, 280);
  const boxH = lines.length * 18 + 16;
  const tx = node.x - boxW / 2;
  const ty = node.y - (node.type === "server" ? 60 : 50) - boxH;

  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={tx}
        y={ty}
        width={boxW}
        height={boxH}
        rx={8}
        fill="#1f2937"
        stroke="#374151"
        strokeWidth={1}
        opacity={0.97}
      />
      {/* Arrow */}
      <polygon
        points={`${node.x - 6},${ty + boxH} ${node.x + 6},${ty + boxH} ${node.x},${ty + boxH + 8}`}
        fill="#1f2937"
        stroke="#374151"
        strokeWidth={1}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={tx + 10}
          y={ty + 18 + i * 18}
          fill={i === 0 ? "#e5e7eb" : "#9ca3af"}
          fontSize={11}
          fontFamily="system-ui, sans-serif"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/* ══════════════════════════════════════════════════════════
   SVG Node renderers
   ══════════════════════════════════════════════════════════ */

function ServerNode({ node, hovered, onHover }: {
  node: LayoutNode;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  return (
    <g
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      {/* Pulse ring */}
      <circle cx={node.x} cy={node.y} r={40} fill="#3b82f610" stroke="none">
        <animate attributeName="r" values="38;44;38" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0.2;0.5" dur="3s" repeatCount="indefinite" />
      </circle>
      {/* Main circle */}
      <circle
        cx={node.x}
        cy={node.y}
        r={32}
        fill="#1e293b"
        stroke={hovered ? "#60a5fa" : "#334155"}
        strokeWidth={hovered ? 3 : 2}
      />
      {/* Server icon text */}
      <text
        x={node.x}
        y={node.y - 4}
        textAnchor="middle"
        fontSize={22}
        fill="white"
      >
        🖥️
      </text>
      <text
        x={node.x}
        y={node.y + 18}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={10}
        fontWeight={600}
        fontFamily="system-ui"
      >
        SERVER
      </text>
    </g>
  );
}

function NetworkNode({ node, hovered, onHover }: {
  node: LayoutNode;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const w = 140;
  const h = 50;
  return (
    <g
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={node.x - w / 2}
        y={node.y - h / 2}
        width={w}
        height={h}
        rx={12}
        fill={node.bgColor}
        stroke={hovered ? node.color : `${node.color}60`}
        strokeWidth={hovered ? 2.5 : 1.5}
        style={{ transition: "all 0.2s" }}
      />
      {/* Network icon */}
      <text
        x={node.x - w / 2 + 16}
        y={node.y - 2}
        fontSize={14}
      >
        🌐
      </text>
      {/* Name */}
      <text
        x={node.x - w / 2 + 32}
        y={node.y - 4}
        fill="white"
        fontSize={12}
        fontWeight={600}
        fontFamily="system-ui"
      >
        {node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}
      </text>
      {/* Sublabel */}
      {node.sublabel && (
        <text
          x={node.x - w / 2 + 32}
          y={node.y + 12}
          fill="#9ca3af"
          fontSize={9}
          fontFamily="system-ui"
        >
          {node.sublabel}
        </text>
      )}
    </g>
  );
}

function ContainerNode({ node, hovered, onHover }: {
  node: LayoutNode;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const colors = containerColor(node.state);
  const w = 130;
  const h = 46;
  return (
    <g
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={node.x - w / 2}
        y={node.y - h / 2}
        width={w}
        height={h}
        rx={10}
        fill={colors.bg}
        stroke={hovered ? colors.dot : `${colors.ring}50`}
        strokeWidth={hovered ? 2 : 1.5}
        style={{ transition: "all 0.2s" }}
      />
      {/* Status bar */}
      <rect
        x={node.x - w / 2}
        y={node.y - h / 2}
        width={3}
        height={h}
        rx={1.5}
        fill={colors.dot}
      />
      {/* Status dot */}
      <circle cx={node.x - w / 2 + 14} cy={node.y - 6} r={3.5} fill={colors.dot} />
      {/* Name */}
      <text
        x={node.x - w / 2 + 24}
        y={node.y - 2}
        fill="white"
        fontSize={11}
        fontWeight={600}
        fontFamily="system-ui"
      >
        {node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}
      </text>
      {/* Sublabel (image) */}
      <text
        x={node.x - w / 2 + 14}
        y={node.y + 13}
        fill="#6b7280"
        fontSize={8}
        fontFamily="monospace"
      >
        {(node.sublabel || "").length > 16
          ? (node.sublabel || "").slice(0, 15) + "…"
          : node.sublabel}
      </text>
    </g>
  );
}

/* ══════════════════════════════════════════════════════════
   Animated edge
   ══════════════════════════════════════════════════════════ */

function AnimatedEdge({ from, to, color }: {
  from: LayoutNode;
  to: LayoutNode;
  color: string;
}) {
  // Curved bezier path
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  // Offset control point slightly
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cp1x = from.x + dx * 0.3 - dy * 0.1;
  const cp1y = from.y + dy * 0.3 + dx * 0.1;
  const cp2x = from.x + dx * 0.7 + dy * 0.1;
  const cp2y = from.y + dy * 0.7 - dx * 0.1;

  const pathD = `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;

  return (
    <g>
      {/* Shadow line */}
      <path
        d={pathD}
        fill="none"
        stroke={`${color}20`}
        strokeWidth={4}
      />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={`${color}60`}
        strokeWidth={1.5}
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
      {/* Connection dot at target */}
      <circle cx={to.x} cy={to.y} r={3} fill={color} opacity={0.5} />
    </g>
  );
}

/* ══════════════════════════════════════════════════════════
   Stat card with tooltip (summary bar)
   ══════════════════════════════════════════════════════════ */

function StatCard({
  icon,
  label,
  value,
  color,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  tooltip: string;
}) {
  return (
    <div className="relative group flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700 cursor-help">
      <span className={color}>{icon}</span>
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {tooltip}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Port card (open ports section)
   ══════════════════════════════════════════════════════════ */

function PortCard({
  protocol,
  port,
  process,
}: {
  protocol: string;
  port: number;
  process: string;
}) {
  return (
    <div className="relative group flex items-center gap-2 bg-gray-900/70 border border-gray-700/50 rounded-lg px-3 py-2 hover:border-amber-500/30 transition-colors cursor-help">
      <Badge variant="info">{protocol.toUpperCase()}</Badge>
      <span className="text-white text-sm font-mono font-semibold">:{port}</span>
      {process && (
        <span className="text-xs text-gray-500 truncate max-w-[120px]">{process}</span>
      )}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        🚪 Cổng {port} đang mở — cho phép kết nối từ bên ngoài vào.
        {process ? ` Chương trình "${process}" đang lắng nghe ở đây.` : ""}
      </span>
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
  const [zoom, setZoom] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const SVG_W = 900;
  const SVG_H = 600;

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

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Đang tải sơ đồ mạng...</p>
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
          <p className="text-xs text-gray-500 mt-1">Không thể kết nối đến server</p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchTopology}>
          <RefreshCw className="h-4 w-4 mr-1" /> Thử lại
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
          <RefreshCw className="h-4 w-4 mr-1" /> Thử lại
        </Button>
      </div>
    );
  }

  if (!topology) return null;

  // ── Compute data ──
  const allContainers = topology.networks.flatMap((n) => n.containers);
  const totalContainers = allContainers.length;
  const runningContainers = allContainers.filter(
    (c) => c.state?.toLowerCase() === "running"
  ).length;
  const stoppedContainers = allContainers.filter(
    (c) => c.state?.toLowerCase() === "exited" || c.state?.toLowerCase() === "dead"
  ).length;
  const listeningPorts = topology.hostPorts.filter(
    (p) => p.localPort > 0 && p.process
  );

  // Compute layout
  const { nodes, edges } = computeLayout(topology.networks, SVG_W, SVG_H);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const hoveredNodeData = hoveredNode ? nodeMap.get(hoveredNode) : null;

  return (
    <div className="space-y-6">
      {/* ── Summary Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <StatCard
            icon={<Network className="h-4 w-4" />}
            label="Mạng"
            value={topology.networks.length}
            color="text-purple-400"
            tooltip="Mạng Docker giống như 'đường dây' nội bộ giúp các ứng dụng nói chuyện với nhau bên trong server."
          />
          <StatCard
            icon={<Box className="h-4 w-4" />}
            label="Ứng dụng"
            value={totalContainers}
            color="text-blue-400"
            tooltip="Mỗi ứng dụng chạy trong một 'container' riêng biệt — như từng phòng riêng, tách biệt với nhau."
          />
          <StatCard
            icon={<Wifi className="h-4 w-4" />}
            label="Đang chạy"
            value={runningContainers}
            color="text-emerald-400"
            tooltip="Số ứng dụng đang hoạt động và phục vụ người dùng."
          />
          {stoppedContainers > 0 && (
            <StatCard
              icon={<Box className="h-4 w-4" />}
              label="Đã dừng"
              value={stoppedContainers}
              color="text-red-400"
              tooltip="Ứng dụng đã ngừng hoạt động. Có thể khởi động lại từ tab Containers."
            />
          )}
          <StatCard
            icon={<Globe className="h-4 w-4" />}
            label="Cổng mở"
            value={listeningPorts.length}
            color="text-amber-400"
            tooltip="Cổng (port) là 'cửa ra vào' của server. Mỗi cổng mở cho phép kết nối từ internet vào."
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg border border-gray-700 p-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Thu nhỏ"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-500 px-1 min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Phóng to"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
              title="Đặt lại"
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

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          <span>Di chuột vào các thành phần sẽ hiện giải thích bằng tiếng Việt</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Đang chạy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400" /> Đã dừng
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400" /> Đang khởi động lại
          </span>
        </div>
      </div>

      {/* ── SVG Mindmap ── */}
      <div
        ref={containerRef}
        className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-x-auto"
      >
        {nodes.length <= 1 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Network className="h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-400">Không tìm thấy mạng Docker nào</p>
            <p className="text-xs text-gray-600">
              Server chưa có mạng nội bộ nào được tạo
            </p>
          </div>
        ) : (
          <svg
            width={SVG_W * zoom}
            height={SVG_H * zoom}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full"
            style={{ minHeight: 400 }}
          >
            {/* Background grid */}
            <defs>
              <pattern id="netGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
              </pattern>
              {/* Glow filter */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#netGrid)" />

            {/* Render edges first (below nodes) */}
            {edges.map((edge, i) => {
              const fromNode = nodeMap.get(edge.from);
              const toNode = nodeMap.get(edge.to);
              if (!fromNode || !toNode) return null;
              return (
                <AnimatedEdge
                  key={`edge-${i}`}
                  from={fromNode}
                  to={toNode}
                  color={edge.color}
                />
              );
            })}

            {/* Render nodes */}
            {nodes.map((node) => {
              const isHovered = hoveredNode === node.id;
              if (node.type === "server") {
                return (
                  <ServerNode
                    key={node.id}
                    node={node}
                    hovered={isHovered}
                    onHover={setHoveredNode}
                  />
                );
              }
              if (node.type === "network") {
                return (
                  <NetworkNode
                    key={node.id}
                    node={node}
                    hovered={isHovered}
                    onHover={setHoveredNode}
                  />
                );
              }
              return (
                <ContainerNode
                  key={node.id}
                  node={node}
                  hovered={isHovered}
                  onHover={setHoveredNode}
                />
              );
            })}

            {/* Tooltip overlay (rendered last = on top) */}
            {hoveredNodeData && (
              <SvgTooltip node={hoveredNodeData} visible={true} />
            )}
          </svg>
        )}
      </div>

      {/* ── Open Ports Section ── */}
      {listeningPorts.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
          <h4 className="text-sm font-medium text-gray-300 mb-1 flex items-center gap-2">
            <Globe className="h-4 w-4 text-amber-400" />
            Cổng đang mở
          </h4>
          <p className="text-xs text-gray-500 mb-3">
            Đây là các &quot;cửa&quot; cho phép truy cập từ bên ngoài vào server. Mỗi cổng tương ứng với một ứng dụng đang lắng nghe.
          </p>
          <div className="flex flex-wrap gap-2">
            {listeningPorts.map((p, i) => (
              <PortCard
                key={`${p.protocol}-${p.localPort}-${i}`}
                protocol={p.protocol}
                port={p.localPort}
                process={p.process}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Network Details (collapsible cards) ── */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
          <Server className="h-4 w-4" />
          Chi tiết từng mạng
        </h4>
        {topology.networks.map((net, i) => {
          const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
          return (
            <div
              key={net.id}
              className="bg-gray-900 border border-gray-700/60 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: palette.bg }}
                />
                <span className="text-sm font-medium text-white">{net.name}</span>
                <Badge variant="default">{net.driver}</Badge>
                <span className="text-xs text-gray-500 ml-auto">
                  {net.containers.length} container{net.containers.length !== 1 ? "s" : ""}
                </span>
              </div>

              {net.containers.length === 0 ? (
                <p className="text-xs text-gray-600 italic">Không có ứng dụng nào trong mạng này</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {net.containers.map((cont) => {
                    const colors = containerColor(cont.state);
                    return (
                      <div
                        key={cont.id || cont.name}
                        className="flex items-start gap-2 bg-gray-800/60 rounded-lg p-2.5 border border-gray-700/40"
                      >
                        <div
                          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: colors.dot }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-200 truncate">
                            {cont.name}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            {cont.image || "—"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className="text-[10px] font-medium"
                              style={{ color: colors.dot }}
                            >
                              {stateEmoji(cont.state)} {stateLabel(cont.state)}
                            </span>
                            {cont.ipv4 && (
                              <span className="text-[10px] text-gray-600 font-mono">
                                {cont.ipv4}
                              </span>
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
