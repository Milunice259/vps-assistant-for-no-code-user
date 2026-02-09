"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, RefreshCw, Search, ArrowUpCircle, Monitor } from "lucide-react";
import type { PackageInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

export function PackageManager() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [logOutput, setLogOutput] = useState("");

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlatformError(null);
    try {
      const res = await fetch("/api/network/packages");
      const json = await res.json();

      // Handle platform-specific error with friendly message
      if (json.error === "UNSUPPORTED_PLATFORM") {
        setPlatformError(json.message);
        return;
      }

      if (!res.ok) throw new Error(json.error || "Failed to load packages");
      setPackages(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const runAction = async (action: "update" | "upgrade") => {
    setActionLoading(true);
    setLogOutput("");
    try {
      const res = await fetch("/api/network/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setLogOutput(json.data?.output ?? json.error ?? "Done");
      if (action === "update") fetchPackages();
    } catch (err) {
      setLogOutput(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Packages</h2>
        {!platformError && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={actionLoading}
              onClick={() => runAction("update")}
            >
              <RefreshCw className="h-4 w-4" />
              Update List
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={actionLoading}
              onClick={() => runAction("upgrade")}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Upgrade All
            </Button>
          </div>
        )}
      </div>

      {/* Friendly platform warning */}
      {platformError && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-4">
          <Monitor className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-400" />
          <div>
            <p className="font-medium text-yellow-300">
              Linux Server Required
            </p>
            <p className="mt-1 text-sm text-yellow-200/70">
              {platformError}
            </p>
          </div>
        </div>
      )}

      {/* Regular errors */}
      {error && !platformError && (
        <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Content -- hidden when platform not supported */}
      {!platformError && (
        <>
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Filter packages..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Package list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
              <Package className="h-10 w-10" />
              <p>No packages found.</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto rounded-xl border border-gray-700">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-gray-700 bg-gray-800 text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Upgrade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filtered.map((pkg) => (
                    <tr
                      key={pkg.name}
                      className="bg-gray-800 transition-colors hover:bg-gray-750"
                    >
                      <td className="px-4 py-2 font-mono text-white">
                        {pkg.name}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-400">
                        {pkg.version}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={pkg.upgradable ? "warning" : "success"}>
                          {pkg.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-gray-400">
                        {pkg.upgradable && pkg.newVersion ? (
                          <span className="text-yellow-400">{pkg.newVersion}</span>
                        ) : (
                          <span className="text-gray-600">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Log output */}
          {logOutput && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-300">Command Output</h3>
              <pre className="max-h-48 overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-gray-300">
                {logOutput}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
