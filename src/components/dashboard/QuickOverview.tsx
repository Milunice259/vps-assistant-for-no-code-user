"use client";

import {
  Container,
  AppWindow,
  Server,
  Network,
  Globe,
  GitBranch,
} from "lucide-react";
import type { DashboardSummary } from "@/types";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { useSSE } from "@/hooks/useSSE";

export function QuickOverview() {
  const { data: summary } = useSSE<DashboardSummary>("/api/dashboard/stream", {
    fallbackPollMs: 30_000,
  });

  if (!summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[104px] rounded-xl bg-gray-800 border border-gray-700/60 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const cards = [
    {
      title: "Containers",
      value: summary.containers.total,
      breakdown: `${summary.containers.running} running · ${summary.containers.stopped} stopped`,
      icon: <Container className="w-5 h-5" />,
      href: "/apps",
      color: "text-sky-400",
      glowColor: "hover:shadow-sky-500/10",
    },
    {
      title: "Applications",
      value: summary.apps.total,
      breakdown: `${summary.apps.running} running · ${summary.apps.stopped} stopped`,
      icon: <AppWindow className="w-5 h-5" />,
      href: "/apps",
      color: "text-violet-400",
      glowColor: "hover:shadow-violet-500/10",
    },
    {
      title: "Servers",
      value: summary.servers.total,
      breakdown: `${summary.servers.active} active`,
      subtitle: "Including local server",
      icon: <Server className="w-5 h-5" />,
      href: "/servers",
      color: "text-emerald-400",
      glowColor: "hover:shadow-emerald-500/10",
    },
    {
      title: "Listening Ports",
      value: summary.network.listeningPorts,
      breakdown: "TCP / UDP open ports",
      icon: <Network className="w-5 h-5" />,
      href: "/network",
      color: "text-amber-400",
      glowColor: "hover:shadow-amber-500/10",
    },
    {
      title: "Docker Networks",
      value: summary.network.dockerNetworks,
      breakdown: "Bridge, overlay, custom",
      icon: <Globe className="w-5 h-5" />,
      href: "/network",
      color: "text-teal-400",
      glowColor: "hover:shadow-teal-500/10",
    },
    {
      title: "Deployments",
      value: summary.deployments.total,
      breakdown: `${summary.deployments.running} live · ${summary.deployments.failed} failed`,
      subtitle: summary.deployments.recent > 0
        ? `${summary.deployments.recent} in last 24h`
        : undefined,
      icon: <GitBranch className="w-5 h-5" />,
      href: "/deploy",
      color: "text-pink-400",
      glowColor: "hover:shadow-pink-500/10",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
          Quick Overview
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <SummaryCard key={card.title} {...card} />
        ))}
      </div>

      {/* OS Info bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 pt-1">
        <span>
          OS: <span className="text-gray-400">{summary.os.distro}</span>
        </span>
        <span>
          Kernel: <span className="text-gray-400">{summary.os.kernel}</span>
        </span>
        <span>
          Arch: <span className="text-gray-400">{summary.os.arch}</span>
        </span>
      </div>
    </div>
  );
}
