import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { decodeEncryptedVars } from "@/lib/env-profile";
import { containerState } from "@/lib/apps-inventory";
import type { AppInfo, AppDetailInfo } from "@/types";
import type { Target } from "@/lib/container-recreate";

function configurationKey(app: AppInfo): string | null {
  const name = app.containerName?.replace(/^\//, "");
  if (!app.containerId || !/^[a-f0-9]{64}$/.test(app.containerId) || !name || !/^[a-zA-Z0-9_.-]+$/.test(name) || /-safe-(?:old|new)-[a-f0-9-]{36}$/.test(name)) return null;
  return "safe-env:" + createHash("sha256").update(JSON.stringify([app.serverId, "/" + name])).digest("hex");
}

/** Metadata only: exact server/name/full runtime ID, never prefix or recovery-name matching. */
export async function projectAppConfiguration<T extends AppInfo>(apps: T[]): Promise<T[]> {
  const keys = [...new Set(apps.map(configurationKey).filter((key): key is string => key !== null))];
  const values = new Map<string, string>();
  // SQLite bind limits: one query per bounded batch, never one connection/query per app.
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: keys.slice(i, i + 500) } }, select: { key: true, value: true } });
    for (const row of rows) values.set(row.key, row.value);
  }
  return apps.map(app => {
    const key = configurationKey(app), value = key && values.get(key);
    if (!value) return app;
    try {
      const state = JSON.parse(value);
      if (state.current !== app.containerId || typeof state.configuration !== "string") return app;
      const settings = JSON.parse(decodeEncryptedVars(state.configuration).settings);
      const result = { ...app };
      if (typeof settings.name === "string" && settings.name.trim() && settings.name.length <= 100 && !/[\x00-\x1f]/.test(settings.name)) result.name = settings.name;
      if (settings.domain === null || (typeof settings.domain === "string" && settings.domain.length <= 253 && settings.domain.includes(".") && settings.domain.split(".").every((part: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))) result.domain = settings.domain;
      return result;
    } catch { return app; } // Invalid/encryption-failed metadata is not runtime evidence; never echo it.
  });
}

/** Explicit inspect whitelist. Health command/env/labels and encrypted settings never enter responses. */
export function inspectedAppDetail(app: AppDetailInfo, c: Target["inspect"]): AppDetailInfo {
  const domains = Object.entries(c.Config.Labels || {}).flatMap(([key, value]) => /^traefik\.http\.routers\.[^.]+\.rule$/.test(key) && typeof value === "string"
    ? [...value.matchAll(/Host\(([^)]*)\)/g)].flatMap(match => [...match[1].matchAll(/[`\"]([^`\"]+)[`\"]/g)].map(host => host[1])) : []);
  const host = c.HostConfig;
  return { ...app, appSource: "docker", containerId: c.Id, containerName: c.Name.slice(1), image: c.Config.Image,
    status: containerState(c.State.Status || (c.State.Running ? "running" : "exited")),
    domain: domains.length ? [...new Set(domains)].join(", ") : null,
    cpuLimit: host.NanoCpus > 0 ? host.NanoCpus / 1e9 : host.CpuQuota > 0 ? host.CpuQuota / (host.CpuPeriod || 100000) : null,
    memoryLimit: host.Memory > 0 ? host.Memory / 1048576 : null,
    // Writable-layer StorageOpt is driver-dependent, not an app/volume storage quota in MiB.
    storageLimit: null, restartPolicy: host.RestartPolicy?.Name || "no",
    healthCheck: c.State.Health?.Status || null, volumes: JSON.stringify(c.Mounts || []),
    ports: JSON.stringify(host.PortBindings || {}), createdAt: c.Created,
  };
}
