"use client";

import { useRef, useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ContainerStats } from "@/types";

const MAX_HISTORY = 60; // ~10 min at 10s intervals

interface HistoryPoint {
  time: string;
  cpu: number;
  mem: number;
  memPercent: number;
  netIn: number;
  netOut: number;
  pids: number;
}

interface AppResourceChartProps {
  liveStats: ContainerStats | null;
  metrics: unknown[]; // kept for interface compat, unused
  cpuLimit: number | null;
  memoryLimit: number | null;
  onRefresh: () => void;
}

export function AppResourceChart({
  liveStats,
  cpuLimit,
  memoryLimit,
}: AppResourceChartProps) {
  const historyRef = useRef<HistoryPoint[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const prevNetRef = useRef<{ netIn: number; netOut: number } | null>(null);
  const [netRate, setNetRate] = useState({ inRate: 0, outRate: 0 });

  // Accumulate SSE stream data into history
  useEffect(() => {
    if (!liveStats) return;

    const now = new Date();
    const time = now.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Calculate net rates (delta between successive readings)
    const prev = prevNetRef.current;
    let inRate = 0;
    let outRate = 0;
    if (prev) {
      const dIn = liveStats.netIn - prev.netIn;
      const dOut = liveStats.netOut - prev.netOut;
      // SSE interval is ~10s
      inRate = Math.max(0, dIn / 10);
      outRate = Math.max(0, dOut / 10);
    }
    prevNetRef.current = { netIn: liveStats.netIn, netOut: liveStats.netOut };
    setNetRate({ inRate, outRate });

    const point: HistoryPoint = {
      time,
      cpu: liveStats.cpuPercent,
      mem: liveStats.memUsageMB,
      memPercent: liveStats.memPercent,
      netIn: inRate,
      netOut: outRate,
      pids: liveStats.pids,
    };

    const updated = [...historyRef.current, point].slice(-MAX_HISTORY);
    historyRef.current = updated;
    setHistory(updated);
  }, [liveStats]);

  if (!liveStats) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        Waiting for container stats…
      </div>
    );
  }

  const memLimit = memoryLimit || liveStats.memLimitMB || 0;

  return (
    <div className="space-y-6">
      {/* Resource Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <InfoCard
          label="Processes"
          value={String(liveStats.pids)}
          hint="Running PIDs"
          color="blue"
        />
        <InfoCard
          label="Mem Usage"
          value={`${liveStats.memPercent.toFixed(1)}%`}
          hint={`${liveStats.memUsageMB.toFixed(0)} / ${memLimit.toFixed(0)} MB`}
          color="purple"
        />
        <InfoCard
          label="CPU Limit"
          value={cpuLimit ? `${cpuLimit} cores` : "∞"}
          hint={cpuLimit ? "Restricted" : "Unlimited"}
          color="sky"
        />
        <InfoCard
          label="Mem Limit"
          value={memLimit ? `${memLimit.toFixed(0)} MB` : "∞"}
          hint={memoryLimit ? "Restricted" : "Host limit"}
          color="violet"
        />
        <InfoCard
          label="Net In /s"
          value={formatRate(netRate.inRate)}
          hint="Current throughput"
          color="emerald"
        />
        <InfoCard
          label="Net Out /s"
          value={formatRate(netRate.outRate)}
          hint="Current throughput"
          color="amber"
        />
      </div>

      {/* Real-time Charts */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-300">
          Live Resource Timeline
          <span className="ml-2 text-xs text-gray-500 font-normal">
            (auto-updates every 10s)
          </span>
        </h3>

        {history.length < 2 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Collecting data points… Charts appear after 2 readings (~20s).
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* CPU Chart */}
            <ChartCard title="CPU Usage (%)">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, "auto"]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v: number) => [`${v.toFixed(2)}%`, "CPU"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#cpuGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Memory Chart */}
            <ChartCard title="Memory Usage (MB)">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, "auto"]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v: number) => [`${v.toFixed(1)} MB`, "Memory"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="mem"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="url(#memGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Network I/O Chart */}
            <ChartCard title="Network Throughput (/s)">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="netInGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="netOutGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, "auto"]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v: number) => [formatRate(v), undefined]}
                  />
                  <Area
                    type="monotone"
                    dataKey="netIn"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#netInGrad)"
                    dot={false}
                    name="In"
                    animationDuration={300}
                  />
                  <Area
                    type="monotone"
                    dataKey="netOut"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#netOutGrad)"
                    dot={false}
                    name="Out"
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* PIDs Chart */}
            <ChartCard title="Processes (PIDs)">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="pidGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, "auto"]} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v: number) => [v, "PIDs"]}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="pids"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fill="url(#pidGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
      <h4 className="text-xs text-gray-400 mb-3 uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </div>
  );
}

const colorMap: Record<string, string> = {
  blue: "border-blue-500/20",
  purple: "border-purple-500/20",
  sky: "border-sky-500/20",
  violet: "border-violet-500/20",
  emerald: "border-emerald-500/20",
  amber: "border-amber-500/20",
};

const textColorMap: Record<string, string> = {
  blue: "text-blue-400",
  purple: "text-purple-400",
  sky: "text-sky-400",
  violet: "text-violet-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
};

function InfoCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div
      className={`bg-gray-900/50 border rounded-lg p-3 ${colorMap[color] || "border-gray-800"}`}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${textColorMap[color] || "text-white"}`}>
        {value}
      </p>
      <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>
    </div>
  );
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB`;
  if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(1)} KB`;
  return `${bytesPerSec.toFixed(0)} B`;
}
