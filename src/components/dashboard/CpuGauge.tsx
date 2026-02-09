"use client";

import clsx from "clsx";

interface CpuGaugeProps {
  percentage: number;
}

function getGaugeColor(pct: number): string {
  if (pct < 50) return "text-emerald-400";
  if (pct <= 80) return "text-yellow-400";
  return "text-red-400";
}

function getGaugeStroke(pct: number): string {
  if (pct < 50) return "#34d399";
  if (pct <= 80) return "#facc15";
  return "#f87171";
}

export function CpuGauge({ percentage }: CpuGaugeProps) {
  const clamped = Math.min(100, Math.max(0, percentage));
  const radius = 54;
  const circumference = Math.PI * radius; // semicircle
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-[130px] w-[140px]">
        <svg
          viewBox="0 0 120 75"
          className="h-full w-full"
          fill="none"
        >
          {/* Background arc */}
          <path
            d="M 6 70 A 54 54 0 0 1 114 70"
            stroke="#374151"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          {/* Value arc */}
          <path
            d="M 6 70 A 54 54 0 0 1 114 70"
            stroke={getGaugeStroke(clamped)}
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        {/* Center label */}
        <div className="absolute inset-x-0 bottom-2 flex flex-col items-center">
          <span
            className={clsx("text-2xl font-bold", getGaugeColor(clamped))}
          >
            {clamped.toFixed(1)}%
          </span>
        </div>
      </div>
      <span className="text-sm font-medium text-gray-400">CPU Usage</span>
    </div>
  );
}
