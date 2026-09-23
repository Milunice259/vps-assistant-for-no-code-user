/**
 * SVG edge component - animated connection line with action affordance.
 */

import type { CardRect } from "./types";

function getSideAnchors(from: CardRect, to: CardRect) {
  const fromCenterX = from.x + from.w / 2;
  const fromCenterY = from.y + from.h / 2;
  const toCenterX = to.x + to.w / 2;
  const toCenterY = to.y + to.h / 2;
  const goesRight = toCenterX >= fromCenterX;

  return {
    x1: goesRight ? from.x + from.w : from.x,
    y1: fromCenterY,
    x2: goesRight ? to.x : to.x + to.w,
    y2: toCenterY,
  };
}

export function SvgEdge({
  from,
  to,
  color,
  onAction,
}: {
  from: CardRect;
  to: CardRect;
  color: string;
  label?: string;
  onAction?: (e: React.MouseEvent<SVGGElement>) => void;
}) {
  const { x1, y1, x2, y2 } = getSideAnchors(from, to);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;


  return (
    <g className="group cursor-default" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onAction?.(e); }}>
      <title>Right-click the wire, or click Actions, for real connection options.</title>
      <path d={pathD} fill="none" stroke={`${color}18`} strokeWidth={14} />
      <path
        d={pathD}
        fill="none"
        stroke={`${color}75`}
        strokeWidth={2}
        strokeDasharray="6 4"
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="2s" repeatCount="indefinite" />
      </path>
      <circle cx={x1} cy={y1} r={4} fill={color} opacity={0.6} />
      <circle cx={x2} cy={y2} r={4} fill={color} opacity={0.85} />
      <g className="cursor-pointer opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); onAction?.(e); }}>
        <rect x={midX - 30} y={midY - 13} width={60} height={26} rx={13} fill="#020617" stroke={color} strokeWidth={1.5} />
        <text x={midX} y={midY + 4} textAnchor="middle" fill="#e5e7eb" fontSize={10} fontWeight={800}>Actions</text>
      </g>
   </g>
  );
}
