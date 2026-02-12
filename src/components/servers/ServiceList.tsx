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
  HelpCircle,
} from "lucide-react";
import type { ServiceInfo, ApiResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/* ── Well-known service descriptions ── */
const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "sshd.service": "Secure Shell server — allows remote access to this server",
  "ssh.service": "Secure Shell server — allows remote access to this server",
  "docker.service": "Docker container engine — runs your containerized apps",
  "containerd.service": "Container runtime used by Docker internally",
  "nginx.service": "Web server and reverse proxy for serving websites",
  "apache2.service": "Apache web server for hosting websites",
  "traefik.service": "Automatic reverse proxy and SSL certificate manager",
  "cron.service": "Scheduled task runner — executes jobs at specified times",
  "fail2ban.service": "Security tool — blocks attackers after failed login attempts",
  "ufw.service": "Uncomplicated Firewall — controls network access",
  "iptables.service": "Network firewall rules manager",
  "systemd-journald.service": "System logging service — records system events",
  "systemd-logind.service": "User session manager",
  "systemd-resolved.service": "DNS resolver — translates domain names to IP addresses",
  "systemd-timesyncd.service": "Time synchronization — keeps server clock accurate",
  "systemd-networkd.service": "Network configuration manager",
  "systemd-udevd.service": "Hardware device manager",
  "rsyslog.service": "System logging service",
  "postfix.service": "Email server for sending and receiving mail",
  "mysql.service": "MySQL database server",
  "mariadb.service": "MariaDB database server (MySQL compatible)",
  "postgresql.service": "PostgreSQL database server",
  "redis.service": "Redis in-memory cache and data store",
  "redis-server.service": "Redis in-memory cache and data store",
  "mongod.service": "MongoDB NoSQL database server",
  "certbot.service": "Automatic SSL/TLS certificate renewal",
  "certbot.timer": "Timer for automatic SSL certificate renewal",
  "snapd.service": "Snap package manager daemon",
  "unattended-upgrades.service": "Automatic security updates",
  "apt-daily.timer": "Daily package list update check",
  "apt-daily-upgrade.timer": "Daily automatic package upgrades",
  "fstrim.timer": "Periodic SSD optimization",
  "logrotate.service": "Rotates and compresses old log files",
  "logrotate.timer": "Timer for log file rotation",
  "man-db.service": "Manual page database updates",
  "dbus.service": "System message bus — allows programs to communicate",
  "polkit.service": "Authorization manager for system actions",
  "ModemManager.service": "Modem/cellular connection manager",
  "NetworkManager.service": "Network connection manager",
  "wpa_supplicant.service": "WiFi authentication service",
};

function getServiceDescription(name: string): string | null {
  if (SERVICE_DESCRIPTIONS[name]) return SERVICE_DESCRIPTIONS[name];
  // Try without .service suffix and re-add
  const base = name.replace(/\.(service|timer|socket|target|mount|path)$/, "");
  if (SERVICE_DESCRIPTIONS[`${base}.service`]) return SERVICE_DESCRIPTIONS[`${base}.service`];
  return null;
}

/* ── Tooltip ── */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1.5 cursor-help">
      <HelpCircle className="h-3 w-3 text-gray-600 group-hover:text-gray-400 transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

interface ServiceListProps {
  serverId: string;
}

type FilterMode = "all" | "active" | "failed";

function activeStateBadge(activeState: string) {
  switch (activeState.toLowerCase()) {
    case "active":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "inactive":
      return "default" as const;
    case "activating":
    case "deactivating":
      return "warning" as const;
    default:
      return "default" as const;
  }
}

export function ServiceList({ serverId }: ServiceListProps) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("active");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleServiceAction = async (serviceName: string, action: "start" | "stop" | "restart") => {
    setActionLoading(`${serviceName}-${action}`);
    try {
      await fetch(`/api/servers/${serverId}/services/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceName, action }),
      });
      // Refresh list after action
      await fetchServices();
    } catch {
      // Will reflect on next refresh
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = services.filter((s) => {
    if (filter === "active") return s.activeState === "active";
    if (filter === "failed") return s.activeState === "failed";
    return true;
  });

  const failedCount = services.filter((s) => s.activeState === "failed").length;
  const activeCount = services.filter((s) => s.activeState === "active").length;

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
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="secondary" size="sm" onClick={fetchServices}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with ownership label */}
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Server System Services</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Background processes running on the host operating system (not inside containers)
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
          {failedCount > 0 && (
            <span className="text-gray-400">
              Failed: <span className="text-red-400">{failedCount}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
            {(["active", "failed", "all"] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                  filter === f
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {f}
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
          <p className="text-sm text-gray-400">No services match the filter</p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-3 font-medium">Service</th>
                <th className="pb-3 font-medium">State</th>
                <th className="pb-3 font-medium">Description</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((s) => {
                const desc = getServiceDescription(s.name);
                const isActive = s.activeState === "active";
                const isFailed = s.activeState === "failed";
                return (
                  <tr key={s.name} className="hover:bg-gray-800/50 group">
                    <td className="py-2.5 text-white">
                      <div className="flex items-center gap-2">
                        <Cog className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                        <span className="font-mono text-xs">{s.name}</span>
                        {desc && <Tip text={desc} />}
                      </div>
                    </td>
                    <td className="py-2.5">
                      <Badge variant={activeStateBadge(s.activeState)}>
                        {s.activeState}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-gray-500 text-xs truncate max-w-[300px]">
                      {desc || s.description || "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isActive ? (
                          <>
                            <button
                              onClick={() => handleServiceAction(s.name, "stop")}
                              disabled={actionLoading === `${s.name}-stop`}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              title="Stop this service"
                            >
                              <Square className="h-3 w-3" />
                              Stop
                            </button>
                            <button
                              onClick={() => handleServiceAction(s.name, "restart")}
                              disabled={actionLoading === `${s.name}-restart`}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                              title="Restart this service"
                            >
                              <RotateCw className="h-3 w-3" />
                              Restart
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleServiceAction(s.name, "start")}
                            disabled={actionLoading === `${s.name}-start`}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title={isFailed ? "Restart this failed service" : "Start this service"}
                          >
                            <Play className="h-3 w-3" />
                            Start
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
