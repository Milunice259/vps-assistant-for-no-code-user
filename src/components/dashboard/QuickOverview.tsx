"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Container,
  GitBranch,
  Globe,
  LayoutGrid,
  Network,
  Server,
  Settings2,
} from "lucide-react";
import type { DashboardSummary } from "@/types";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { useSSE } from "@/hooks/useSSE";

const DEFAULT_CARD_IDS = ["servers", "apps", "running-apps", "deployments", "ports", "networks"];

export function QuickOverview() {
  const { data: summary } = useSSE<DashboardSummary>("/api/dashboard/stream", {
    fallbackPollMs: 30_000,
  });
  const [customizing, setCustomizing] = useState(false);
  const [visibleCardIds, setVisibleCardIds] = useState<string[]>(DEFAULT_CARD_IDS);

  const cards = useMemo(() => {
    if (!summary) return [];

    return [
      {
        id: "servers",
        title: "Fleet Servers",
        value: summary.servers.total,
        breakdown: `${summary.servers.active} active · ${Math.max(summary.servers.total - summary.servers.active, 0)} inactive`,
        subtitle: "Local + remote servers",
        icon: <Server className="h-5 w-5" />,
        href: "/servers",
        color: "text-emerald-400",
        glowColor: "hover:shadow-emerald-500/10",
      },
      {
        id: "remote-servers",
        title: "Remote Servers",
        value: Math.max(summary.servers.total - 1, 0),
        breakdown: "Connected VPS entries outside this host",
        subtitle: "Local server excluded",
        icon: <Globe className="h-5 w-5" />,
        href: "/servers",
        color: "text-cyan-400",
        glowColor: "hover:shadow-cyan-500/10",
      },
      {
        id: "apps",
        title: "Applications",
        value: summary.apps.total,
        breakdown: `${summary.apps.running} running · ${summary.apps.stopped} stopped`,
        subtitle: "Managed app inventory",
        icon: <Container className="h-5 w-5" />,
        href: "/apps",
        color: "text-sky-400",
        glowColor: "hover:shadow-sky-500/10",
      },
      {
        id: "running-apps",
        title: "Running Apps",
        value: summary.apps.running,
        breakdown: `${summary.apps.stopped} stopped apps need review`,
        subtitle: "Current app state",
        icon: <CheckCircle2 className="h-5 w-5" />,
        href: "/apps",
        color: "text-lime-400",
        glowColor: "hover:shadow-lime-500/10",
      },
      {
        id: "stopped-apps",
        title: "Stopped Apps",
        value: summary.apps.stopped,
        breakdown: summary.apps.stopped > 0 ? "Check if intentional" : "No stopped app recorded",
        subtitle: "App attention list",
        icon: <AlertTriangle className="h-5 w-5" />,
        href: "/apps",
        color: summary.apps.stopped > 0 ? "text-amber-400" : "text-gray-400",
        glowColor: "hover:shadow-amber-500/10",
      },
      {
        id: "ports",
        title: "Listening Ports",
        value: summary.network.listeningPorts,
        breakdown: "TCP / UDP open ports",
        subtitle: "Network exposure",
        icon: <Network className="h-5 w-5" />,
        href: "/network",
        color: "text-amber-400",
        glowColor: "hover:shadow-amber-500/10",
      },
      {
        id: "networks",
        title: "Docker Networks",
        value: summary.network.dockerNetworks,
        breakdown: "Bridge, overlay, custom",
        subtitle: "Container networking",
        icon: <Globe className="h-5 w-5" />,
        href: "/network",
        color: "text-teal-400",
        glowColor: "hover:shadow-teal-500/10",
      },
      {
        id: "deployments",
        title: "Deployments",
        value: summary.deployments.total,
        breakdown: `${summary.deployments.running} live · ${summary.deployments.failed} failed`,
        subtitle: summary.deployments.recent > 0 ? `${summary.deployments.recent} in last 24h` : "No deploy in last 24h",
        icon: <GitBranch className="h-5 w-5" />,
        href: "/deploy",
        color: "text-pink-400",
        glowColor: "hover:shadow-pink-500/10",
      },
      {
        id: "failed-deployments",
        title: "Failed Deploys",
        value: summary.deployments.failed,
        breakdown: summary.deployments.failed > 0 ? "Open deploy history to inspect" : "No failed deployment recorded",
        subtitle: "Release health",
        icon: <AlertTriangle className="h-5 w-5" />,
        href: "/deploy",
        color: summary.deployments.failed > 0 ? "text-red-400" : "text-gray-400",
        glowColor: "hover:shadow-red-500/10",
      },
    ];
  }, [summary]);

  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[116px] rounded-xl border border-gray-700/60 bg-gray-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  const selectedCards = cards.filter((card) => visibleCardIds.includes(card.id));
  const shownCards = selectedCards.length > 0 ? selectedCards : cards.slice(0, 1);

  function toggleCard(cardId: string) {
    setVisibleCardIds((current) =>
      current.includes(cardId)
        ? current.filter((id) => id !== cardId)
        : [...current, cardId]
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400">
            Fleet Overview
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Multi-server summary. Server-specific health stays inside each server page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCustomizing((value) => !value)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-300 hover:border-gray-600 hover:text-white"
        >
          <Settings2 className="h-4 w-4" /> Choose cards
        </button>
      </div>

      {customizing && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <LayoutGrid className="h-4 w-4" /> Visible cards
          </div>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {cards.map((card) => (
              <label
                key={card.id}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 hover:border-gray-600"
              >
                <input
                  type="checkbox"
                  checked={visibleCardIds.includes(card.id)}
                  onChange={() => toggleCard(card.id)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-brand-500 focus:ring-brand-500"
                />
                <span className="min-w-0 truncate">{card.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {shownCards.map((card) => (
          <SummaryCard key={card.id} {...card} />
        ))}
      </div>
    </div>
  );
}
