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
): Promise<{ success: boolean; output: string; operation?: import("@/lib/operation-result").OperationResult & { evidence: { target: string; commandCompleted: boolean; before?: string; after?: string } } }> {
  if (action === "check-disk" || action === "clear-apt-cache") {
    const target = "/var/cache/apt/archives";
    const evidence: { target: string; commandCompleted: boolean; before?: string; after?: string } = { target, commandCompleted: false };
    const check = "LC_ALL=C df -Pk / /var/cache/apt/archives && du -sk /var/cache/apt/archives && command -v apt-get";
    const run = async (command: string) => await executeCommand(ssh, command, 120_000);
    const readDisk = async () => {
      const output = await run(`(${check}) 2>&1 && printf '\\n__DISK_CHECK_COMPLETED__\\n'`);
      if (output.trim() !== "__DISK_CHECK_COMPLETED__" && !output.trimEnd().endsWith("\n__DISK_CHECK_COMPLETED__")) throw new Error("Disk check did not complete");
      return output.replace(/\s*__DISK_CHECK_COMPLETED__\s*$/, "");
    };
    try {
      evidence.before = await readDisk();
      if (!/\d+\s+\d+\s+\d+\s+\d+%\s+\//.test(evidence.before)) throw new Error("Disk check returned no usable evidence");
      if (action === "check-disk") return { success: true, output: evidence.before, operation: { message: "Disk and package cache checked; nothing changed", risk: "safe", verified: true, outcome: "verified", evidence } };
      const output = await run("(sudo -n apt-get clean -o Dir::Cache=/var/cache/apt -o Dir::Cache::archives=/var/cache/apt/archives) 2>&1 && printf '\\n__CACHE_CLEAN_COMPLETED__\\n'");
      if (output.trim() !== "__CACHE_CLEAN_COMPLETED__" && !output.trimEnd().endsWith("\n__CACHE_CLEAN_COMPLETED__")) throw new Error("Cleanup completion not confirmed");
      evidence.commandCompleted = true;
      try { evidence.after = await readDisk(); } catch { /* Completed command remains evidence even when readback is unavailable. */ }
      const verified = !!evidence.after && /\d+\s+\d+\s+\d+\s+\d+%\s+\//.test(evidence.after);
      const message = verified ? "Package cache command completed; before/after disk readings available. Other disk use may change concurrently." : "Package cache command completed; disk result unverified. Check disk before considering another cleanup.";
      return { success: true, output: message, operation: { message, risk: "danger", verified, outcome: verified ? "verified" : "unverified", evidence } };
    } catch {
      const message = action === "check-disk" ? "Disk check unavailable; nothing changed" : evidence.before ? "Cleanup completion unverified. Check disk; do not blindly retry." : "Disk check unavailable; cleanup not submitted";
      return { success: false, output: message, operation: { message, risk: action === "check-disk" ? "safe" : "danger", verified: false, outcome: evidence.before ? "unverified" : "failed", evidence } };
    }
  }
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
  success: boolean; // Command execution, not application readiness.
  status: "PREPARED" | "UNVERIFIED" | "RUNNING" | "FAILED";
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
  let commitHash = "";
  const finish = (status: RemoteDeployResult["status"]): RemoteDeployResult => ({
    success: status !== "FAILED", status, logs: logs.join("\n"), commitHash: status === "FAILED" ? "" : commitHash,
  });
  // ssh2-promise can resolve nonzero exits; only an && completion marker proves execution.
  const completed = async (command: string, timeout: number, failure: string) => {
    const marker = "__VPS_DEPLOY_OK__";
    try {
      const output = await executeCommand(ssh, `(${command}) 2>&1 && printf '\\n${marker}\\n'`, timeout);
      if (output.trim() !== marker && !output.trimEnd().endsWith(`\n${marker}`)) throw new Error(failure);
      return output.trimEnd().slice(0, -marker.length).trim();
    } catch {
      // Never expose executor errors/output: they may contain .env values or upload commands.
      throw new Error(failure);
    }
  };

  const urlCheck = validateRepoUrl(repoUrl);
  if (!urlCheck.valid) return { success: false, status: "FAILED", logs: urlCheck.reason, commitHash: "" };

  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) return { success: false, status: "FAILED", logs: branchCheck.reason, commitHash: "" };

  const pathCheck = validatePath(customPath);
  if (!pathCheck.valid) {
    return { success: false, status: "FAILED", logs: "Invalid custom path. Must be an absolute path (e.g., /opt/apps/myapp).", commitHash: "" };
  }

  const safePath = customPath;

  try {
    const parentDir = safePath.substring(0, safePath.lastIndexOf("/")) || "/";
    logs.push(`[1/5] Ensuring parent directory: ${parentDir}`);
    await completed(`mkdir -p "${parentDir}"`, 15_000, "Failed to create deployment directory.");

    const hasGit = await executeCommandSafe(ssh, `test -d "${safePath}/.git" && echo "exists" || echo "missing"`);
    if (!["exists", "missing"].includes(hasGit.trim())) throw new Error("Failed to inspect repository directory.");

    if (hasGit.trim() === "exists") {
      logs.push(`[2/5] Repository exists at ${safePath} — pulling latest changes...`);
      await completed(`cd "${safePath}" && git fetch origin "${branch}" && git reset --hard "origin/${branch}" 2>&1`, 120_000, "Failed to update repository.");
      logs.push("Repository updated.");
    } else {
      logs.push(`[2/5] Cloning ${repoUrl} (branch: ${branch}) to ${safePath}...`);
      await completed(`git clone --depth 1 --branch "${branch}" "${repoUrl}" "${safePath}" 2>&1`, 120_000, "Failed to clone repository.");
      logs.push("Repository cloned.");
    }

    logs.push(`[3/5] Retrieving commit hash...`);
    commitHash = (await executeCommand(ssh, `cd "${safePath}" && git rev-parse --short HEAD 2>/dev/null`, 10_000)).trim();
    if (!/^[a-f0-9]{4,40}$/i.test(commitHash)) throw new Error("Failed to read repository commit.");
    logs.push(`Commit: ${commitHash}`);

    if (envVarsDecrypted) {
      logs.push(`[4/5] Writing environment variables to .env...`);
      const envBase64 = Buffer.from(envVarsDecrypted).toString("base64");
      await completed(`echo "${envBase64}" | base64 -d > "${safePath}/.env"`, 10_000, "Failed to write environment file.");
      logs.push("Environment file written.");
    } else {
      logs.push(`[4/5] No environment variables to write — skipped.`);
    }

    const hasCompose = await executeCommandSafe(ssh, `test -f "${safePath}/docker-compose.yml" -o -f "${safePath}/docker-compose.yaml" -o -f "${safePath}/compose.yml" -o -f "${safePath}/compose.yaml" && echo "found" || echo "none"`);
    if (hasCompose.trim() === "none") {
      logs.push(`[5/5] Repository prepared at ${safePath}. No Docker Compose file found; application not deployed. Files remain on the remote server; manual setup required.`);
      return finish("PREPARED");
    }
    if (hasCompose.trim() !== "found") {
      logs.push("Compose detection unavailable. Files remain on the remote server; deployment unverified.");
      return finish("UNVERIFIED");
    }

    logs.push(`[5/5] Docker Compose file detected — building and starting...`);
    await completed(`cd "${safePath}" && docker compose up -d --build 2>&1`, 300_000, "Failed to build or start Compose application.");
    logs.push("Compose command completed. Checking container state and health...");
    try {
      const services = (await completed(`cd "${safePath}" && docker compose config --services`, 15_000, "Compose services unavailable.")).split(/\s+/).filter(Boolean);
      const output = await completed(`cd "${safePath}" && docker compose ps --all --format json`, 15_000, "Compose state unavailable.");
      // ponytail: native Compose v2 array/NDJSON only; unsupported readback stays terminal unverified.
      const rows: { Service: string; State: string; Health: string }[] = output.startsWith("[") ? JSON.parse(output) : output.split("\n").filter(Boolean).map(line => JSON.parse(line));
      if (!services.length || !Array.isArray(rows) || rows.some(row => !row || typeof row.Service !== "string")) throw new Error("Invalid readback");
      if (services.some(service => !rows.some(row => row.Service === service)) || rows.some(row => !services.includes(row.Service) || ["exited", "dead", "restarting", "paused", "created", "removing"].includes(row.State) || row.Health === "unhealthy")) {
        logs.push("Container state/health does not match the Compose application. Deployment failed.");
        return finish("FAILED");
      }
      if (rows.some(row => row.State !== "running" || row.Health !== "healthy")) {
        logs.push("Compose execution completed, but running state and healthy readiness are not verified (health may be absent or starting).");
        return finish("UNVERIFIED");
      }
      logs.push("Compose services verified running and healthy. External application reachability was not tested.");
      return finish("RUNNING");
    } catch {
      logs.push("Compose execution completed; state/health readback unavailable or unsupported. Readiness unverified.");
      return finish("UNVERIFIED");
    }
  } catch (error) {
    logs.push(`\nERROR: ${error instanceof Error && error.message === "Failed to write environment file." ? error.message : "Remote deployment failed. Check repository access, path permissions, and Compose configuration."}`);
    return finish("FAILED");
  }
}
