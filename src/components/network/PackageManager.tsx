"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Package,
  RefreshCw,
  Search,
  ArrowUpCircle,
  Monitor,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
} from "lucide-react";
import type { PackageInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

/* ── Well-known package descriptions ── */
const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  nginx: "High-performance web server and reverse proxy",
  "docker-ce": "Docker container runtime engine",
  docker: "Docker container runtime engine",
  "docker.io": "Docker container runtime engine",
  openssh: "Secure shell (SSH) remote access tool",
  "openssh-server": "Secure shell (SSH) server for remote access",
  "openssh-client": "Secure shell (SSH) client tool",
  curl: "Command-line tool for transferring data via URLs",
  wget: "Tool for downloading files from the internet",
  git: "Version control system for tracking code changes",
  nodejs: "JavaScript runtime for server applications",
  node: "JavaScript runtime for server applications",
  python3: "Python 3 programming language interpreter",
  "python3-pip": "Package installer for Python libraries",
  postgresql: "Powerful open-source relational database",
  "postgresql-client": "Client tools for PostgreSQL database",
  mysql: "Popular open-source relational database",
  "mysql-server": "MySQL database server",
  redis: "In-memory data store used for caching",
  "redis-server": "Redis caching and message broker server",
  certbot: "Tool for obtaining free SSL/TLS certificates",
  ufw: "Uncomplicated Firewall — easy firewall management",
  fail2ban: "Intrusion prevention — blocks brute-force attacks",
  cron: "Scheduled task runner",
  htop: "Interactive system process monitor",
  vim: "Text editor for the terminal",
  nano: "Simple text editor for the terminal",
  tar: "File archive/compression utility",
  zip: "File compression utility",
  unzip: "Tool to extract ZIP archives",
  net: "Network diagnostic tools",
  "net-tools": "Network configuration and diagnostic tools",
  iproute2: "Modern network configuration utilities",
  iptables: "Network firewall rules manager",
  sudo: "Run commands with root/administrator privileges",
  coreutils: "Essential system command-line utilities",
  bash: "Default command-line shell",
  systemd: "System and service manager",
  apt: "Package manager for Debian/Ubuntu systems",
  "ca-certificates": "Root certificates for HTTPS verification",
  gnupg: "Encryption and signing tool (GPG)",
  "build-essential": "C/C++ compiler and build tools",
  make: "Build automation tool",
  gcc: "GNU C/C++ compiler",
  "libssl-dev": "SSL/TLS development libraries",
  traefik: "Modern reverse proxy and load balancer",
};

function getPackageDescription(name: string): string | null {
  // Exact match
  if (PACKAGE_DESCRIPTIONS[name]) return PACKAGE_DESCRIPTIONS[name];
  // Try without version suffix (e.g., python3.11 → python3)
  const base = name.replace(/[0-9.]+$/, "");
  if (PACKAGE_DESCRIPTIONS[base]) return PACKAGE_DESCRIPTIONS[base];
  return null;
}

/* ── Tooltip ── */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1.5 cursor-help">
      <HelpCircle className="h-3 w-3 text-gray-600 group-hover:text-gray-400 transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

/* ── Status message component ── */
function StatusMessage({ type, message }: { type: "success" | "error" | "loading"; message: string }) {
  const styles = {
    success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    error: "bg-red-500/10 border-red-500/20 text-red-400",
    loading: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  };
  const icons = {
    success: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    error: <AlertCircle className="h-4 w-4 shrink-0" />,
    loading: <Loader2 className="h-4 w-4 shrink-0 animate-spin" />,
  };

  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-sm ${styles[type]}`}>
      {icons[type]}
      {message}
    </div>
  );
}

export function PackageManager() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
    setActionResult(null);
    try {
      const res = await fetch("/api/network/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();

      if (json.success) {
        if (action === "update") {
          setActionResult({ type: "success", message: "Package list updated successfully." });
          fetchPackages();
        } else {
          const upgradeCount = json.data?.upgradedCount;
          setActionResult({
            type: "success",
            message: upgradeCount
              ? `${upgradeCount} package(s) upgraded successfully.`
              : "All packages are up to date — nothing to upgrade.",
          });
        }
      } else {
        setActionResult({
          type: "error",
          message: json.error || "Operation failed. Please check server connectivity.",
        });
      }
    } catch {
      setActionResult({
        type: "error",
        message: "Connection error — could not reach the server.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(filter.toLowerCase())
  );

  const upgradableCount = packages.filter((p) => p.upgradable).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Server System Packages</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Software installed on the host server operating system
          </p>
        </div>
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
              {upgradableCount > 0 && (
                <span className="ml-1 bg-yellow-500/20 text-yellow-300 text-xs px-1.5 py-0.5 rounded-full">
                  {upgradableCount}
                </span>
              )}
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

      {/* Action result — friendly visual feedback instead of raw output */}
      {actionResult && (
        <StatusMessage type={actionResult.type} message={actionResult.message} />
      )}
      {actionLoading && !actionResult && (
        <StatusMessage type="loading" message="Processing... this may take a few minutes." />
      )}

      {/* Regular errors */}
      {error && !platformError && (
        <StatusMessage type="error" message={error} />
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
                  {filtered.map((pkg) => {
                    const desc = getPackageDescription(pkg.name);
                    return (
                      <tr
                        key={pkg.name}
                        className="bg-gray-800 transition-colors hover:bg-gray-750"
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-white">{pkg.name}</span>
                            {desc && <Tip text={desc} />}
                          </div>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
