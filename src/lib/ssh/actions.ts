/**
 * SSH Actions — Quick server actions, remote deployment, and service management via SSH.
 */

import type SSH2Promise from "ssh2-promise";
import { executeCommand, executeCommandSafe } from "./connection";
import { validateRepoUrl, validateBranch, validatePath } from "../validation";

// ─── Quick Server Actions ───

const QUICK_ACTION_COMMANDS: Record<string, string> = {
  "system-health-check": "echo '=== DISK ===' && df -h / && echo '' && echo '=== MEMORY ===' && free -h && echo '' && echo '=== CPU LOAD ===' && uptime && echo '' && echo '=== UPTIME ===' && uptime -p 2>/dev/null || uptime && echo '' && echo '=== PENDING UPDATES ===' && (apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0) && echo '' && echo '=== FAILED SERVICES ===' && (systemctl --failed --no-pager --no-legend 2>/dev/null || echo 'N/A') && echo '' && echo '=== KERNEL ===' && uname -r 2>&1",
  "security-check":     "echo '=== FIREWALL ===' && (sudo ufw status 2>/dev/null || sudo iptables -L -n --line-numbers 2>/dev/null | head -30 || echo 'No firewall detected') && echo '' && echo '=== FAIL2BAN ===' && (sudo fail2ban-client status 2>/dev/null || echo 'fail2ban not installed') && echo '' && echo '=== RECENT SSH LOGINS ===' && (last -n 10 -a 2>/dev/null || echo 'N/A') && echo '' && echo '=== FAILED LOGIN ATTEMPTS ===' && (sudo journalctl _SYSTEMD_UNIT=sshd.service --since '24 hours ago' --no-pager 2>/dev/null | grep -i 'failed\\|invalid' | tail -10 || echo 'None in last 24h') 2>&1",
  "sync-time":          "sudo timedatectl set-ntp true 2>&1; chronyc -a makestep 2>/dev/null || sudo ntpdate -u pool.ntp.org 2>/dev/null || echo 'NTP sync attempted'",
  "os-version-check":   "echo '=== OS ===' && cat /etc/os-release 2>/dev/null && echo '' && echo '=== KERNEL ===' && uname -a && echo '' && echo '=== DISTRIBUTION UPGRADES ===' && (do-release-upgrade -c 2>/dev/null || echo 'do-release-upgrade not available') 2>&1",
  "os-update":          "sudo apt update -y && sudo apt upgrade -y 2>&1",
  "docker-stats":       'docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}" 2>&1',
  "connection-stats":   "echo '=== CONNECTION SUMMARY ===' && ss -s && echo '' && echo '=== LISTENING PORTS ===' && ss -tlnp 2>&1",
  "docker-prune":       "docker system prune -af 2>&1",
  "clear-apt-cache":    "sudo apt clean && sudo apt autoclean 2>&1",
  "clear-logs":         "sudo journalctl --vacuum-time=3d 2>&1",
  "clear-temp":         "sudo rm -rf /tmp/* /var/tmp/* 2>&1 && echo 'Temp files cleared'",
  "remove-old-kernels": "sudo apt autoremove --purge -y 2>&1",
  "restart-docker":     "sudo systemctl restart docker 2>&1",
  "restart-server":     "sudo reboot",
  "firewall-reload":    "sudo ufw reload 2>/dev/null || (sudo iptables-save && echo 'iptables rules reloaded') 2>&1",
  "unban-all":          "sudo fail2ban-client unban --all 2>&1 || echo 'fail2ban not available'",
  "ban-ip":             "sudo fail2ban-client set sshd banip {PARAM} 2>/dev/null || sudo ufw deny from {PARAM} 2>/dev/null || echo 'Neither fail2ban nor ufw available' 2>&1",
  "unban-ip":           "sudo fail2ban-client set sshd unbanip {PARAM} 2>/dev/null || sudo ufw delete deny from {PARAM} 2>/dev/null || echo 'Neither fail2ban nor ufw available' 2>&1",
  "check-disk":         "df -h 2>&1",
  "check-uptime":       "uptime",
  "check-memory":       "free -h",
  "check-connections":  "ss -s",
  "check-docker-version": 'docker version --format "Client: {{.Client.Version}}, Server: {{.Server.Version}}"',
};

