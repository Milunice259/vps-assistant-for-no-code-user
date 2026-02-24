/**
 * Network Map types — shared across all network-map sub-components.
 */

export interface CardRect {
  id: string;
  type: "internet" | "server" | "network" | "container";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeDef {
  fromId: string;
  toId: string;
  color: string;
  label?: string;
}

export interface LayoutResult {
  cards: CardRect[];
  edges: EdgeDef[];
  canvasW: number;
  canvasH: number;
}

export interface NetworkPalette {
  bg: string;
  bgFade: string;
  border: string;
  text: string;
}

export const NETWORK_PALETTE: NetworkPalette[] = [
  { bg: "#7c3aed", bgFade: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.4)", text: "#c4b5fd" },
  { bg: "#3b82f6", bgFade: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.4)", text: "#93c5fd" },
  { bg: "#06b6d4", bgFade: "rgba(6,182,212,0.12)", border: "rgba(6,182,212,0.4)", text: "#67e8f9" },
  { bg: "#14b8a6", bgFade: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.4)", text: "#5eead4" },
  { bg: "#f59e0b", bgFade: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", text: "#fde68a" },
  { bg: "#ec4899", bgFade: "rgba(236,72,153,0.12)", border: "rgba(236,72,153,0.4)", text: "#f9a8d4" },
];

export function containerStatusColor(state?: string) {
  switch (state?.toLowerCase()) {
    case "running": return { dot: "#34d399", bg: "rgba(5,150,105,0.15)", border: "rgba(52,211,153,0.3)", label: "Running" };
    case "exited": case "dead": return { dot: "#f87171", bg: "rgba(220,38,38,0.12)", border: "rgba(248,113,113,0.3)", label: "Stopped" };
    case "restarting": return { dot: "#fbbf24", bg: "rgba(217,119,6,0.12)", border: "rgba(251,191,36,0.3)", label: "Restarting" };
    case "paused": return { dot: "#fb923c", bg: "rgba(234,88,12,0.12)", border: "rgba(251,146,60,0.3)", label: "Paused" };
    default: return { dot: "#9ca3af", bg: "rgba(107,114,128,0.12)", border: "rgba(156,163,175,0.3)", label: state || "Unknown" };
  }
}

/** Parse port string like "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp" */
export function parsePortString(ports?: string): { host: number; container: number; proto: string }[] {
  if (!ports) return [];
  const results: { host: number; container: number; proto: string }[] = [];
  const re = /:(\d+)->(\d+)\/(tcp|udp)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ports)) !== null) {
    results.push({ host: parseInt(match[1]), container: parseInt(match[2]), proto: match[3] });
  }
  return results;
}

export function formatPortsBadge(ports?: string): string {
  const parsed = parsePortString(ports);
  if (parsed.length === 0) return "";
  return parsed.map(p => `:${p.host}`).join(", ");
}
