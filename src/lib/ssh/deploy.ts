import { randomUUID, createHash } from "crypto";
import { checked, quote, resourcePreflight, type DeployRunner } from "@/lib/deploy-preflight";
import { validateRepoUrl, validateBranch, validatePath } from "@/lib/validation";

export type GitDeployInput = {
  repoUrl: string; branch: string; customPath: string; serverId?: string;
  commitHash?: string; expectedCommit?: string; envVars?: string; sourcePath?: string;
  composeDeploymentId?: string;
};
export type GitSource = { repoUrl: string; branch: string; commitHash: string; originalCommit: string | null; customPath: string; serverId: string; revision: string };
export type GitDeploymentResult = { success: boolean; status: "RUNNING" | "FAILED" | "UNVERIFIED"; logs: string; commitHash: string; source: GitSource };
const fullCommit = /^[a-f0-9]{40}$/;

export function validateGitDeploy(input: GitDeployInput) {
  for (const check of [validateRepoUrl(input.repoUrl), validateBranch(input.branch), validatePath(input.customPath)]) if (!check.valid) throw new Error(check.reason);
  if (input.serverId !== undefined && (typeof input.serverId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.serverId))) throw new Error("Invalid Git target identity");
  if (input.composeDeploymentId !== undefined && (typeof input.composeDeploymentId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.composeDeploymentId))) throw new Error("Invalid managed Git deployment identity");
  // Exact canonical path: no root, trailing slash, repeated separator or relative component.
  if (!/^\/(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(input.customPath) || input.customPath.split("/").some(part => part === "." || part === "..")) throw new Error("Use an exact project path inside an existing owned parent directory");
  if (input.commitHash !== undefined && !fullCommit.test(input.commitHash)) throw new Error("Invalid pinned repository commit");
  if (input.expectedCommit !== undefined && !fullCommit.test(input.expectedCommit)) throw new Error("Invalid existing repository revision");
  if (input.envVars !== undefined && (typeof input.envVars !== "string" || input.envVars.includes("\0") || input.envVars.length > 262144)) throw new Error("Invalid environment options");
}

async function targetRepository(run: DeployRunner, input: GitDeployInput) {
  const dir = quote(input.customPath);
  const parent = quote(input.customPath.slice(0, input.customPath.lastIndexOf("/")));
  await checked(run, `test -d ${parent} && test "$(realpath -e -- ${parent})" = ${parent} && test "$(stat -c %u -- ${parent})" = "$(id -u)" && test "$(stat -c %a -- ${parent})" = 700 && test ! -L ${dir}`);
  const presence = await checked(run, `if test -e ${dir}; then printf existing; else printf fresh; fi`);
  if (presence === "fresh") {
    if (input.expectedCommit) throw new Error("Repository revision changed: target is absent");
    return null;
  }
  if (presence !== "existing") throw new Error("Target repository inspection unavailable");
  if (input.composeDeploymentId) {
    const { readGitSource } = await import("@/lib/git-deployment");
    const saved = await readGitSource(input.composeDeploymentId, input.serverId || "local");
    if (!saved || saved.pending || saved.source.customPath !== input.customPath || saved.source.repoUrl !== input.repoUrl || saved.source.branch !== input.branch) throw new Error("Managed Git source binding changed or an operation is pending");
    if (input.expectedCommit !== saved.source.commitHash) throw new Error("Managed Git updates require the exact previous commit");
    return saved.source.commitHash;
  }
  await checked(run, `test -d ${dir}/.git && test ! -L ${dir}/.git && test "$(git -C ${dir} rev-parse --show-toplevel)" = ${dir} && test "$(git -C ${dir} remote get-url origin)" = ${quote(input.repoUrl)} && test -z "$(git -C ${dir} status --porcelain --untracked-files=all)"`);
  const current = await checked(run, `git -C ${dir} rev-parse HEAD`);
  if (!fullCommit.test(current)) throw new Error("Target repository revision unavailable");
  if (input.expectedCommit && input.expectedCommit !== current) throw new Error("Repository revision changed; run pre-flight again");
  return current;
}

export async function gitPreflight(run: DeployRunner, input: GitDeployInput) {
  validateGitDeploy(input);
  await checked(run, `git check-ref-format ${quote(`refs/heads/${input.branch}`)} && git --version >/dev/null`);
  await resourcePreflight(run, true);
  const originalCommit = await targetRepository(run, input);
  const ref = `refs/heads/${input.branch}`;
  const remote = await checked(run, `GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c credential.helper= -c http.followRedirects=false ls-remote --exit-code --heads ${quote(input.repoUrl)} ${quote(ref)}`, 120000);
  const rows = remote.split("\n").filter(Boolean);
  if (rows.length !== 1 || rows[0].split(/\s+/)[1] !== ref || !fullCommit.test(rows[0].split(/\s+/)[0])) throw new Error("Repository branch could not be pinned");
  const commitHash = rows[0].split(/\s+/)[0];
  if (input.commitHash && input.commitHash !== commitHash) throw new Error("Repository branch changed; run pre-flight again");
  return { commitHash, expectedCommit: originalCommit || undefined, revision: createHash("sha256").update(JSON.stringify([input.serverId || "local", input.customPath, input.repoUrl, input.branch, originalCommit, commitHash])).digest("hex") };
}

/** Both Local host namespace and enrolled SSH use this exact source pipeline.
 * Compose execution is supplied by the canonical ownership/build/bind/secret service,
 * never by a second raw `compose up` path. The callback must persist its baseline first.
 */
export async function deployGit(
  run: DeployRunner,
  input: GitDeployInput,
  compose: (run: DeployRunner, input: GitDeployInput, source: GitSource) => Promise<{ success: boolean; status: "RUNNING" | "FAILED" | "UNVERIFIED"; logs: string }>,
): Promise<GitDeploymentResult> {
  if (!input.commitHash) throw new Error("Run pre-flight to pin the source commit before execution");
  const pinned = await gitPreflight(run, input);
  if (pinned.expectedCommit && !input.expectedCommit) throw new Error("Existing repository updates require the exact original commit from pre-flight");
  const source: GitSource = { repoUrl: input.repoUrl, branch: input.branch, commitHash: pinned.commitHash, originalCommit: pinned.expectedCommit || null, customPath: input.customPath, serverId: input.serverId || "local", revision: pinned.revision };
  const stage = `${input.customPath}.panel-git-${randomUUID()}`;
  const stageQ = quote(stage);
  let ownedStage = false;
  try {
    await checked(run, `umask 077; mkdir -- ${stageQ}`);
    ownedStage = true;
    await checked(run, `GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c credential.helper= -c http.followRedirects=false -c core.hooksPath=/dev/null clone --depth 1 --single-branch --branch ${quote(input.branch)} -- ${quote(input.repoUrl)} ${stageQ}`, 120000);
    await checked(run, `test "$(git -C ${stageQ} rev-parse HEAD)" = ${quote(pinned.commitHash)} && test ! -e ${stageQ}/.gitmodules`);
    // Validate/execute from a disposable clone, not a possibly mismatched app-container filesystem.
    // The Compose capability takes the final path and staged source via sourcePath; it owns publication.
    const result = await compose(run, { ...input, ...{ sourcePath: stage } } as GitDeployInput, source);
    return { ...result, commitHash: pinned.commitHash, source };
  } finally {
    if (ownedStage) await checked(run, `test -d ${stageQ} && test ! -L ${stageQ} && rm -rf -- ${stageQ}`).catch(() => {});
  }
}
