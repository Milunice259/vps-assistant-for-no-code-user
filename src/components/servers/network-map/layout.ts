/**
 * Network Map layout engine - pure computation, no React dependency.
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

const PADDING = 60;
const LANE_GAP = 64;
const COL_GAP = 80;
const CONTAINER_GAP = 28;

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
  const serverX = internetX + INTERNET_W + COL_GAP;
  const networkX = serverX + SERVER_W + COL_GAP;
  const containerStartX = networkX + NETWORK_W + COL_GAP;

  const laneHeights = orderedNets.map((net) => Math.max(NETWORK_H, net.containers.length > 0 ? CONTAINER_H : NETWORK_H));
  const contentH = laneHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, orderedNets.length - 1) * LANE_GAP;
  const canvasH = Math.max(contentH + PADDING * 2, 360);
  const centerY = canvasH / 2;

  const maxContainers = Math.max(1, ...orderedNets.map((net) => net.containers.length));
  const canvasW = Math.max(containerStartX + maxContainers * (CONTAINER_W + CONTAINER_GAP) - CONTAINER_GAP + PADDING, 900);

  cards.push({
    id: internetId,
    type: "internet",
    x: internetX,
    y: centerY - INTERNET_H / 2,
    w: INTERNET_W,
    h: INTERNET_H,
  });

  cards.push({
    id: serverId,
    type: "server",
    x: serverX,
    y: centerY - SERVER_H / 2,
    w: SERVER_W,
    h: SERVER_H,
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
    const netY = laneY + laneH / 2 - NETWORK_H / 2;

    cards.push({
      id: netId,
      type: "network",
      x: networkX,
      y: netY,
      w: NETWORK_W,
      h: NETWORK_H,
    });

    edges.push({ fromId: serverId, toId: netId, color: palette.bg });

    net.containers.forEach((cont, ci) => {
      const contId = `cont-${cont.id || cont.name}-${i}`;
      const cx = containerStartX + ci * (CONTAINER_W + CONTAINER_GAP);
      const cy = laneY + laneH / 2 - CONTAINER_H / 2;

      cards.push({
        id: contId,
        type: "container",
        x: cx,
        y: cy,
        w: CONTAINER_W,
        h: CONTAINER_H,
      });

      const portStr = formatPortsBadge(cont.ports);
      edges.push({ fromId: netId, toId: contId, color: palette.bg, label: portStr || undefined });
    });

    laneY += laneH + LANE_GAP;
  });

  return { cards, edges, canvasW, canvasH };
}
