/**
 * GitHub Deployer - Clone repos, detect stack, generate Docker Compose.
 */

import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, mkdtempSync, lstatSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { validateRepoUrl, validateBranch } from "./validation";

export type DetectedStack =
  | "nextjs"
  | "react"
  | "vue"
  | "nuxt"
  | "node"
  | "python"
  | "go"
  | "rust"
  | "static"
  | "unknown";

export interface DeployResult {
  projectDir: string;
  detectedStack: DetectedStack;
  port: number;
}

const DEPLOY_DIR = path.join(realpathSync(tmpdir()), `vps-repository-analysis-${process.getuid?.() ?? "panel"}`);
const ownedDirs = new Set<string>();
/** Keep at most this many deployment dirs before pruning old ones */
const MAX_DEPLOY_DIRS = 5;

/**
 * Clone a GitHub repository to a temporary directory.
 * Uses spawnSync with array args — no shell interpolation.
 */
export function cloneRepository(
  repoUrl: string,
  branch: string = "main"
): string {
  // Validate inputs before executing
  const urlCheck = validateRepoUrl(repoUrl);
  if (!urlCheck.valid) throw new Error(urlCheck.reason);

  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) throw new Error(branchCheck.reason);

  const ref = spawnSync("git", ["check-ref-format", `refs/heads/${branch}`], { timeout: 5000 });
  if (ref.status !== 0) throw new Error("Invalid Git branch ref");
  mkdirSync(DEPLOY_DIR, { recursive: true, mode: 0o700 });
  const parent = lstatSync(DEPLOY_DIR);
  if (!parent.isDirectory() || parent.isSymbolicLink() || realpathSync(DEPLOY_DIR) !== DEPLOY_DIR || parent.uid !== process.getuid?.() || (parent.mode & 0o077)) throw new Error("Analysis directory must be private and target-owned");
  const targetDir = mkdtempSync(path.join(DEPLOY_DIR, "analysis-"));
  ownedDirs.add(targetDir);

  const result = spawnSync(
    "git",
    ["-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "core.hooksPath=/dev/null", "clone", "--depth", "1", "--single-branch", "--branch", branch, "--", repoUrl, targetDir],
    { timeout: 120_000, stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }
  );

  if (result.status !== 0) {
    cleanupDeployDir(targetDir);
    throw new Error("Public repository clone failed");
  }

  return targetDir;
}

/**
 * Remove a deployment directory safely.
 */
export function cleanupDeployDir(dirPath: string): void {
  try {
    if (ownedDirs.has(dirPath) && path.dirname(dirPath) === DEPLOY_DIR && existsSync(dirPath) && !lstatSync(dirPath).isSymbolicLink()) {
      rmSync(dirPath, { recursive: true, force: true });
      ownedDirs.delete(dirPath);
    }
  } catch {
    // Best-effort cleanup — don't crash if removal fails
  }
}

/**
 * Prune old deployment directories, keeping only the most recent ones.
 * Prevents /tmp from filling up over time.
 */
export function pruneOldDeployments(keep: number = MAX_DEPLOY_DIRS): void {
  // Only allocations made by this process are ours; never prune another request/process.
  for (const dir of [...ownedDirs].slice(0, Math.max(0, ownedDirs.size - keep))) cleanupDeployDir(dir);
}

/**
 * Detect the tech stack from project files.
 */
function readAnalysisFile(projectDir: string, name: string): string {
  const file = path.join(projectDir, name);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw new Error("Unsupported analysis file");
  return readFileSync(file, "utf-8");
}

export function detectStack(projectDir: string): DetectedStack {
  const files = readdirSync(projectDir);

  // Check package.json for JS/TS frameworks
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(
        readAnalysisFile(projectDir, "package.json")
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps["next"]) return "nextjs";
      if (deps["nuxt"] || deps["nuxt3"]) return "nuxt";
      if (deps["vue"]) return "vue";
      if (deps["react"] || deps["react-dom"]) return "react";
      return "node";
    } catch {
      return "node";
    }
  }

  // Python
  if (
    files.includes("requirements.txt") ||
    files.includes("pyproject.toml") ||
    files.includes("Pipfile")
  ) {
    return "python";
  }

  // Go
  if (files.includes("go.mod")) return "go";

  // Rust
  if (files.includes("Cargo.toml")) return "rust";

  // Static HTML
  if (files.includes("index.html")) return "static";

  return "unknown";
}

/**
 * Get the default port for a detected stack.
 */
export function getDefaultPort(stack: DetectedStack): number {
  const portMap: Record<DetectedStack, number> = {
    nextjs: 3000,
    react: 3000,
    vue: 3000,
    nuxt: 3000,
    node: 3000,
    python: 8000,
    go: 8080,
    rust: 8080,
    static: 80,
    unknown: 3000,
  };
  return portMap[stack];
}

/**
 * Check if a directory has a Dockerfile.
 */
export function hasDockerfile(projectDir: string): boolean {
  const file = path.join(projectDir, "Dockerfile");
  return existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink();
}

/**
 * Full deploy pipeline: clone -> detect -> return config.
 */
export function prepareDeployment(
  repoUrl: string,
  branch: string = "main"
): DeployResult {
  const projectDir = cloneRepository(repoUrl, branch);
  try {
    const detectedStack = detectStack(projectDir);
    return { projectDir, detectedStack, port: getDefaultPort(detectedStack) };
  } catch (error) {
    cleanupDeployDir(projectDir);
    throw error;
  }
}
