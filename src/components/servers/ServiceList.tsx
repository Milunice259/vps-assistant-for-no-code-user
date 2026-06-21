"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Cog,
  RefreshCw,
  WifiOff,
  Filter,
  Play,
  Square,
  RotateCw,
  Ban,
  CheckCircle2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import type { ServiceInfo, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/* ══════════════════════════════════════════════════════════
   Well-known service descriptions (non-tech friendly)
   ══════════════════════════════════════════════════════════ */
const SERVICE_DESCRIPTIONS: Record<string, { desc: string; importance: "critical" | "important" | "optional" }> = {
  // ── Critical services ──
  "sshd.service":                { desc: "Remote access — lets you connect to this server from anywhere", importance: "critical" },
  "ssh.service":                 { desc: "Remote access — lets you connect to this server from anywhere", importance: "critical" },
  "docker.service":              { desc: "App engine — runs all your containerized applications", importance: "critical" },
  "containerd.service":          { desc: "Core engine that Docker depends on to run containers", importance: "critical" },
  "systemd-journald.service":    { desc: "System diary — records everything that happens on the server", importance: "critical" },
  "systemd-logind.service":      { desc: "Login manager — handles who can access the server", importance: "critical" },
  "dbus.service":                { desc: "System messenger — lets programs talk to each other", importance: "critical" },
  "systemd-udevd.service":       { desc: "Hardware manager — detects and configures devices", importance: "critical" },

  // ── Important services ──
  "nginx.service":               { desc: "Web server — delivers your websites to visitors", importance: "important" },
  "apache2.service":             { desc: "Web server — hosts and serves your websites", importance: "important" },
  "traefik.service":             { desc: "Smart traffic director — routes visitors to the right app and manages SSL", importance: "important" },
  "cron.service":                { desc: "Task scheduler — runs automated jobs at set times", importance: "important" },
  "fail2ban.service":            { desc: "Security guard — blocks hackers after failed login attempts", importance: "important" },
  "ufw.service":                 { desc: "Firewall — controls who can connect to your server", importance: "important" },
  "iptables.service":            { desc: "Firewall rules — low-level network access control", importance: "important" },
  "systemd-resolved.service":    { desc: "Name resolver — translates website names into addresses", importance: "important" },
  "systemd-timesyncd.service":   { desc: "Clock sync — keeps the server time accurate", importance: "important" },
  "systemd-networkd.service":    { desc: "Network manager — configures internet connections", importance: "important" },
  "polkit.service":              { desc: "Permission manager — controls who can do what on the system", importance: "important" },
  "rsyslog.service":             { desc: "Log collector — gathers system messages for troubleshooting", importance: "important" },
  "unattended-upgrades.service": { desc: "Auto-updater — installs security patches automatically", importance: "important" },

  // ── Database services ──
  "mysql.service":               { desc: "MySQL database — stores your application data", importance: "important" },
  "mariadb.service":             { desc: "MariaDB database — stores your application data", importance: "important" },
  "postgresql.service":          { desc: "PostgreSQL database — powerful data storage engine", importance: "important" },
  "redis.service":               { desc: "Redis cache — speeds up your apps with in-memory storage", importance: "important" },
  "redis-server.service":        { desc: "Redis cache — speeds up your apps with in-memory storage", importance: "important" },
  "mongod.service":              { desc: "MongoDB database — flexible document-based storage", importance: "important" },

  // ── Optional services ──
  "certbot.service":             { desc: "SSL certificate renewal — keeps your HTTPS working", importance: "optional" },
  "certbot.timer":               { desc: "Timer that triggers SSL certificate auto-renewal", importance: "optional" },
  "snapd.service":               { desc: "Snap store — alternative way to install applications", importance: "optional" },
  "apt-daily.timer":             { desc: "Daily check for new software updates", importance: "optional" },
  "apt-daily-upgrade.timer":     { desc: "Daily automatic software upgrade timer", importance: "optional" },
  "fstrim.timer":                { desc: "SSD optimizer — keeps your disk running efficiently", importance: "optional" },
  "logrotate.service":           { desc: "Log cleaner — compresses old logs to save disk space", importance: "optional" },
  "logrotate.timer":             { desc: "Timer that triggers periodic log cleanup", importance: "optional" },
  "man-db.service":              { desc: "Help manual database — updates command documentation", importance: "optional" },
  "postfix.service":             { desc: "Mail server — handles sending and receiving emails", importance: "optional" },
  "ModemManager.service":        { desc: "Mobile connection manager — handles cellular modems", importance: "optional" },
  "NetworkManager.service":      { desc: "Network manager — handles WiFi and ethernet connections", importance: "optional" },
  "wpa_supplicant.service":      { desc: "WiFi authenticator — connects to wireless networks", importance: "optional" },
};

function getServiceInfo(name: string): { desc: string; importance: "critical" | "important" | "optional" } | null {
  if (SERVICE_DESCRIPTIONS[name]) return SERVICE_DESCRIPTIONS[name];
  const base = name.replace(/\.(service|timer|socket|target|mount|path)$/, "");
  if (SERVICE_DESCRIPTIONS[`${base}.service`]) return SERVICE_DESCRIPTIONS[`${base}.service`];
  return null;
}

/* ── Importance badge ── */
function ImportanceBadge({ level }: { level: "critical" | "important" | "optional" | "unknown" }) {
  switch (level) {
    case "critical":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <ShieldAlert className="h-2.5 w-2.5" />
          Critical
        </span>
      );
    case "important":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Shield className="h-2.5 w-2.5" />
          Important
        </span>
      );
    case "optional":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
          <ShieldCheck className="h-2.5 w-2.5" />
          Optional
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-500/10 text-gray-500 border border-gray-600/20">
          —
        </span>
      );
  }
}

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

