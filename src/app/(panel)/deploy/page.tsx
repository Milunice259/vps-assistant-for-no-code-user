"use client";

import { DeployForm } from "@/components/deploy/DeployForm";
import { DeployLog } from "@/components/deploy/DeployLog";

export default function DeployPage() {
  return (
    <div className="space-y-8">
      {/* Deploy New App */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">
          Deploy from GitHub
        </h2>
        <DeployForm />
      </section>

      {/* Deployment History */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">
          Deployment History
        </h2>
        <DeployLog />
      </section>
    </div>
  );
}
