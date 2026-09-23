import { NextResponse } from "next/server";

export const DANGEROUS_ACTIONS = new Set([
  "container_start",
  "container_stop",
  "container_restart",
  "service_start",
  "service_stop",
  "service_restart",
  "service_enable",
  "service_disable",
  "firewall_block-port",
  "firewall_allow-port",
  "os-update",
  "docker-prune",
  "clear-apt-cache",
  "clear-logs",
  "clear-temp",
  "remove-old-kernels",
  "firewall-reload",
  "ban-ip",
  "unban-ip",
  "unban-all",
  "restart-docker",
  "restart-server",
  "package_install",
  "package_update",
  "package_upgrade",
  "deploy_requirement_install",
]);

export type SafetyBody = { safeModeOff?: boolean };

export function requireSafeModeOff(action: string, body: SafetyBody) {
  if (!DANGEROUS_ACTIONS.has(action)) return null;
  if (body.safeModeOff === true) return null;
  return NextResponse.json(
    { success: false, error: "Safe Mode is on. Turn it off before running this dangerous action." },
    { status: 423 },
  );
}
