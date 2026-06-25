import { execFileSync } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer, isDisconnectedError } from "@/lib/server-ssh";
import { validateBranch, validatePath, validateRepoUrl } from "@/lib/validation";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type CheckStatus = "pass" | "warn" | "fail";

type DeployPreflightCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

type DeployPreflightResult = {
  target: "local" | "remote";
  ready: boolean;
  checks: DeployPreflightCheck[];
  nextSteps: string[];
};

function check(id: string, label: string, status: CheckStatus, detail: string): DeployPreflightCheck {
  return { id, label, status, detail };
}

function runLocal(command: string, args: string[] = []) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 10_000 }).trim();
}

function tryRunLocal(command: string, args: string[] = []) {
  try {
    return runLocal(command, args);
  } catch {
    return "";
  }
}

function diskCheck(output: string) {
  const parts = output.trim().split(/\s+/);
  const used = Number((parts[4] || "").replace("%", ""));
  if (Number.isNaN(used)) return check("disk", "Disk space", "warn", "Could not read disk usage.");
  if (used >= 90) return check("disk", "Disk space", "fail", `Disk is ${used}% used. Free space before deploying.`);
  if (used >= 80) return check("disk", "Disk space", "warn", `Disk is ${used}% used. Deployment can continue, but cleanup is recommended.`);
  return check("disk", "Disk space", "pass", `Disk is ${used}% used.`);
}

function memoryCheck(output: string) {
  const [totalRaw, availableRaw] = output.trim().split(/\s+/).map(Number);
  if (!totalRaw || Number.isNaN(availableRaw)) return check("memory", "Memory", "warn", "Could not read available memory.");
  const availablePercent = Math.round((availableRaw / totalRaw) * 100);
  if (availablePercent < 8) return check("memory", "Memory", "fail", `Only ${availablePercent}% memory available. Stop heavy jobs before deploying.`);
  if (availablePercent < 15) return check("memory", "Memory", "warn", `Only ${availablePercent}% memory available. Build may be slow or fail.`);
  return check("memory", "Memory", "pass", `${availablePercent}% memory available.`);
}

function commandCheck(id: string, label: string, ok: boolean, detail: string): DeployPreflightCheck {
  return check(id, label, ok ? "pass" : "fail", detail);
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<DeployPreflightResult>>> {
  const checks: DeployPreflightCheck[] = [];
  let ssh: Awaited<ReturnType<typeof connectToServer>>["ssh"] | null = null;

  try {
    const body = await request.json() as { repoUrl?: string; branch?: string; serverId?: string; customPath?: string; domain?: string };
    const branch = body.branch || "main";
    const target = body.serverId ? "remote" : "local";

    const repoCheck = validateRepoUrl(body.repoUrl || "");
    checks.push(check("repo", "Repository URL", repoCheck.valid ? "pass" : "fail", repoCheck.valid ? "Repository URL format is valid." : repoCheck.reason));

    const branchCheck = validateBranch(branch);
    checks.push(check("branch", "Branch", branchCheck.valid ? "pass" : "fail", branchCheck.valid ? `Branch ${branch} is valid.` : branchCheck.reason));

    if (body.customPath) {
      const pathCheck = validatePath(body.customPath);
      checks.push(check("path", "Deploy path", pathCheck.valid ? "pass" : "fail", pathCheck.valid ? `Path looks safe: ${body.customPath}` : pathCheck.reason));
    } else if (target === "remote") {
      checks.push(check("path", "Deploy path", "fail", "Remote deployment requires a deploy path."));
    } else {
      checks.push(check("path", "Deploy path", "pass", "Local deploy will use the default temporary workspace."));
    }

    if (body.domain) {
      checks.push(check("domain", "Domain", /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(body.domain) ? "pass" : "warn", "DNS is not changed by this app; make sure it points to the target server."));
    } else {
      checks.push(check("domain", "Domain", "warn", "No domain provided. You can attach one later."));
    }

    if (target === "remote") {
      const server = await prisma.server.findUnique({ where: { id: body.serverId } });
      if (!server) {
        checks.push(check("server", "Target server", "fail", "Target server not found."));
      } else {
        checks.push(check("server", "Target server", "pass", `${server.name} (${server.host}) found.`));
        const conn = await connectToServer(server.id);
        ssh = conn.ssh;
        checks.push(check("ssh", "SSH connection", "pass", "Remote server is reachable."));
        checks.push(diskCheck(await executeCommand(ssh, "df -P / | tail -1", 10_000)));
        checks.push(memoryCheck(await executeCommand(ssh, "awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {print t, a}' /proc/meminfo", 10_000)));
        checks.push(commandCheck("git", "Git", (await executeCommand(ssh, "command -v git >/dev/null && echo ok || echo missing", 10_000)) === "ok", "Git must be installed on the target server."));
        checks.push(commandCheck("docker", "Docker", (await executeCommand(ssh, "docker info >/dev/null 2>&1 && echo ok || echo missing", 10_000)) === "ok", "Docker must be installed and running on the target server."));
      }
    } else {
      checks.push(check("server", "Target server", "pass", "Deploy target is this local server."));
      checks.push(diskCheck(runLocal("df", ["-P", "/"]).split("\n").at(-1) || ""));
      checks.push(memoryCheck(runLocal("awk", ["/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {print t, a}", "/proc/meminfo"])));
      checks.push(commandCheck("git", "Git", Boolean(tryRunLocal("git", ["--version"])), "Git must be installed on this server."));
      checks.push(commandCheck("docker", "Docker", Boolean(tryRunLocal("docker", ["info"])), "Docker must be installed and running on this server."));
    }

    const failed = checks.some((item) => item.status === "fail");
    const warned = checks.some((item) => item.status === "warn");
    return NextResponse.json({
      success: true,
      data: {
        target,
        ready: !failed,
        checks,
        nextSteps: failed
          ? ["Fix failed checks before deploying.", "Run pre-flight again after changes."]
          : warned
            ? ["Review warnings.", "Deploy only if the warning is intentional.", "Watch the deployment log and health result after deploy."]
            : ["Ready to deploy.", "Keep the deployment log open until the health check is clear."],
      },
    });
  } catch (error) {
    if (isDisconnectedError(error)) {
      checks.push(check("ssh", "SSH connection", "fail", "Server is offline or unreachable."));
      return NextResponse.json({ success: true, data: { target: "remote", ready: false, checks, nextSteps: ["Bring the server online or fix SSH access."] } });
    }

    const message = error instanceof Error ? error.message : "Pre-flight check failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    await closeSSH(ssh);
  }
}
