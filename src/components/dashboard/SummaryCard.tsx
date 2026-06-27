"use client";

import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { ReactNode } from "react";

interface SummaryCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  breakdown?: string;
  icon: ReactNode;
  href: string;
  color?: string;
  glowColor?: string;
}

export function SummaryCard({
  title,
  value,
  subtitle,
  breakdown,
  icon,
  href,
  color = "text-brand-400",
  glowColor = "hover:shadow-brand-500/10",
}: SummaryCardProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(href)}
      className={clsx(
        "group relative grid min-w-0 grid-cols-[auto_1fr_auto] items-start gap-3 overflow-hidden rounded-xl bg-gray-800 border border-gray-700/60 p-4 text-left transition-all duration-200",
        "hover:border-gray-600 hover:bg-gray-800/80 hover:shadow-lg",
        glowColor
      )}
    >
      {/* Icon */}
      <div
        className={clsx(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-700/60 transition-colors group-hover:bg-gray-700",
          color
        )}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs font-medium uppercase tracking-wider text-gray-500">
          {title}
        </p>
        <p className="mt-1 break-words text-2xl font-bold text-white">{value}</p>
        {breakdown && (
          <p className="mt-1 break-words text-xs text-gray-400">{breakdown}</p>
        )}
        {subtitle && (
          <p className="mt-0.5 break-words text-xs text-gray-500">{subtitle}</p>
        )}
      </div>

      {/* Arrow indicator */}
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-600 transition-all group-hover:text-gray-400 group-hover:translate-x-0.5 mt-1" />
    </button>
  );
}
