"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Search, Server } from "lucide-react";
import type { ServerInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ServerForm } from "./ServerForm";

type Filter = "all" | "local" | "remote" | "active" | "inactive";

export function ServerList() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/servers");
      const json = await res.json();
      if (json.data) setServers(json.data);
    } catch {
      setError("Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return servers.filter((server) => {
      const isLocal = server.id === "local";
      if (filter === "local" && !isLocal) return false;
      if (filter === "remote" && isLocal) return false;
      if (filter === "active" && !server.isActive) return false;
      if (filter === "inactive" && server.isActive) return false;
      if (!q) return true;
      return [server.name, server.host, server.username, server.hostname].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }, [filter, query, servers]);

  const localCount = servers.filter((s) => s.id === "local").length;
  const remoteCount = Math.max(servers.length - localCount, 0);
  const inactiveCount = servers.filter((s) => !s.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Servers</h2>
          <p className="mt-1 text-sm text-gray-500">Manage local and remote VPS control centers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={fetchServers}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Add Remote Server</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-4"><p className="text-xs text-gray-500">Local</p><p className="mt-1 text-2xl font-semibold text-white">{localCount}</p></div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-4"><p className="text-xs text-gray-500">Remote</p><p className="mt-1 text-2xl font-semibold text-white">{remoteCount}</p></div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-4"><p className="text-xs text-gray-500">Inactive</p><p className="mt-1 text-2xl font-semibold text-white">{inactiveCount}</p></div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-900/70 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input aria-label="Search servers" placeholder="Search name, host, username..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none">
          <option value="all">All servers</option>
          <option value="local">Local only</option>
          <option value="remote">Remote only</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</p>}

      {showForm && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-6">
          <ServerForm onSuccess={() => { setShowForm(false); fetchServers(); }} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-500"><Server className="h-10 w-10" /><p>No matching servers.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-gray-700 bg-gray-800/50 text-xs uppercase text-gray-400">
              <tr><th className="px-4 py-3">Server</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Host</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last Connected</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filtered.map((server) => {
                const isLocal = server.id === "local";
                return (
                  <tr key={server.id} className="bg-gray-800 transition-colors hover:bg-gray-750">
                    <td className="px-4 py-3"><Link href={`/servers/${server.id}`} className="font-medium text-white hover:text-brand-400">{server.name}</Link><p className="mt-0.5 text-xs text-gray-500">{server.hostname || server.username}</p></td>
                    <td className="px-4 py-3"><Badge variant={isLocal ? "info" : "default"}>{isLocal ? "Local" : "Remote"}</Badge></td>
                    <td className="px-4 py-3 font-mono text-gray-300">{isLocal ? server.host : `${server.username}@${server.host}:${server.port}`}</td>
                    <td className="px-4 py-3"><Badge variant={server.isActive ? "success" : "danger"}>{server.isActive ? "Active" : "Inactive"}</Badge></td>
                    <td className="px-4 py-3 text-gray-400">{server.lastConnected ? new Date(server.lastConnected).toLocaleString() : "Never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
