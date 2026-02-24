/**
 * SVG edge component — animated dashed connection line with port label.
 */

import type { CardRect } from "./types";

export function SvgEdge({
  from,
  to,
  color,
  label,
}: {
  from: CardRect;
  to: CardRect;
  color: string;
  label?: string;
}) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;

  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

  const labelX = (x1 + x2) / 2;
  const labelY = midY - 4;

  return (
    <g>
      {/* Shadow */}
      <path d={pathD} fill="none" stroke={`${color}15`} strokeWidth={6} />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={`${color}50`}
        strokeWidth={2}
        strokeDasharray="6 4"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="2s"
          repeatCount="indefinite"
        />
      </path>
      {/* Start dot */}
      <circle cx={x1} cy={y1} r={3} fill={color} opacity={0.5} />
      {/* End dot */}
      <circle cx={x2} cy={y2} r={3} fill={color} opacity={0.7} />
      {/* Port label */}
      {label && (
        <g>
          <rect
            x={labelX - Math.max(label.length * 3.5, 20) - 8}
            y={labelY - 10}
            width={Math.max(label.length * 7, 40) + 16}
            height={18}
            rx={9}
            fill="#1e293b"
            stroke={`${color}40`}
            strokeWidth={1}
          />
          <text
            x={labelX}
            y={labelY + 2}
            textAnchor="middle"
            fill={color}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
            fontWeight={600}
          >
            <title>{label}</title>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
