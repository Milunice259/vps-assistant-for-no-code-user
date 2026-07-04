/**
 * SVG edge component - animated connection line with click-to-lock affordance.
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
  locked,
  onAction,
}: {
  from: CardRect;
  to: CardRect;
  color: string;
  label?: string;
  locked?: boolean;
  onAction?: () => void;
}) {
  const { x1, y1, x2, y2 } = getSideAnchors(from, to);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

  const labelText = locked ? "Blocked" : undefined;
  const labelX = midX;
  const labelY = midY - 4;
  const labelWidth = Math.max((labelText || "Flow").length * 7, 44) + 16;

  return (
    <g className="group cursor-pointer" onClick={(e) => { e.stopPropagation(); onAction?.(); }}>
      <title>{locked ? "Blocked in this map. Click for real options." : "Click for connection options."}</title>
      <path d={pathD} fill="none" stroke={locked ? "#ef444420" : `${color}18`} strokeWidth={14} />
      <path
        d={pathD}
        fill="none"
        stroke={locked ? "#ef4444" : `${color}75`}
        strokeWidth={locked ? 3 : 2}
        strokeDasharray={locked ? "10 7" : "6 4"}
      >
        {!locked && (
          <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="2s" repeatCount="indefinite" />
        )}
      </path>
      <circle cx={x1} cy={y1} r={4} fill={locked ? "#ef4444" : color} opacity={0.6} />
      <circle cx={x2} cy={y2} r={4} fill={locked ? "#ef4444" : color} opacity={0.85} />
      <g className="opacity-0 transition-opacity group-hover:opacity-100">
        <circle cx={midX} cy={midY} r={15} fill="#020617" stroke={locked ? "#f87171" : color} strokeWidth={1.5} />
        <text x={midX} y={midY + 4} textAnchor="middle" fill={locked ? "#f87171" : "#e5e7eb"} fontSize={13} fontWeight={800}>⋯</text>
      </g>
      {labelText && (
        <g>
          <rect
            x={labelX - labelWidth / 2}
            y={labelY - 10}
            width={labelWidth}
            height={20}
            rx={10}
            fill="#0f172a"
            stroke={locked ? "#ef444480" : `${color}55`}
            strokeWidth={1}
          />
          <text
            x={labelX}
            y={labelY + 3}
            textAnchor="middle"
            fill={locked ? "#f87171" : color}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
            fontWeight={700}
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
}
