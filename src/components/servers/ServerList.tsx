"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Server } from "lucide-react";
import type { ServerInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ServerForm } from "./ServerForm";

export function ServerList() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Servers</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={fetchServers}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-6">
          <ServerForm
            onSuccess={() => {
              setShowForm(false);
              fetchServers();
            }}
          />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
          <Server className="h-10 w-10" />
          <p>No servers configured yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700">
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead className="border-b border-gray-700 bg-gray-800/50 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Connected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {servers.map((server) => (
                <tr
                  key={server.id}
                  className="bg-gray-800 transition-colors hover:bg-gray-750"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/servers/${server.id}`}
                      className="font-medium text-white hover:text-brand-400"
                    >
                      {server.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-300">
                    {server.host}:{server.port}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={server.isActive ? "success" : "danger"}>
                      {server.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {server.lastConnected
                      ? new Date(server.lastConnected).toLocaleString()
                      : "Never"}
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
