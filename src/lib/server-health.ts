import { executeCommand } from "@/lib/ssh";
import { execLocal, tryExecOnHost } from "@/lib/local-server";
import type SSH2Promise from "ssh2-promise";

export interface ServerTestResult {
  ok: boolean;
  message: string;
  os?: string;
  docker?: boolean;
  systemd?: boolean;
}

export function friendlyConnectionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();
  if (msg.includes("timed out") || msg.includes("etimedout")) return "Connection timed out. Check host, port, firewall, and whether SSH is open.";
  if (msg.includes("econnrefused")) return "SSH refused the connection. Check the SSH port and whether sshd is running.";
  if (msg.includes("authentication") || msg.includes("all configured authentication methods failed")) return "SSH authentication failed. Check username, password, or private key.";
  if (msg.includes("enotfound")) return "Host was not found. Check the server IP or domain.";
  return raw.replace(/password|private key|secret/gi, "credential");
}

export async function detectRemoteServer(ssh: SSH2Promise): Promise<ServerTestResult> {
  const [os, dockerRaw, systemdRaw] = await Promise.all([
    executeCommand(ssh, "(source /etc/os-release 2>/dev/null && echo ${PRETTY_NAME:-$NAME}) || uname -s", 10_000),
    executeCommand(ssh, "command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1 && echo yes || echo no", 10_000),
    executeCommand(ssh, "command -v systemctl >/dev/null 2>&1 && echo yes || echo no", 10_000),
  ]);

  return {
    ok: true,
    message: "SSH connection works. Server checks completed.",
    os: os.trim() || "Linux",
    docker: dockerRaw.trim() === "yes",
    systemd: systemdRaw.trim() === "yes",
  };
}

export function detectLocalServer(): ServerTestResult {
  const os = tryExecOnHost("(source /etc/os-release 2>/dev/null && echo ${PRETTY_NAME:-$NAME}) || uname -s", 10_000);
  return {
    ok: true,
    message: "Local server is reachable. Server checks completed.",
    os: os.trim() || "Linux",
    docker: execLocal("command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1 && echo yes || echo no", 10_000).includes("yes"),
    systemd: tryExecOnHost("command -v systemctl >/dev/null 2>&1 && echo yes || echo no", 10_000).includes("yes"),
  };
}
