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

      {/* ── Network Details ── */}
      <NetworkDetailList orderedNets={orderedNets} onSelectContainer={setSelectedContainer} />
    </div>
  );
}
