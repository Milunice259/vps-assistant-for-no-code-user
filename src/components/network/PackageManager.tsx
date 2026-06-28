"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Package,
  RefreshCw,
  Search,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  ShieldCheck,
  Download,
} from "lucide-react";
import type { PackageInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useSafeMode } from "@/contexts/SafeModeContext";

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
  if (PACKAGE_DESCRIPTIONS[name]) return PACKAGE_DESCRIPTIONS[name];
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

interface PackageManagerProps {
  serverId?: string;
}

const INSTALLABLE_PACKAGES = ["openssl", "ca-certificates", "curl", "wget", "git", "unzip", "zip", "tar", "bash", "nano", "vim", "htop", "jq", "rsync", "cron", "ufw", "fail2ban", "certbot", "python3", "python3-pip", "nodejs", "npm", "make", "gcc", "g++", "build-essential", "docker", "docker.io", "docker-cli", "docker-compose", "docker-compose-plugin"];

export function PackageManager({ serverId = "local" }: PackageManagerProps) {
  const { safeMode } = useSafeMode();
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [installPackage, setInstallPackage] = useState("openssl");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [upgradingPkg, setUpgradingPkg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  const fetchPackages = useCallback(async (check = false) => {
    if (check) {
      setChecking(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      if (serverId !== "local") {
        setPackages([]);
        setHasChecked(false);
        return;
      }
      const url = check ? "/api/network/packages?check=1" : "/api/network/packages";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load packages");
      setPackages(json.data ?? []);
      if (check) setHasChecked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  /* ── Check for updates ── */
  const checkUpdates = () => fetchPackages(true);

  /* ── Bulk actions ── */
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
          const ct = json.data?.upgradedCount;
          setActionResult({
            type: "success",
            message: ct
              ? `${ct} package(s) upgraded successfully.`
              : "All packages are up to date — nothing to upgrade.",
          });
          fetchPackages(true); // Refresh with upgrade check
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

  const installSelectedPackage = async () => {
    if (safeMode) return;
    if (!confirm(`Install ${installPackage} on ${serverId}? You are responsible for package compatibility and security impact.`)) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/dependencies/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: installPackage }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Install failed");
      setActionResult({ type: "success", message: `${installPackage} installed successfully.` });
      fetchPackages();
    } catch (err) {
      setActionResult({ type: "error", message: err instanceof Error ? err.message : "Install failed." });
    } finally {
      setActionLoading(false);
    }
  };

  /* ── Per-package upgrade ── */
  const upgradePackage = async (pkgName: string) => {
    setUpgradingPkg(pkgName);
    setActionResult(null);
    try {
      const res = await fetch("/api/network/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upgrade", packages: [pkgName] }),
      });
      const json = await res.json();

      if (json.success) {
        setActionResult({
          type: "success",
          message: `${pkgName} upgraded successfully.`,
        });
        // Refresh package list
        fetchPackages(true);
      } else {
        setActionResult({
          type: "error",
          message: json.error || `Failed to upgrade ${pkgName}.`,
        });
      }
    } catch {
      setActionResult({
        type: "error",
        message: `Connection error — could not upgrade ${pkgName}.`,
      });
    } finally {
      setUpgradingPkg(null);
    }
  };

  const filtered = packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(filter.toLowerCase())
  );

  const upgradableCount = packages.filter((p) => p.upgradable).length;
  const totalCount = packages.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Server System Packages
            <Tip text="Packages are software programs installed on your server. Keeping them updated helps with security and stability." />
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Software installed on the host server operating system. Update regularly to keep your server secure.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={loading && !checking}
            onClick={() => fetchPackages()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={checking}
            onClick={checkUpdates}
          >
            <ShieldCheck className="h-4 w-4" />
            Check Updates
          </Button>
          {upgradableCount > 0 && (
            <Button
              variant="primary"
              size="sm"
              loading={actionLoading}
              disabled={safeMode}
              onClick={() => runAction("upgrade")}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Upgrade All
              <span className="ml-1 bg-yellow-500/20 text-yellow-300 text-xs px-1.5 py-0.5 rounded-full">
                {upgradableCount}
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {!loading && totalCount > 0 && (
        <div className="flex gap-3 text-xs">
          <span className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-300">
            📦 {totalCount} packages
          </span>
          {hasChecked && (
            <>
              {upgradableCount > 0 ? (
                <span className="px-3 py-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-300">
                  ⬆️ {upgradableCount} upgradable
                </span>
              ) : (
                <span className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-300">
                  ✅ All up to date
                </span>
              )}
            </>
          )}
          {!hasChecked && (
            <span className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-500 italic">
              Click &quot;Check Updates&quot; to scan for upgradable packages
            </span>
          )}
        </div>
      )}

      {/* Action result */}
      {actionResult && (
        <StatusMessage type={actionResult.type} message={actionResult.message} />
      )}
      {actionLoading && !actionResult && (
        <StatusMessage type="loading" message="Processing... this may take a few minutes." />
      )}

      {/* Regular errors */}
      {error && (
        <StatusMessage type="error" message={error} />
      )}

      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-yellow-100">Install dependency</h3>
            <p className="mt-1 text-xs text-yellow-100/70">
              Only install packages you understand. You are responsible for compatibility, security, and service impact.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={installPackage}
              onChange={(e) => setInstallPackage(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {INSTALLABLE_PACKAGES.map((pkg) => <option key={pkg} value={pkg}>{pkg}</option>)}
            </select>
            <Button variant="secondary" size="sm" loading={actionLoading} disabled={safeMode} onClick={installSelectedPackage}>
              <Download className="h-4 w-4" /> {safeMode ? "Locked by Safe Mode" : "Install package"}
            </Button>
          </div>
        </div>
      </div>

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
      {loading && packages.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
          <Package className="h-10 w-10" />
          <p>
            {packages.length === 0
              ? "No packages found. Package manager may not be available."
              : "No packages match your filter."}
          </p>
          {packages.length > 0 && (
            <p className="text-xs text-gray-600 max-w-sm text-center">
              Try a different search term.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[400px] overflow-auto rounded-xl border border-gray-700 touch-pan-x overscroll-x-contain">
          <table className="min-w-[820px] w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-gray-700 bg-gray-800 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">New Version</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filtered.map((pkg) => {
                const desc = getPackageDescription(pkg.name);
                const isUpgrading = upgradingPkg === pkg.name;
                return (
                  <tr
                    key={pkg.name}
                    className={`transition-colors ${
                      pkg.upgradable
                        ? "bg-yellow-500/[0.03] hover:bg-yellow-500/[0.06]"
                        : "bg-gray-800 hover:bg-gray-750"
                    }`}
                  >
                    <td className="px-4 py-2">
                      <span className="font-mono text-white">{pkg.name}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400 max-w-[200px]">
                      {desc || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-400">
                      {pkg.version}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={pkg.upgradable ? "warning" : "success"}>
                        {pkg.upgradable ? "upgradable" : "installed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {pkg.upgradable && pkg.newVersion ? (
                        <span className="font-mono text-yellow-400">{pkg.newVersion}</span>
                      ) : hasChecked ? (
                        <span className="text-gray-600">—</span>
                      ) : (
                        <span className="text-gray-600 italic text-xs">unchecked</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {pkg.upgradable ? (
                        <button
                          onClick={() => upgradePackage(pkg.name)}
                          disabled={safeMode || isUpgrading || actionLoading}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg
                            bg-yellow-500/10 text-yellow-300 border border-yellow-500/30
                            hover:bg-yellow-500/20 hover:border-yellow-500/50
                            disabled:opacity-40 disabled:cursor-not-allowed
                            transition-all duration-200"
                        >
                          {isUpgrading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          {isUpgrading ? "Upgrading..." : "Upgrade"}
                        </button>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
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
