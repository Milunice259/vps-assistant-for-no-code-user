/**
 * SVG edge component — animated connection line with click-to-lock affordance.
 */

import type { CardRect } from "./types";

export function SvgEdge({
  from,
  to,
  color,
  label,
  locked,
  onToggle,
}: {
  from: CardRect;
  to: CardRect;
  color: string;
  label?: string;
  locked?: boolean;
  onToggle?: () => void;
}) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;

  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

  const labelText = locked ? "Blocked" : label;
  const labelX = (x1 + x2) / 2;
  const labelY = midY - 4;
  const labelWidth = Math.max((labelText || "Flow").length * 7, 44) + 16;

  return (
    <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onToggle?.(); }}>
      <title>{locked ? "Blocked in this map. Click to unlock." : "Click to lock this flow in the map."}</title>
      <path d={pathD} fill="none" stroke={locked ? "#ef444420" : `${color}18`} strokeWidth={8} />
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
