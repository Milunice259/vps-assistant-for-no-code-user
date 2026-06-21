/**
 * Network Map layout engine — pure computation, no React dependency.
 */

import type { DockerNetworkInfo, PortInfo } from "@/types";
import type { CardRect, EdgeDef, LayoutResult } from "./types";
import { NETWORK_PALETTE, formatPortsBadge } from "./types";

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

export function computeLayout(
  networks: DockerNetworkInfo[],
  hostPorts: PortInfo[],
): LayoutResult {
  const cards: CardRect[] = [];
  const edges: EdgeDef[] = [];

  const PADDING = 60;
  const row0Y = PADDING;

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
      const contStartX = netStartX + colW / 2 - contsWidth / 2;

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
