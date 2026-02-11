/**
 * GitHub Deployer - Clone repos, detect stack, generate Docker Compose.
 */

import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from "fs";
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

const DEPLOY_DIR = "/tmp/vps-deployments";
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

  const repoName =
    repoUrl.split("/").pop()?.replace(".git", "") || "app";
  const targetDir = path.join(DEPLOY_DIR, `${repoName}-${Date.now()}`);

  mkdirSync(DEPLOY_DIR, { recursive: true });

  const result = spawnSync(
    "git",
    ["clone", "--depth", "1", "--branch", branch, repoUrl, targetDir],
    { timeout: 120_000, stdio: "pipe" }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || "Unknown git error";
    throw new Error(`git clone failed: ${stderr}`);
  }

  return targetDir;
}

/**
 * Remove a deployment directory safely.
 */
export function cleanupDeployDir(dirPath: string): void {
  try {
    if (dirPath.startsWith(DEPLOY_DIR) && existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
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
  try {
    if (!existsSync(DEPLOY_DIR)) return;

    const entries = readdirSync(DEPLOY_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: path.join(DEPLOY_DIR, e.name),
        // Extract timestamp from dir name (repoName-timestamp)
        ts: parseInt(e.name.split("-").pop() || "0", 10),
      }))
      .sort((a, b) => b.ts - a.ts); // newest first

    // Remove everything beyond the keep limit
    for (const entry of entries.slice(keep)) {
      rmSync(entry.path, { recursive: true, force: true });
    }
  } catch {
    // Best-effort pruning
  }
}

/**
 * Detect the tech stack from project files.
 */
export function detectStack(projectDir: string): DetectedStack {
  const files = readdirSync(projectDir);

  // Check package.json for JS/TS frameworks
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(projectDir, "package.json"), "utf-8")
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
  return existsSync(path.join(projectDir, "Dockerfile"));
}

/**
 * Full deploy pipeline: clone -> detect -> return config.
 */
export function prepareDeployment(
  repoUrl: string,
  branch: string = "main"
): DeployResult {
  const projectDir = cloneRepository(repoUrl, branch);
  const detectedStack = detectStack(projectDir);
  const port = getDefaultPort(detectedStack);

  return { projectDir, detectedStack, port };
}
