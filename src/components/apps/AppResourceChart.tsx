"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ContainerStats, MetricPoint, ApiResponse } from "@/types";

// ─── Time range definitions ───

type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";

const RANGES: { key: TimeRange; label: string }[] = [
  { key: "1h", label: "1 Giờ" },
  { key: "6h", label: "6 Giờ" },
  { key: "24h", label: "24 Giờ" },
  { key: "7d", label: "7 Ngày" },
  { key: "30d", label: "30 Ngày" },
];

interface ChartPoint {
  time: string;     // display label
  timestamp: number; // ms for dedup
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
}

interface AppResourceChartProps {
  appId: string;
  liveStats: ContainerStats | null;
  metrics: unknown[]; // kept for interface compat
  cpuLimit: number | null;
  memoryLimit: number | null;
  onRefresh: () => void;
}

/** Format timestamp for X-axis based on selected range */
function formatTime(iso: string, range: TimeRange): string {
  const d = new Date(iso);
  if (range === "7d" || range === "30d") {
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) +
      " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AppResourceChart({
  appId,
  liveStats,
  cpuLimit,
  memoryLimit,
}: AppResourceChartProps) {
  const [range, setRange] = useState<TimeRange>("1h");
  const [liveMode, setLiveMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<ChartPoint[]>([]);

  // Track previous net values for rate calculation
  const prevNetRef = useRef<{ netIn: number; netOut: number } | null>(null);
  const [netRate, setNetRate] = useState({ inRate: 0, outRate: 0 });

  // ── Fetch historical data from API ──
  const fetchHistory = useCallback(async (r: TimeRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/apps/${appId}/metrics?range=${r}`);
      const json: ApiResponse<{ points: MetricPoint[] }> = await res.json();
      if (json.success && json.data) {
        const pts: ChartPoint[] = json.data.points.map((p) => ({
          time: formatTime(p.time, r),
          timestamp: new Date(p.time).getTime(),
          cpu: p.cpu,
          mem: p.mem,
          netIn: p.netIn,
          netOut: p.netOut,
        }));
        setHistory(pts);
      }
    } catch {
      // Fetch failed — start with empty
    } finally {
      setLoading(false);
    }
  }, [appId]);

  // Load historical data on mount and when range changes
  useEffect(() => {
    fetchHistory(range);
  }, [fetchHistory, range]);

  // ── Append live SSE data ──
  useEffect(() => {
    if (!liveStats || !liveMode) return;

    // Calculate net rates
    const prev = prevNetRef.current;
    let inRate = 0;
    let outRate = 0;
    if (prev) {
      const dIn = liveStats.netIn - prev.netIn;
      const dOut = liveStats.netOut - prev.netOut;
      inRate = Math.max(0, dIn / 10);
      outRate = Math.max(0, dOut / 10);
    }
    prevNetRef.current = { netIn: liveStats.netIn, netOut: liveStats.netOut };
    setNetRate({ inRate, outRate });

    const now = new Date();
    const point: ChartPoint = {
      time: formatTime(now.toISOString(), range),
      timestamp: now.getTime(),
      cpu: liveStats.cpuPercent,
      mem: liveStats.memUsageMB,
      netIn: inRate,
      netOut: outRate,
    };

    setHistory((prev) => {
      // Prevent duplicate timestamps (within 5s)
      if (prev.length > 0 && Math.abs(prev[prev.length - 1].timestamp - point.timestamp) < 5000) {
        return prev;
      }
      // Trim to keep chart manageable — keep last ~500 points in live mode
      const updated = [...prev, point];
      return updated.length > 500 ? updated.slice(-500) : updated;
    });
  }, [liveStats, liveMode, range]);

  // ── Render ──

  const memLimit = memoryLimit || liveStats?.memLimitMB || 0;

  return (
    <div className="space-y-6">
      {/* Resource Info Cards */}
      {liveStats && (
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
      )}

      {/* Time Range Selector + Live Toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-700 bg-gray-900/50 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => { setRange(r.key); setLiveMode(false); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === r.key && !liveMode
                  ? "bg-brand-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setLiveMode(true); setRange("1h"); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            liveMode
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-gray-700 bg-gray-900/50 text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveMode ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
          Live
        </button>
        {loading && (
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        )}
        <span className="ml-auto text-[10px] text-gray-600">
          {history.length} data points
        </span>
      </div>

      {/* Charts */}
      <div className="space-y-4">
        {history.length < 2 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            {loading
              ? "Loading historical data…"
              : "Collecting data points… Charts appear after 2 readings (~20s)."}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* CPU Chart */}
            <ChartCard title="CPU Usage (%)">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
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
                    strokeWidth={1.5}
                    fill="url(#cpuGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Memory Chart */}
            <ChartCard title="Memory Usage (MB)">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
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
                    strokeWidth={1.5}
                    fill="url(#memGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Network I/O Chart */}
            <ChartCard title="Network Throughput (/s)">
              <ResponsiveContainer width="100%" height={200}>
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
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
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
                    strokeWidth={1.5}
                    fill="url(#netInGrad)"
                    dot={false}
                    name="In"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="netOut"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    fill="url(#netOutGrad)"
                    dot={false}
                    name="Out"
                    isAnimationActive={false}
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
