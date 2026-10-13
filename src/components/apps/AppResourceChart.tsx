"use client";

import { useTranslation } from "@/lib/i18n";
import { useRef, useEffect, useState, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ContainerStats } from "@/types";

type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";
interface ChartPoint {
  time: string;
  cpu: number | null;
  mem: number | null;
  netIn: number | null;
  netOut: number | null;
  gap?: string;
}
interface AppResourceChartProps {
  appId: string;
  liveStats: ContainerStats | null;
  metrics: unknown[];
  cpuLimit: number | null;
  memoryLimit: number | null;
  onRefresh: () => void;
}

export function AppResourceChart(props: AppResourceChartProps) {
  return <TargetResourceChart key={props.appId} appId={props.appId} />;
}

function TargetResourceChart({ appId }: { appId: string }) {
  const { formatDate } = useTranslation();
  const [range, setRange] = useState<TimeRange>("1h");
  const [refresh, setRefresh] = useState(0);
  const [liveMode, setLiveMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [intervalMs, setIntervalMs] = useState(60_000);
  const historyRead = useRef(0);

  const fetchHistory = useCallback(async (r: TimeRange, controller: AbortController) => {
    const signal = controller.signal;
    const read = ++historyRead.current;
    const timeout = setTimeout(() => {
      controller.abort();
      if (read === historyRead.current) {
        setHistory([]);
        setError("Metric history timed out. Try again.");
        setLoading(false);
      }
    }, 20_000);
    setLoading(true);
    setError(null);
    // Hide stale/private history while authorization is being rechecked.
    setHistory([]);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/metrics?range=${r}`, { cache: "no-store", signal });
      if (signal.aborted || read !== historyRead.current) return;
      if (!res.ok) {
        setError(res.status === 401 || res.status === 403 ? "Access denied. Previous history is hidden." : "Metric history unavailable. Try again.");
        return;
      }
      const json = await res.json();
      if (signal.aborted || read !== historyRead.current) return;
      if (!json.success || !Array.isArray(json.data?.points)) throw new Error("Invalid history");
      const points = json.data.points as ChartPoint[];
      if (points.length > 2000 || points.some(p => !p || !Number.isFinite(Date.parse(p.time)) || [p.cpu, p.mem, p.netIn, p.netOut].some(v => v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)))) throw new Error("Invalid history");
      setHistory([...new Map(points.map(p => [p.time, p])).values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)));
      setIntervalMs(Number.isFinite(json.data.intervalMs) && json.data.intervalMs >= 1000 ? json.data.intervalMs : 60_000);
    } catch {
      if (!signal.aborted && read === historyRead.current) setError("Offline or metric history unavailable. Try again.");
    } finally {
      clearTimeout(timeout);
      if (!signal.aborted && read === historyRead.current) setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      void fetchHistory(range, controller);
    };
    load();
    // ponytail: read-only minute polling; the supervised collector owns persistence.
    const timer = liveMode ? setInterval(load, 60_000) : null;
    const read = historyRead;
    return () => { controller?.abort(); if (timer) clearInterval(timer); read.current++; };
  }, [fetchHistory, range, liveMode, refresh]);

  const chartData: (ChartPoint & { timestamp: number })[] = [];
  for (const p of history) {
    const timestamp = Date.parse(p.time);
    const previous = chartData.at(-1);
    if (previous && timestamp - previous.timestamp > intervalMs * 2) chartData.push({ time: new Date(previous.timestamp + intervalMs).toISOString(), timestamp: previous.timestamp + intervalMs, cpu: null, mem: null, netIn: null, netOut: null });
    chartData.push({ ...p, timestamp, ...(p.gap ? { cpu: null, mem: null, netIn: null, netOut: null } : {}) });
  }
  const observed = history.filter(p => !p.gap && p.cpu !== null && p.mem !== null);
  const latest = observed.at(-1);
  const charts = [
    { key: "cpu", title: "CPU usage (%)", color: "#3b82f6" },
    { key: "mem", title: "Memory usage (MB)", color: "#8b5cf6" },
    { key: "netIn", title: "Network received (cumulative bytes)", color: "#10b981" },
    { key: "netOut", title: "Network sent (cumulative bytes)", color: "#f59e0b" },
  ];

  return <section className="space-y-4 min-w-0" aria-label="Saved resource history" aria-busy={loading}>
    <div className="flex flex-wrap items-center gap-2">
      {(["1h", "6h", "24h", "7d", "30d"] as TimeRange[]).map(r => <button type="button" key={r} aria-pressed={range === r && !liveMode} onClick={() => { setRange(r); setLiveMode(false); }} className={`min-h-11 px-3 rounded-lg border text-sm ${range === r && !liveMode ? "border-brand-500 text-white" : "border-gray-700 text-gray-400"}`}>{r}</button>)}
      <button type="button" aria-pressed={liveMode} onClick={() => { setLiveMode(v => !v); setRange("1h"); }} className="min-h-11 px-3 rounded-lg border border-gray-700 text-sm text-gray-300">Auto refresh: {liveMode ? "On" : "Off"}</button>
      <button type="button" disabled={loading} onClick={() => setRefresh(v => v + 1)} className="min-h-11 px-3 text-sm text-gray-300 disabled:opacity-50">Refresh history</button>
    </div>
    <p className="text-xs text-gray-400">Saved collector readings · 30-day retention · gaps are not zero usage. Network counters can reset after a restart.</p>
    <div role="status" aria-live="polite" className="text-sm text-gray-400 break-words">
      {loading ? "Loading saved history…" : error || (observed.length === 0 ? "No saved readings in this range. The collector may be disabled, unavailable, or this app may not support metrics." : `${observed.length} saved readings`)}
    </div>
    {!loading && !error && latest && <p className="text-xs text-gray-400">Last saved reading: {formatDate(latest.time, { dateStyle: "short", timeStyle: "medium" })}{Date.now() - Date.parse(latest.time) > intervalMs * 2 ? " · Collection gap: no recent reading" : ""} · CPU {latest.cpu?.toFixed(1)}% · Memory {latest.mem?.toFixed(1)} MB</p>}
    {!loading && !error && observed.length === 1 && <p className="text-sm text-gray-400">One saved reading. Charts need at least two readings.</p>}
    {!loading && !error && observed.length >= 2 && <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {charts.map(chart => <div key={chart.key} className="min-w-0 rounded-lg border border-gray-800 p-3" role="img" aria-label={`${chart.title}; ${observed.length} saved readings; missing readings shown as gaps`}>
        <h4 className="text-sm text-gray-300 mb-3">{chart.title}</h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={v => formatDate(new Date(v).toISOString(), { hour: "2-digit", minute: "2-digit", ...(range === "7d" || range === "30d" ? { month: "2-digit", day: "2-digit" } : {}) })} tick={{ fill: "#9ca3af", fontSize: 10 }} minTickGap={60} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} domain={[0, "auto"]} />
            <Tooltip labelFormatter={v => formatDate(new Date(Number(v)).toISOString(), { dateStyle: "short", timeStyle: "medium" })} contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }} />
            <Area type="linear" dataKey={chart.key} name={chart.title} stroke={chart.color} fill={chart.color} fillOpacity={0.12} connectNulls={false} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>)}
    </div>}
  </section>;
}
