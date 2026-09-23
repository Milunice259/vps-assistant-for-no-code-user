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
  ShieldCheck,
  ShieldAlert,
  Database,
  Play,
  Square,
  Shield,
  Eye,
} from "lucide-react";
import type { NetworkTopology, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useSafeMode } from "@/contexts/SafeModeContext";

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

type ContainerInfo = { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string };
type ActionTarget =
  | { type: "container"; container: ContainerInfo }
  | { type: "edge"; key: string; label: string; fromType?: string; toType?: string }
  | { type: "internet" };

export function ServerNetworkMap({ serverId }: ServerNetworkMapProps) {
  const { safeMode } = useSafeMode();
  const [topology, setTopology] = useState<NetworkTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [firewallRules, setFirewallRules] = useState<Array<{ number: number; target: string; action: string; from: string }>>([]);
  const [firewallError, setFirewallError] = useState<string | null>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
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
      requestFitToContent();
      if (json.warning) setWarning(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [requestFitToContent, serverId]);

  const fetchFirewallRules = useCallback(async () => {
    setFirewallError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/network/firewall`);
      const json: ApiResponse<{ rules: Array<{ number: number; target: string; action: string; from: string }> }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Firewall rules unavailable");
      setFirewallRules(json.data?.rules || []);
    } catch (err) {
      setFirewallRules([]);
      setFirewallError(err instanceof Error ? err.message : "Firewall rules unavailable");
    }
  }, [serverId]);

  useEffect(() => {
    fetchTopology();
    fetchFirewallRules();
  }, [fetchFirewallRules, fetchTopology]);

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

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.min(2, Math.max(0.3, z + delta)));
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [loading, topology]);

  /* ─── Zoom controls ─── */
  const zoomIn = () => setZoom(z => Math.min(2, z + 0.15));
  const zoomOut = () => setZoom(z => Math.max(0.3, z - 0.15));
  const resetView = requestFitToContent;
  const resetCanvasLayout = () => {
    setNodePositions({});
    requestFitToContent();
  };

  const requireTypedConfirm = (phrase: string, message: string) => {
    const typed = window.prompt(`${message}

Type ${phrase} to continue.`);
    return typed === phrase;
  };

  const runContainerAction = async (container: ContainerInfo, action: "start" | "stop" | "restart") => {
    if (safeMode) return setActionMessage("Safe Mode is on. Turn it off before changing app state.");
    const warning = action === "stop" ? `Stop ${container.name}? This can take the app offline.` : `${action === "restart" ? "Restart" : "Start"} ${container.name}?`;
    if (!window.confirm(warning)) return;
    if (["stop", "restart"].includes(action) && !requireTypedConfirm(action.toUpperCase(), `${action.toUpperCase()} ${container.name} is a high-risk app action.`)) return;
    setActionBusy(action);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/docker/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId: container.id || container.name, action, safeModeOff: !safeMode }),
      });
      const json: ApiResponse<{ message: string }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Action failed");
      setActionMessage(json.data?.message || `${action} sent`);
      setActionTarget(null);
      await fetchTopology();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy(null);
    }
  };

  const runFirewallPortAction = async (port: number, protocol: string, mode: "dry-run" | "apply") => {
    if (mode === "apply") {
      if (safeMode) return setActionMessage("Safe Mode is on. Turn it off before changing firewall rules.");
      if (!window.confirm(`Block public access to ${protocol.toUpperCase()} :${port}?`)) return;
      if (!requireTypedConfirm(`BLOCK ${port}`, `Blocking ${protocol.toUpperCase()} :${port} changes the real firewall.`)) return;
    }
    setActionBusy(`${mode}-${port}`);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/network/firewall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, action: "block-port", port, protocol, safeModeOff: !safeMode }),
      });
      const json: ApiResponse<{ message?: string; output?: string }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Firewall action failed");
      setActionMessage(json.data?.output || json.data?.message || "Done");
      if (mode === "apply") {
        await fetchTopology();
        await fetchFirewallRules();
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Firewall action failed");
    } finally {
      setActionBusy(null);
    }
  };

  const runFirewallAction = async (portIndex: number, mode: "dry-run" | "apply") => {
    const port = listeningPorts[portIndex];
    if (!port) return;
    await runFirewallPortAction(port.localPort, port.protocol, mode);
  };

  const allowPort = async (port: number, protocol: string) => {
    if (safeMode) return setActionMessage("Safe Mode is on. Turn it off before changing firewall rules.");
    if (!window.confirm(`Allow ${protocol.toUpperCase()} :${port} again?`)) return;
    setActionBusy(`allow-${port}`);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/network/firewall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "apply", action: "allow-port", port, protocol, safeModeOff: !safeMode }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Allow rule failed");
      setActionMessage(json.data?.output || "Allow rule applied");
      await fetchFirewallRules();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Allow rule failed");
    } finally {
      setActionBusy(null);
    }
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
  const rawListeningPorts = topology.hostPorts.filter(p => p.localPort > 0 && p.process);
  const listeningPorts = Array.from(rawListeningPorts.reduce((map, port) => {
    const key = `${port.protocol}-${port.localPort}-${port.process || "unknown"}`;
    const existing = map.get(key);
    const addresses = existing?.addresses ?? [];
    const localAddress = existing?.localAddress || port.localAddress;
    const isPublic = existing?.isPublic || !["127.", "::1", "localhost"].some((prefix) => port.localAddress.startsWith(prefix));
    map.set(key, { ...port, localAddress, addresses: addresses.includes(port.localAddress) ? addresses : [...addresses, port.localAddress], isPublic });
    return map;
  }, new Map<string, typeof rawListeningPorts[number] & { addresses: string[]; isPublic: boolean }>()).values());
  const publicPorts = listeningPorts.filter((p) => p.isPublic);
  const sensitivePorts = new Set([22, 80, 443, 3306, 5432, 6379, 27017, 9200, 5601, 8080, 8443]);
  const sensitiveOpenPorts = publicPorts.filter((p) => sensitivePorts.has(p.localPort));
  const selectedPortInfo = selectedPort == null ? null : listeningPorts[selectedPort] ?? null;
  const selectedPortNeedsReview = selectedPortInfo ? sensitivePorts.has(selectedPortInfo.localPort) && selectedPortInfo.isPublic : false;
  const findings = topology.findings || [];
  const secureChecklist = [
    { label: "Public exposure reviewed", ok: findings.length === 0, detail: findings.length ? `${findings.length} exposure finding(s) need review.` : "No risky public port finding in this snapshot." },
    { label: "Firewall rules readable", ok: !firewallError, detail: firewallError || `${firewallRules.length} numbered rule(s) loaded.` },
    { label: "Safe Mode protects changes", ok: safeMode, detail: safeMode ? "Dangerous fixes are locked until Safe Mode is off." : "Safe Mode is off. Review carefully before applying changes." },
    { label: "SSH self-lockout protected", ok: !findings.some((f) => f.port === 22 && f.severity === "high"), detail: "Port 22 cannot be blocked from the map." },
  ];

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

      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Network Audit</h3>
          <a href="/docs" className="text-xs text-gray-500 hover:text-brand-300">Docs</a>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div title="Ports reachable outside localhost." className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-950/60 p-4 text-center">
            <div className="rounded-2xl bg-sky-500/10 p-3 ring-1 ring-sky-400/20">
              <Globe className="h-6 w-6 text-sky-300" />
            </div>
            <p className="mt-3 text-3xl font-bold leading-none text-white">{publicPorts.length}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">Public</p>
          </div>
          <div
            title={sensitiveOpenPorts.length > 0 ? `Review: ${sensitiveOpenPorts.slice(0, 6).map((p) => `${p.protocol.toUpperCase()}:${p.localPort} (${p.process || "unknown"})`).join(", ")}${sensitiveOpenPorts.length > 6 ? "…" : ""}` : "No common database/admin port is publicly listening in this snapshot."}
            className={`flex min-h-32 flex-col items-center justify-center rounded-lg border p-4 text-center ${sensitiveOpenPorts.length > 0 ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}
          >
            <div className={`rounded-2xl p-3 ring-1 ${sensitiveOpenPorts.length > 0 ? "bg-amber-500/10 ring-amber-400/20" : "bg-emerald-500/10 ring-emerald-400/20"}`}>
              {sensitiveOpenPorts.length > 0 ? <ShieldAlert className="h-6 w-6 text-amber-300" /> : <ShieldCheck className="h-6 w-6 text-emerald-300" />}
            </div>
            <p className={`mt-3 text-3xl font-bold leading-none ${sensitiveOpenPorts.length > 0 ? "text-amber-300" : "text-emerald-300"}`}>{sensitiveOpenPorts.length}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">Review</p>
          </div>
          <div title="Internal app networks on this server." className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-950/60 p-4 text-center">
            <div className="rounded-2xl bg-purple-500/10 p-3 ring-1 ring-purple-400/20">
              <Network className="h-6 w-6 text-purple-300" />
            </div>
            <p className="mt-3 text-3xl font-bold leading-none text-white">{topology.networks.length}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">Networks</p>
          </div>
        </div>
      </div>



      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Secure this server</h3>
            <p className="mt-1 text-xs text-gray-400">Guided checklist from live network and firewall data.</p>
          </div>
          <Badge variant={secureChecklist.every((item) => item.ok) ? "success" : "warning"}>{secureChecklist.filter((item) => item.ok).length}/{secureChecklist.length}</Badge>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {secureChecklist.map((item) => (
            <div key={item.label} className={`rounded-lg border p-3 ${item.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/10"}`}>
              <div className="flex items-start gap-2">
                {item.ok ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{item.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {findings.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">Exposure Advisor</h3>
              <p className="mt-1 text-xs text-gray-400">Real findings from currently listening public ports.</p>
            </div>
            <Badge variant={findings.some((f) => f.severity === "high") ? "warning" : "default"}>{findings.length} finding(s)</Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {findings.slice(0, 4).map((finding) => (
              <div key={finding.id} className="rounded-lg border border-gray-700 bg-gray-950/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${finding.severity === "high" ? "text-amber-300" : "text-gray-200"}`}>{finding.title}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-400">{finding.detail}</p>
                    {finding.suggestedFix && <p className="mt-1 text-xs text-sky-300">Suggested: {finding.suggestedFix}</p>}
                  </div>
                  {finding.port && <Badge variant="default">{finding.protocol?.toUpperCase()}:{finding.port}</Badge>}
                </div>
                {finding.port && finding.protocol && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-3">
                    <Button size="sm" variant="secondary" loading={actionBusy === `dry-run-${finding.port}`} onClick={() => runFirewallPortAction(finding.port as number, finding.protocol as string, "dry-run")}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Preview fix
                    </Button>
                    <Button size="sm" variant="danger" loading={actionBusy === `apply-${finding.port}`} disabled={safeMode || finding.port === 22} title={safeMode ? "Safe Mode locks firewall changes" : finding.port === 22 ? "SSH port 22 is protected from map blocking" : undefined} onClick={() => runFirewallPortAction(finding.port as number, finding.protocol as string, "apply")}>
                      <Shield className="mr-1 h-3.5 w-3.5" /> {safeMode ? "Block locked" : "Block public access"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Network Map Guide</h3>
        <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-3">
          <div><span className="text-amber-300">Internet</span> means traffic coming from outside the server.</div>
          <div><span className="text-blue-300">Docker Host</span> is the server running your applications.</div>
          <div><span className="text-emerald-300">App nodes</span> are individual containers. Drag them to rearrange the map.</div>
        </div>
        <p className="mt-2 text-xs text-gray-500">Tap or hover a line/app for the ⋯ button. Lines are visual paths, not toggles. App actions and firewall Block/Allow are real operations locked by Safe Mode.</p>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          <span>Left-click app = details · Right-click app/wire = actions · Drag canvas/nodes</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Internet / exposed port</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Host</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> Network group</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Running app</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Stopped app</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" /> Unknown</span>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl border border-gray-700 bg-gray-900/70 p-3 text-xs text-gray-400 sm:grid-cols-3">
        <div><span className="font-medium text-white">Left click</span> app nodes for details.</div>
        <div><span className="font-medium text-white">Right click</span> app nodes or wires for real actions.</div>
        <div><span className="font-medium text-white">Drag</span> empty canvas to pan; drag nodes to rearrange.</div>
      </div>

      {/* ── Map Viewport ── */}
      <div
        ref={viewportRef}
        className="bg-gray-900/50 rounded-xl border border-gray-700 overflow-hidden relative"
        style={{ height: Math.min(Math.max(canvasH + 40, 480), 700), cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
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
                    onAction={() => setActionTarget({
                      type: "edge",
                      key: `${edge.fromId}->${edge.toId}`,
                      label: `${fromCard.type} → ${toCard.type}`,
                      fromType: fromCard.type,
                      toType: toCard.type,
                    })}
                  />
                );
              })}
            </svg>

            {/* Render HTML cards */}
            {cards.map(card => {
              if (card.type === "internet") {
                return <InternetCard key={card.id} card={card} onAction={() => setActionTarget({ type: "internet" })} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
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
                return <ContainerCard key={card.id} card={card} container={contData} onSelect={setSelectedContainer} onAction={(container) => setActionTarget({ type: "container", container })} onMouseDown={handleNodeMouseDown(card.id, card.x, card.y)} />;
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* ── Action Panel ── */}
      {actionTarget && (
        <div className="rounded-xl border border-brand-500/30 bg-gray-900/90 p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">
                {actionTarget.type === "container" ? actionTarget.container.name : actionTarget.type === "edge" ? "Connection options" : "Internet access"}
              </h4>
              <p className="mt-1 text-xs text-gray-400">
                {actionTarget.type === "container"
                  ? "Real Docker controls for this app."
                  : actionTarget.type === "edge"
                    ? "Connection lines are visual only. Use Preview/Block below for real UFW firewall changes."
                    : "Review public ports, exposed services, and firewall rules."}
              </p>
            </div>
            <button onClick={() => setActionTarget(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>

          {actionTarget.type === "container" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={safeMode || actionBusy !== null} title={safeMode ? "Safe Mode locks app state changes" : undefined} onClick={() => runContainerAction(actionTarget.container, "start")}>
                <Play className="mr-1 h-3.5 w-3.5" /> Start
              </Button>
              <Button size="sm" variant="secondary" disabled={safeMode || actionBusy !== null} title={safeMode ? "Safe Mode locks app state changes" : undefined} onClick={() => runContainerAction(actionTarget.container, "restart")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restart
              </Button>
              <Button size="sm" variant="danger" disabled={safeMode || actionBusy !== null} title={safeMode ? "Safe Mode locks app state changes" : undefined} onClick={() => runContainerAction(actionTarget.container, "stop")}>
                <Square className="mr-1 h-3.5 w-3.5" /> Stop
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedContainer(actionTarget.container)}>
                <Eye className="mr-1 h-3.5 w-3.5" /> Details
              </Button>
            </div>
          )}

          {actionTarget.type === "edge" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedPort(0)}>
                  <Globe className="mr-1 h-3.5 w-3.5" /> Review ports
                </Button>
                <a href="/docs#network" className="inline-flex items-center rounded-lg px-3 py-2 text-xs text-brand-300 hover:bg-brand-500/10">How to apply safely →</a>
              </div>
              {publicPorts.length > 0 && (
                <div className="rounded-lg border border-gray-700 bg-gray-950/60 p-3">
                  <p className="mb-1 text-xs font-medium text-gray-300">Real firewall action · high risk requires typed confirmation</p>
                  <p className="mb-2 text-[11px] text-gray-500">Choose the exact public port to preview or block. Wires do not directly toggle traffic.</p>
                  <div className="flex flex-wrap gap-2">
                    {publicPorts.slice(0, 6).map((port) => {
                      const index = listeningPorts.indexOf(port);
                      return (
                        <div key={`${port.protocol}-${port.localPort}-${port.process}`} className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 p-1">
                          <span className="px-2 text-xs font-mono text-white">{port.protocol.toUpperCase()} :{port.localPort}</span>
                          <button disabled={actionBusy !== null} onClick={() => runFirewallAction(index, "dry-run")} className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50">Preview</button>
                          <button disabled={actionBusy !== null || safeMode} onClick={() => runFirewallAction(index, "apply")} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50" title={safeMode ? "Safe Mode locks firewall changes" : "Apply block rule"}>Block</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {actionTarget.type === "internet" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelectedPort(0)}>
                <Globe className="mr-1 h-3.5 w-3.5" /> Review public ports
              </Button>
              <a href="/docs#network" className="inline-flex items-center rounded-lg px-3 py-2 text-xs text-brand-300 hover:bg-brand-500/10">Network guide →</a>
            </div>
          )}

          {actionMessage && <p className="mt-3 text-xs text-gray-400">{actionMessage}</p>}
        </div>
      )}

      {/* ── Firewall Rule Manager ── */}
      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">Firewall Rules</h4>
            <p className="text-xs text-gray-500">Preview is safe. Block/Allow changes real UFW rules and is locked by Safe Mode.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={fetchFirewallRules} disabled={actionBusy !== null}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {firewallError ? (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">{firewallError}</p>
        ) : firewallRules.length === 0 ? (
          <p className="mt-3 text-xs text-gray-500">No numbered UFW rules found.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {firewallRules.map((rule) => {
              const match = rule.target.match(/(\d+)\/(tcp|udp)/i);
              const port = match ? Number(match[1]) : 0;
              const protocol = (match?.[2] || "tcp").toLowerCase();
              const canAllow = port > 0 && /DENY|REJECT/i.test(rule.action);
              return (
                <div key={rule.number} className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-950/60 p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-white">[{rule.number}] {rule.target}</p>
                    <p className="mt-1 truncate text-xs text-gray-500">{rule.action} · from {rule.from}</p>
                  </div>
                  {canAllow && (
                    <button disabled={safeMode || actionBusy !== null} onClick={() => allowPort(port, protocol)} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50" title={safeMode ? "Safe Mode locks firewall changes" : "Rollback by allowing this port"}>
                      Allow
                    </button>
                  )}
                </div>
              );
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
              <button
                key={`${p.protocol}-${p.localPort}-${i}`}
                onClick={() => setSelectedPort(selectedPort === i ? null : i)}
                title={`Click for a short explanation · Seen on ${p.addresses.join(", ")}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${selectedPort === i ? "border-brand-500/60 bg-brand-500/10" : "border-gray-700/50 bg-gray-900/70 hover:border-amber-500/30"}`}
              >
                <Badge variant="info">{p.protocol.toUpperCase()}</Badge>
                <span className="text-white text-sm font-mono font-semibold">:{p.localPort}</span>
                {sensitivePorts.has(p.localPort) && <Database className="h-3.5 w-3.5 text-amber-300" />}
                {p.process && (
                  <span className="text-xs text-gray-500 truncate max-w-[120px]">{p.process}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedPortInfo && (
        <div className={`rounded-xl border p-4 ${selectedPortNeedsReview ? "border-amber-500/30 bg-amber-500/10" : "border-sky-500/20 bg-sky-500/5"}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">{selectedPortInfo.protocol.toUpperCase()} :{selectedPortInfo.localPort}</h4>
              <p className="mt-1 text-xs text-gray-400">{selectedPortInfo.process || "Unknown process"}</p>
            </div>
            {selectedPortNeedsReview ? <ShieldAlert className="h-5 w-5 text-amber-300" /> : <ShieldCheck className="h-5 w-5 text-sky-300" />}
          </div>
          <p className="mt-3 text-sm text-gray-300">
            {selectedPortNeedsReview ? "Common admin/database port. Keep it open only if you really need external access." : "Listening port detected. Review only if this service should not receive traffic."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={actionBusy === `dry-run-${selectedPortInfo.localPort}`} onClick={() => runFirewallPortAction(selectedPortInfo.localPort, selectedPortInfo.protocol, "dry-run")}>
              <Eye className="mr-1 h-3.5 w-3.5" /> Preview firewall change
            </Button>
            <Button size="sm" variant="danger" loading={actionBusy === `apply-${selectedPortInfo.localPort}`} disabled={safeMode || selectedPortInfo.localPort === 22} title={safeMode ? "Safe Mode locks firewall changes" : selectedPortInfo.localPort === 22 ? "SSH port 22 is protected from map blocking" : undefined} onClick={() => runFirewallPortAction(selectedPortInfo.localPort, selectedPortInfo.protocol, "apply")}>
              <Shield className="mr-1 h-3.5 w-3.5" /> {safeMode ? "Block locked" : "Block public access"}
            </Button>
            <a href="/docs#network" className="inline-flex items-center rounded-lg px-3 py-2 text-xs text-brand-300 hover:bg-brand-500/10">Learn more →</a>
          </div>
        </div>
      )}

      {/* ── Network Details ── */}
      <NetworkDetailList orderedNets={orderedNets} onSelectContainer={setSelectedContainer} />
    </div>
  );
}

