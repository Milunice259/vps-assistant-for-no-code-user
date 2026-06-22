/**
 * Network Map layout engine - pure computation, no React dependency.
 */

import type { DockerNetworkInfo, PortInfo } from "@/types";
import type { CardRect, EdgeDef, LayoutResult } from "./types";
import { NETWORK_PALETTE, formatPortsBadge } from "./types";

const NODE_W = 220;
const NODE_H = 76;
const PADDING = 64;
const COL_GAP = 88;
const ROW_GAP = 28;
const NETWORK_GAP = 72;
const APPS_PER_ROW = 3;

export function computeLayout(
  networks: DockerNetworkInfo[],
  hostPorts: PortInfo[],
): LayoutResult {
  const cards: CardRect[] = [];
  const edges: EdgeDef[] = [];

  const internetId = "internet";
  const serverId = "server";
  const netsWithContainers = networks.filter((n) => n.containers.length > 0);
  const emptyNets = networks.filter((n) => n.containers.length === 0);
  const orderedNets = [...netsWithContainers, ...emptyNets];

  const internetX = PADDING;
  const serverX = internetX + NODE_W + COL_GAP;
  const networkX = serverX + NODE_W + COL_GAP;
  const appStartX = networkX + NODE_W + COL_GAP;

  const laneHeights = orderedNets.map((net) => {
    const appRows = Math.max(1, Math.ceil(net.containers.length / APPS_PER_ROW));
    return Math.max(NODE_H, appRows * NODE_H + Math.max(0, appRows - 1) * ROW_GAP);
  });
  const contentH = laneHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, orderedNets.length - 1) * NETWORK_GAP;
  const canvasH = Math.max(contentH + PADDING * 2, 380);
  const centerY = canvasH / 2;
  const appColumns = Math.min(APPS_PER_ROW, Math.max(1, ...orderedNets.map((net) => net.containers.length)));
  const canvasW = Math.max(appStartX + appColumns * NODE_W + Math.max(0, appColumns - 1) * COL_GAP + PADDING, 980);

  cards.push({
    id: internetId,
    type: "internet",
    x: internetX,
    y: centerY - NODE_H / 2,
    w: NODE_W,
    h: NODE_H,
  });

  cards.push({
    id: serverId,
    type: "server",
    x: serverX,
    y: centerY - NODE_H / 2,
    w: NODE_W,
    h: NODE_H,
  });

  const openPorts = hostPorts.filter((p) => p.localPort > 0 && p.process);
  const portLabels = openPorts.length > 0
    ? openPorts.slice(0, 5).map((p) => `:${p.localPort}`).join("  ") + (openPorts.length > 5 ? ` +${openPorts.length - 5}` : "")
    : "";
  edges.push({ fromId: internetId, toId: serverId, color: "#f59e0b", label: portLabels || undefined });

  let laneY = PADDING;
  orderedNets.forEach((net, i) => {
    const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
    const laneH = laneHeights[i];
    const netId = `net-${net.id}`;
    const netY = laneY + laneH / 2 - NODE_H / 2;

    cards.push({
      id: netId,
      type: "network",
      x: networkX,
      y: netY,
      w: NODE_W,
      h: NODE_H,
    });

    edges.push({ fromId: serverId, toId: netId, color: palette.bg });

    net.containers.forEach((cont, ci) => {
      const contId = `cont-${cont.id || cont.name}-${i}`;
      const col = ci % APPS_PER_ROW;
      const row = Math.floor(ci / APPS_PER_ROW);
      const cx = appStartX + col * (NODE_W + COL_GAP);
      const cy = laneY + row * (NODE_H + ROW_GAP);

      cards.push({
        id: contId,
        type: "container",
        x: cx,
        y: cy,
        w: NODE_W,
        h: NODE_H,
      });

      const portStr = formatPortsBadge(cont.ports);
      edges.push({ fromId: netId, toId: contId, color: palette.bg, label: portStr || undefined });
    });

    laneY += laneH + NETWORK_GAP;
  });

  return { cards, edges, canvasW, canvasH };
}
