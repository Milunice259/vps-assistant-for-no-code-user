"use client";

import { useState, useEffect } from "react";
import { PortTable } from "@/components/network/PortTable";
import dynamic from "next/dynamic";
const ServerNetworkMap = dynamic(
  () => import("@/components/servers/network-map").then((m) => m.ServerNetworkMap),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div> }
);
import type { ServerInfo } from "@/types";
import { PermissionGate } from "@/components/ui/PermissionGate";

/* ── Server selector dropdown ── */
function ServerSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/servers")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setServers(json.data || []);
          if (!selectedId && json.data?.length > 0) {
            onSelect(json.data[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return null;

  if (servers.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No servers configured. Add a server first.
      </p>
    );
  }

  return (
    <select
      value={selectedId || ""}
      onChange={(e) => onSelect(e.target.value)}
      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      <option value="" disabled>
        Select a server...
      </option>
      {servers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.host})
        </option>
      ))}
    </select>
  );
}

/* ── Network page ── */
export default function NetworkPage() {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  return (
    <PermissionGate minimum="OPERATOR">
    <div className="space-y-8">
      {/* Network Map */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Network Map
          </h2>
          <ServerSelector
            selectedId={selectedServerId}
            onSelect={setSelectedServerId}
          />
        </div>
        {selectedServerId ? (
          <ServerNetworkMap serverId={selectedServerId} />
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400">
              Select a server above to view its network map
            </p>
          </div>
        )}
      </section>

      {/* Host Machine Ports */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">
          Host Open Ports
        </h2>
        {selectedServerId ? (
          <PortTable serverId={selectedServerId} />
        ) : (
          <div className="rounded-xl border border-gray-700 bg-gray-800 p-8 text-center text-sm text-gray-400">
            Select a server above to view its open ports
          </div>
        )}
      </section>
    </div>
    </PermissionGate>
  );
}
