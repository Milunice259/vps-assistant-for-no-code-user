/**
 * Network Map card components — Internet, Server, Network, Container, Detail, StatChip.
 */

import {
  Globe,
  Box,
  Network,
  Server,
  Container,
} from "lucide-react";
import type { DockerNetworkInfo } from "@/types";
import type { CardRect } from "./types";
import { NETWORK_PALETTE, containerStatusColor, parsePortString, formatPortsBadge } from "./types";

/* ── Internet Card ── */

export function InternetCard({ card }: { card: CardRect }) {
  return (
    <div
      className="absolute flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 backdrop-blur-sm cursor-default select-none transition-all hover:border-amber-400/50 hover:shadow-lg hover:shadow-amber-500/10"
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
    >
      <Globe className="h-5 w-5 text-amber-400" />
      <span className="text-sm font-semibold text-amber-200">Internet</span>
    </div>
  );
}

/* ── Server Card ── */

export function ServerCard({ card, hostname }: { card: CardRect; hostname?: string }) {
  return (
    <div
      className="absolute flex items-center gap-3 rounded-2xl border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 backdrop-blur-sm px-4 cursor-default select-none transition-all hover:border-blue-400/50 hover:shadow-lg hover:shadow-blue-500/10"
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
    >
      <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
        <Server className="h-5 w-5 text-blue-400" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white truncate" title={hostname || "Server"}>{hostname || "Server"}</p>
        <p className="text-[10px] text-blue-300/60">Docker Host</p>
      </div>
    </div>
  );
}

/* ── Network Card ── */

export function NetworkCard({
  card,
  net,
  colorIdx,
}: {
  card: CardRect;
  net: DockerNetworkInfo;
  colorIdx: number;
}) {
  const palette = NETWORK_PALETTE[colorIdx % NETWORK_PALETTE.length];

  return (
    <div
      className="absolute rounded-xl border backdrop-blur-sm px-3.5 py-2.5 cursor-default select-none transition-all hover:shadow-lg group"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        backgroundColor: palette.bgFade,
        borderColor: palette.border,
      }}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${palette.bg}20`, border: `1px solid ${palette.bg}40` }}
        >
          <Network className="h-3.5 w-3.5" style={{ color: palette.bg }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate" title={net.name}>{net.name}</p>
          <p className="text-[10px] text-gray-400" title={`${net.driver} · ${net.containers.length} container(s): ${net.containers.map(c => c.name).join(', ')}`}>
            {net.driver} · {net.containers.length} app{net.containers.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Container Card ── */

export function ContainerCard({
  card,
  container,
  onSelect,
}: {
  card: CardRect;
  container: { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string };
  onSelect?: (container: { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string }) => void;
}) {
  const status = containerStatusColor(container.state);
  const ports = parsePortString(container.ports);
  const fullInfo = [container.name, container.image, container.ipv4, container.ports].filter(Boolean).join(' | ');

  return (
    <div
      className="absolute rounded-xl border backdrop-blur-sm px-3.5 py-3 cursor-pointer select-none transition-all hover:shadow-lg hover:brightness-110 group"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        backgroundColor: status.bg,
        borderColor: status.border,
      }}
      title={fullInfo}
      onClick={(e) => { e.stopPropagation(); onSelect?.(container); }}
    >
      {/* Status bar left */}
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full" style={{ backgroundColor: status.dot }} />

      <div className="ml-2 space-y-1">
        {/* Row 1: Name + status */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: status.dot }} />
          <p className="text-xs font-semibold text-white truncate flex-1" title={container.name}>{container.name}</p>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
            style={{ color: status.dot, backgroundColor: `${status.dot}15` }}
          >
            {status.label}
          </span>
        </div>

        {/* Row 2: Image */}
        {container.image && (
          <p className="text-[10px] text-gray-500 font-mono truncate pl-4" title={container.image}>
            {container.image.split(":")[0]?.split("/").pop()}
            {container.image.includes(":") ? `:${container.image.split(":")[1]}` : ""}
          </p>
        )}

        {/* Row 3: IP + Ports */}
        <div className="flex items-center gap-2 pl-4 flex-wrap">
          {container.ipv4?.trim() && (
            <span className="text-[10px] text-gray-500 font-mono">
              {container.ipv4.trim()}
            </span>
          )}
          {ports.length > 0 && (
            <div className="flex items-center gap-1">
              {ports.slice(0, 4).map((p, i) => (
                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">
                  :{p.host}→{p.container}
                </span>
              ))}
              {ports.length > 4 && (
                <span className="text-[9px] text-gray-600">+{ports.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Detail Row ── */

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-sm text-white font-mono break-all">{value}</p>
    </div>
  );
}

/* ── Stat Chip ── */

export function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5 border border-gray-700">
      <span className={color}>{icon}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

/* ── Network Detail List (bottom section) ── */

export function NetworkDetailList({
  orderedNets,
  onSelectContainer,
}: {
  orderedNets: DockerNetworkInfo[];
  onSelectContainer: (c: { name: string; image?: string; state?: string; ipv4: string; ports?: string; id: string }) => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
        <Server className="h-4 w-4" />
        Network Details
      </h4>
      {orderedNets.map((net, i) => {
        const palette = NETWORK_PALETTE[i % NETWORK_PALETTE.length];
        return (
          <div key={net.id} className="bg-gray-900 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: palette.bg }} />
              <span className="text-sm font-medium text-white">{net.name}</span>
              <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-gray-600 text-gray-300">{net.driver}</span>
              <span className="text-xs text-gray-500 ml-auto">
                {net.containers.length} container{net.containers.length !== 1 ? "s" : ""}
              </span>
            </div>

            {net.containers.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No containers in this network</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {net.containers.map(cont => {
                  const colors = containerStatusColor(cont.state);
                  return (
                    <div key={cont.id || cont.name} className="flex items-start gap-2 bg-gray-800/60 rounded-lg p-2.5 border border-gray-700/40 cursor-pointer hover:bg-gray-800 hover:border-gray-600 transition-colors" onClick={() => onSelectContainer(cont)} title="Click to view full details">
                      <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: colors.dot }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-200 break-all" title={cont.name}>{cont.name}</p>
                        <p className="text-[10px] text-gray-500 break-all" title={cont.image || "—"}>{cont.image || "—"}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-medium" style={{ color: colors.dot }}>
                            {colors.label}
                          </span>
                          {cont.ipv4?.trim() && (
                            <span className="text-[10px] text-gray-600 font-mono">{cont.ipv4.trim()}</span>
                          )}
                          {cont.ports && (
                            <span className="text-[10px] text-amber-400/70 font-mono" title={cont.ports}>{formatPortsBadge(cont.ports)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
