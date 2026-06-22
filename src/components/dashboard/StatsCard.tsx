import clsx from "clsx";
import { ReactNode } from "react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  color?: string;
  hint?: string;
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon,
  color = "text-brand-400",
  hint,
}: StatsCardProps) {
  return (
    <div className="flex items-start gap-4 rounded-xl bg-gray-800 p-4">
      <div
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-700/60",
          color
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-gray-400">{title}</p>
          {hint && (
            <span className="cursor-help rounded-full border border-gray-700 px-1.5 text-[10px] text-gray-500" title={hint}>
              ?
            </span>
          )}
        </div>
        <p className="mt-0.5 text-2xl font-bold text-white">{value}</p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
