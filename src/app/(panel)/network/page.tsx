"use client";

import { useState } from "react";
import { PortTable } from "@/components/network/PortTable";
import {
  NetworkTopologyView,
  ServerSelector,
} from "@/components/network/NetworkTopology";

export default function NetworkPage() {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* Remote Server Network Topology */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Network Topology
          </h2>
          <ServerSelector
            selectedId={selectedServerId}
            onSelect={setSelectedServerId}
          />
        </div>
        {selectedServerId ? (
          <NetworkTopologyView serverId={selectedServerId} />
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400">
              Select a server above to view its network topology
            </p>
          </div>
        )}
      </section>

      {/* Host Machine Ports */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">
          Host Open Ports
        </h2>
        <PortTable />
      </section>
    </div>
  );
}