/**
 * Run a predefined server maintenance action.
 * Only whitelisted commands are allowed.
 */
export async function quickAction(
  ssh: SSH2Promise,
  action: string,
  param?: string,
): Promise<{ success: boolean; output: string }> {
  let command = QUICK_ACTION_COMMANDS[action];
  if (!command) {
    return { success: false, output: `Unknown action: ${action}` };
  }

  if (command.includes("{PARAM}") && param) {
    const safeParam = param.replace(/[^a-fA-F0-9.:]/g, "");
    command = command.replace(/\{PARAM\}/g, safeParam);
  }

  try {
    const output = await executeCommand(ssh, command, 120_000);
    return { success: true, output };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: msg };
  }
}

// ─── Remote Deployment (SSH-based git clone) ───

export interface RemoteDeployResult {
  success: boolean;
  logs: string;
  commitHash: string;
}

/**
 * Deploy a git repository to a remote server via SSH.
 */
export async function remoteDeployViaSSH(
  ssh: SSH2Promise,
  repoUrl: string,
  branch: string,
  customPath: string,
  envVarsDecrypted?: string
): Promise<RemoteDeployResult> {
  const logs: string[] = [];

  const urlCheck = validateRepoUrl(repoUrl);
  if (!urlCheck.valid) return { success: false, logs: urlCheck.reason, commitHash: "" };

  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) return { success: false, logs: branchCheck.reason, commitHash: "" };

  const pathCheck = validatePath(customPath);
  if (!pathCheck.valid) {
    return { success: false, logs: "Invalid custom path. Must be an absolute path (e.g., /opt/apps/myapp).", commitHash: "" };
  }

  const safePath = customPath;

  try {
    const parentDir = safePath.substring(0, safePath.lastIndexOf("/")) || "/";
    logs.push(`[1/5] Ensuring parent directory: ${parentDir}`);
    await executeCommand(ssh, `mkdir -p "${parentDir}"`, 15_000);

    const hasGit = await executeCommandSafe(ssh, `test -d "${safePath}/.git" && echo "exists" || echo "missing"`);

    if (hasGit.trim() === "exists") {
      logs.push(`[2/5] Repository exists at ${safePath} — pulling latest changes...`);
      const pullOutput = await executeCommand(ssh, `cd "${safePath}" && git fetch origin "${branch}" && git reset --hard "origin/${branch}" 2>&1`, 120_000);
      logs.push(pullOutput);
    } else {
      logs.push(`[2/5] Cloning ${repoUrl} (branch: ${branch}) to ${safePath}...`);
      const cloneOutput = await executeCommand(ssh, `git clone --depth 1 --branch "${branch}" "${repoUrl}" "${safePath}" 2>&1`, 120_000);
      logs.push(cloneOutput);
    }

    logs.push(`[3/5] Retrieving commit hash...`);
    const commitHash = await executeCommand(ssh, `cd "${safePath}" && git rev-parse --short HEAD 2>/dev/null`, 10_000);
    logs.push(`Commit: ${commitHash}`);

    if (envVarsDecrypted) {
      logs.push(`[4/5] Writing environment variables to .env...`);
      const envBase64 = Buffer.from(envVarsDecrypted).toString("base64");
      await executeCommand(ssh, `echo "${envBase64}" | base64 -d > "${safePath}/.env"`, 10_000);
      logs.push("Environment file written.");
    } else {
      logs.push(`[4/5] No environment variables to write — skipped.`);
    }

    const hasCompose = await executeCommandSafe(ssh, `test -f "${safePath}/docker-compose.yml" -o -f "${safePath}/docker-compose.yaml" -o -f "${safePath}/compose.yml" && echo "found" || echo "none"`);

    if (hasCompose.trim() === "found") {
      logs.push(`[5/5] Docker Compose file detected — building and starting...`);
      const composeOutput = await executeCommand(ssh, `cd "${safePath}" && docker compose up -d --build 2>&1`, 300_000);
      logs.push(composeOutput);
    } else {
      logs.push(`[5/5] No Docker Compose file found — clone complete. Manual setup required.`);
    }

    return { success: true, logs: logs.join("\n"), commitHash: commitHash.trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logs.push(`\nERROR: ${msg}`);
    return { success: false, logs: logs.join("\n"), commitHash: "" };
  }
}
