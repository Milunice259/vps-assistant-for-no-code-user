"use client";

/**
 * ServerNetworkMap — Interactive Docker network topology viewer.
 *
 * Decomposed from the original monolith into focused modules:
 * - types.ts    — shared types, palettes, status helpers
 * - layout.ts   — pure layout computation
 * - SvgEdge.tsx — animated SVG connection lines
 * - cards.tsx   — visual card components
 */

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
  Info,
  Container,
  RotateCcw,
} from "lucide-react";
import type { NetworkTopology, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

import { containerStatusColor } from "./types";
import { computeLayout } from "./layout";
import { SvgEdge } from "./SvgEdge";
import {
  InternetCard,
  ServerCard,
  NetworkCard,
  ContainerCard,
  DetailRow,
  StatChip,
  NetworkDetailList,
} from "./cards";

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
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [lockedEdges, setLockedEdges] = useState<Record<string, boolean>>({});
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0, nodeX: 0, nodeY: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  const requestFitToContent = useCallback(() => {
    setFitRequest((current) => current + 1);
  }, []);

  const fitCanvasToViewport = useCallback((width: number, height: number) => {
    const viewport = viewportRef.current;
    if (!viewport || width <= 0 || height <= 0) return;

    const viewportWidth = viewport.clientWidth || 900;
    const viewportHeight = viewport.clientHeight || Math.min(height + 40, 700);
    const nextZoom = Math.min(1, Math.max(0.35, Math.min((viewportWidth - 48) / width, (viewportHeight - 48) / height)));
    const nextPan = {
      x: (viewportWidth - width * nextZoom) / 2,
      y: (viewportHeight - height * nextZoom) / 2,
    };

    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

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
      setNodePositions({});
      setLockedEdges({});
      requestFitToContent();
      if (json.warning) setWarning(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [requestFitToContent, serverId]);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  useEffect(() => {
    if (!topology || fitRequest === 0) return;
    const { canvasW: nextCanvasW, canvasH: nextCanvasH } = computeLayout(topology.networks, topology.hostPorts);
    const frame = requestAnimationFrame(() => fitCanvasToViewport(nextCanvasW, nextCanvasH));
    return () => cancelAnimationFrame(frame);
  }, [fitCanvasToViewport, fitRequest, topology]);

  /* ─── Mouse drag handlers ─── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, nodeX: 0, nodeY: 0 };
  }, [pan]);

  const handleNodeMouseDown = useCallback((cardId: string, x: number, y: number) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDraggedNode(cardId);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, nodeX: x, nodeY: y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (draggedNode) {
      setNodePositions((prev) => ({
        ...prev,
        [draggedNode]: { x: dragStart.current.nodeX + dx / zoom, y: dragStart.current.nodeY + dy / zoom },
      }));
      return;
    }
    if (!isDragging) return;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [draggedNode, isDragging, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDraggedNode(null);
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
  const resetView = requestFitToContent;
  const resetCanvasLayout = () => {
    setNodePositions({});
    requestFitToContent();
  };

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
  const { cards: layoutCards, edges, canvasW, canvasH } = computeLayout(topology.networks, topology.hostPorts);
  const cards = layoutCards.map((card) => ({ ...card, ...(nodePositions[card.id] || {}) }));
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

        <Button variant="ghost" size="sm" onClick={fetchTopology} title="Refresh network data">
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* ── Warning ── */}
      {warning && (
        <div className="flex items-center gap-2 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-sm text-yellow-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {warning}
        </div>
      )}

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Network Map Guide</h3>
        <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-3">
          <div><span className="text-amber-300">Internet</span> means traffic coming from outside the server.</div>
          <div><span className="text-blue-300">Docker Host</span> is the server running your applications.</div>
          <div><span className="text-emerald-300">App nodes</span> are individual containers. Drag them to rearrange the map.</div>
        </div>
        <p className="mt-2 text-xs text-gray-500">Click a connection line to mark it Blocked or Allowed on the canvas. This is a visual planning step before applying real firewall rules.</p>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          <span>Drag canvas to pan · Drag any node to rearrange · Click a line to lock/unlock it</span>
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
        <div
          className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-xl border border-gray-700/80 bg-gray-950/80 p-1 shadow-xl backdrop-blur"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={zoomOut} className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3rem] px-1 text-center text-xs text-gray-400">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={zoomIn} className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={resetView} className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white" title="Fit content">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={resetCanvasLayout} className="ml-1 flex items-center gap-1 rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-white" title="Reset node layout">
            <RotateCcw className="h-3.5 w-3.5" />
            Layout
          </button>
        </div>
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
              transformOrigin: "top left",
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
              className="absolute inset-0"
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
                    locked={Boolean(lockedEdges[`${edge.fromId}->${edge.toId}`])}
                    onToggle={() => setLockedEdges((prev) => ({ ...prev, [`${edge.fromId}->${edge.toId}`]: !prev[`${edge.fromId}->${edge.toId}`] }))}
                  />
                );
              })}
            </svg>

            {/* Render HTML cards */}
            {cards.map(card => {
              if (card.type === "internet") {
                return <InternetCard key={card.id} card={card} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
              }
              if (card.type === "server") {
                return <ServerCard key={card.id} card={card} hostname={topology.networks[0]?.containers[0]?.name ? "Docker Host" : "Server"} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
              }
              if (card.type === "network") {
                const netData = orderedNets.find(n => card.id === `net-${n.id}`);
                if (!netData) return null;
                const colorIdx = orderedNets.indexOf(netData);
                return <NetworkCard key={card.id} card={card} net={netData} colorIdx={colorIdx >= 0 ? colorIdx : 0} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
              }
              if (card.type === "container") {
                const contData = containerDataMap.get(card.id);
                if (!contData) return null;
                return <ContainerCard key={card.id} card={card} container={contData} onSelect={setSelectedContainer} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
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

      {/* ── Network Details ── */}
      <NetworkDetailList orderedNets={orderedNets} onSelectContainer={setSelectedContainer} />
    </div>
  );
}

