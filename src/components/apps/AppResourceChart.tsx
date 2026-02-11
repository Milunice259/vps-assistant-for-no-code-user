"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { RefreshCw, Cpu, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ContainerStats, AppMetricInfo } from "@/types";

interface AppResourceChartProps {
  liveStats: ContainerStats | null;
  metrics: AppMetricInfo[];
  cpuLimit: number | null;
  memoryLimit: number | null;
  onRefresh: () => void;
}

export function AppResourceChart({
  liveStats,
  metrics,
  cpuLimit,
  memoryLimit,
  onRefresh,
}: AppResourceChartProps) {
  const chartData = metrics.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cpu: m.cpuUsage,
    memory: m.memUsage,
    netIn: m.netIn ? m.netIn / 1024 : 0, // KB/s
    netOut: m.netOut ? m.netOut / 1024 : 0,
  }));

  return (
    <div className="space-y-6">
      {/* Live Stats */}
      {liveStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <GaugeCard
            icon={<Cpu className="h-4 w-4" />}
            label="CPU Usage"
            value={liveStats.cpuPercent}
            max={cpuLimit ? cpuLimit * 100 : 100}
            unit="%"
            color="#3b82f6"
          />
          <GaugeCard
            icon={<HardDrive className="h-4 w-4" />}
            label="Memory"
            value={liveStats.memUsageMB}
            max={memoryLimit || liveStats.memLimitMB || 1024}
            unit="MB"
            color="#8b5cf6"
          />
          <InfoCard label="PIDs (Processes)" value={String(liveStats.pids)} />
          <InfoCard label="Mem %" value={`${liveStats.memPercent.toFixed(1)}%`} />
        </div>
      )}

      {/* Historical Charts */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Resource History</h3>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {metrics.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No metrics history yet. Metrics are collected periodically when the app is running.
        </div>
      ) : (
        <div className="space-y-6">
          {/* CPU Chart */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h4 className="text-xs text-gray-400 mb-3 uppercase tracking-wider">CPU Usage (%)</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} domain={[0, "auto"]} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                  labelStyle={{ color: "#9ca3af" }}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="CPU %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Memory Chart */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h4 className="text-xs text-gray-400 mb-3 uppercase tracking-wider">Memory Usage (MB)</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} domain={[0, "auto"]} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                  labelStyle={{ color: "#9ca3af" }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  name="Memory (MB)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function GaugeCard({
  icon,
  label,
  value,
  max,
  unit,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
}) {
  const pct = Math.min((value / max) * 100, 100);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-lg font-semibold text-white">
        {value.toFixed(1)} <span className="text-xs text-gray-500">{unit}</span>
      </p>
      <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {pct.toFixed(0)}% of {max} {unit}
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
