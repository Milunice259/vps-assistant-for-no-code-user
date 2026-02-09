"use client";

import { PortTable } from "@/components/network/PortTable";
import { PackageManager } from "@/components/network/PackageManager";

export default function NetworkPage() {
  return (
    <div className="space-y-8">
      {/* Open Ports Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Open Ports</h2>
        <PortTable />
      </section>

      {/* Package Manager Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">
          Package Manager
        </h2>
        <PackageManager />
      </section>
    </div>
  );
}