interface ServiceListProps {
  serverId: string;
}

type FilterMode = "all" | "active" | "inactive" | "failed";

function activeStateBadge(activeState: string) {
  switch (activeState.toLowerCase()) {
    case "active": return "success" as const;
    case "failed": return "danger" as const;
    case "inactive": return "default" as const;
    case "activating": case "deactivating": return "warning" as const;
    default: return "default" as const;
  }
}

export function ServiceList({ serverId }: ServiceListProps) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("active");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWarning(null);
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
      if (json.warning) setWarning(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleServiceAction = async (serviceName: string, action: "start" | "stop" | "restart" | "enable" | "disable") => {
    setActionLoading(`${serviceName}-${action}`);
    try {
      await fetch(`/api/servers/${serverId}/services/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceName, action }),
      });
      await fetchServices();
    } catch {
      // Will reflect on next refresh
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = services.filter((s) => {
    if (filter === "active") return s.activeState === "active";
    if (filter === "inactive") return s.activeState === "inactive";
    if (filter === "failed") return s.activeState === "failed";
    return true;
  });

  const failedCount = services.filter((s) => s.activeState === "failed").length;
  const activeCount = services.filter((s) => s.activeState === "active").length;
  const inactiveCount = services.filter((s) => s.activeState === "inactive").length;

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
    const isHostAccessError =
      error.includes("nsenter") ||
      error.includes("Operation not permitted") ||
      error.includes("systemctl") ||
      error.includes("command not found");

    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-8 w-8 text-amber-400" />
        <div className="text-center max-w-md">
          {isHostAccessError ? (
            <>
              <p className="text-sm text-amber-300 font-medium">Host Access Unavailable</p>
              <p className="text-xs text-gray-400 mt-1">
                System services require direct host access (pid:host mode in Docker).
                This feature works when the app is deployed on a Linux VPS via Docker Compose.
              </p>
            </>
          ) : (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={fetchServices}>
          Retry
        </Button>
      </div>
    );
  }

  // Build filter buttons dynamically — only show filters that have matches
  const filterButtons: { key: FilterMode; label: string; count: number }[] = [
    { key: "active", label: "Active", count: activeCount },
    ...(inactiveCount > 0 ? [{ key: "inactive" as const, label: "Inactive", count: inactiveCount }] : []),
    ...(failedCount > 0 ? [{ key: "failed" as const, label: "Failed", count: failedCount }] : []),
    { key: "all", label: "All", count: services.length },
  ];

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      {warning && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Host Access Unavailable</p>
            <p className="text-xs text-gray-400 mt-1">{warning}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-base font-semibold text-white">System Services</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Background programs running on your server. You can start, stop, restart, or enable/disable auto-start.
          </p>
        </div>
      </div>

      {/* Stats bar and filter */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            Total: <span className="text-white">{services.length}</span>
          </span>
          <span className="text-gray-400">
            Active: <span className="text-emerald-400">{activeCount}</span>
          </span>
          {inactiveCount > 0 && (
            <span className="text-gray-400">
              Inactive: <span className="text-gray-300">{inactiveCount}</span>
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-gray-400">
              Failed: <span className="text-red-400">{failedCount}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
            {filterButtons.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  filter === f.key
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {f.label}
                {f.key === "failed" && f.count > 0 && (
                  <span className="ml-1 text-red-400">({f.count})</span>
                )}
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
          <p className="text-sm text-gray-400">No services match this filter</p>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              className="text-xs text-brand-400 hover:text-brand-300"
            >
              Show all services →
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-xl border border-gray-700">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900 z-10">
              <tr className="border-b border-gray-700 text-gray-400 text-left text-xs uppercase">
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium text-center">Importance</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((s) => {
                const info = getServiceInfo(s.name);
                const desc = info?.desc || s.description || "—";
                const importance = info?.importance || "unknown";
                const isActive = s.activeState === "active";
                const isEnabled = ["enabled", "enabled-runtime", "static", "generated"].includes(s.unitFileState || "");
                const isFailed = s.activeState === "failed";
                const isLoadingThis = (action: string) => actionLoading === `${s.name}-${action}`;
                const isAnyLoading = actionLoading?.startsWith(s.name);

                return (
                  <tr key={s.name} className="hover:bg-gray-800/50 group">
                    {/* Service Name */}
                    <td className="px-4 py-2.5 text-white">
                      <div className="flex items-center gap-2">
                        <Cog className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                        <span className="font-mono text-xs">{s.name}</span>
                      </div>
                    </td>

                    {/* State */}
                    <td className="px-4 py-2.5">
                      <Badge variant={activeStateBadge(s.activeState)}>
                        {s.activeState}
                      </Badge>
                    </td>

                    {/* Description */}
                    <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[280px]">
                      <span className="line-clamp-2">{desc}</span>
                    </td>

                    {/* Importance */}
                    <td className="px-4 py-2.5 text-center">
                      <ImportanceBadge level={importance} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isActive ? (
                          <>
                            <button
                              onClick={() => handleServiceAction(s.name, "restart")}
                              disabled={!!isAnyLoading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                              title="Restart this service"
                            >
                              {isLoadingThis("restart") ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                              Restart
                            </button>
                            <button
                              onClick={() => handleServiceAction(s.name, "stop")}
                              disabled={!!isAnyLoading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              title="Stop this service"
                            >
                              {isLoadingThis("stop") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                              Stop
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleServiceAction(s.name, "start")}
                            disabled={!!isAnyLoading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title={isFailed ? "Restart this failed service" : "Start this service"}
                          >
                            {isLoadingThis("start") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            Start
                          </button>
                        )}
                        {/* Divider */}
                        <span className="w-px h-4 bg-gray-700 mx-0.5" />
                        {/* Enable / Disable */}
                        {isEnabled ? (
                          <button
                            onClick={() => {
                              if (importance === "critical") {
                                if (!confirm(`⚠️ "${s.name}" is a critical service. Disabling it could make your server inaccessible or unstable. Are you sure?`)) return;
                              }
                              handleServiceAction(s.name, "disable");
                            }}
                            disabled={!!isAnyLoading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                            title="Disable auto-start on boot"
                          >
                            {isLoadingThis("disable") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                            Disable
                          </button>
                        ) : (
                          <button
                            onClick={() => handleServiceAction(s.name, "enable")}
                            disabled={!!isAnyLoading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                            title="Enable auto-start on boot"
                          >
                            {isLoadingThis("enable") ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Enable
                          </button>
                        )}
                      </div>
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
