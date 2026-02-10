"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Cog, RefreshCw, WifiOff, Filter } from "lucide-react";
import type { ServiceInfo, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface ServiceListProps {
  serverId: string;
}

type FilterMode = "all" | "active" | "failed";

function activeStateBadge(activeState: string) {
  switch (activeState.toLowerCase()) {
    case "active":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "inactive":
      return "default" as const;
    case "activating":
    case "deactivating":
      return "warning" as const;
    default:
      return "default" as const;
  }
}

export function ServiceList({ serverId }: ServiceListProps) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("active");

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisconnected(false);
    try {
      const res = await fetch(`/api/servers/${serverId}/services`);
      const json: ApiResponse<ServiceInfo[]> = await res.json();
      if (!res.ok) {
        if (json.code === "DISCONNECTED") {
          setDisconnected(true);
          return;
        }
        throw new Error(json.error || "Failed to load services");
      }
      setServices(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const filtered = services.filter((s) => {
    if (filter === "active") return s.activeState === "active";
    if (filter === "failed") return s.activeState === "failed";
    return true;
  });

  const failedCount = services.filter((s) => s.activeState === "failed").length;
  const activeCount = services.filter((s) => s.activeState === "active").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (disconnected) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <WifiOff className="h-8 w-8 text-gray-500" />
        <p className="text-sm text-gray-400">Server is offline</p>
        <Button variant="secondary" size="sm" onClick={fetchServices}>
          Retry
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchServices}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar and filter */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            Total: <span className="text-white">{services.length}</span>
          </span>
          <span className="text-gray-400">
            Active: <span className="text-emerald-400">{activeCount}</span>
          </span>
          {failedCount > 0 && (
            <span className="text-gray-400">
              Failed: <span className="text-red-400">{failedCount}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
            {(["active", "failed", "all"] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                  filter === f
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={fetchServices}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <Filter className="h-8 w-8 text-gray-500" />
          <p className="text-sm text-gray-400">No services match the filter</p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-3 font-medium">Service</th>
                <th className="pb-3 font-medium">State</th>
                <th className="pb-3 font-medium">Sub-State</th>
                <th className="pb-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((s) => (
                <tr key={s.name} className="hover:bg-gray-800/50">
                  <td className="py-2.5 text-white">
                    <div className="flex items-center gap-2">
                      <Cog className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                      <span className="font-mono text-xs">{s.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <Badge variant={activeStateBadge(s.activeState)}>
                      {s.activeState}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-gray-400 text-xs">{s.subState}</td>
                  <td className="py-2.5 text-gray-500 text-xs truncate max-w-[300px]">
                    {s.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
