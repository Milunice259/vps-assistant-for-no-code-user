/**
 * GitHub Deployer - Clone repos, detect stack, generate Docker Compose.
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

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

/**
 * Clone a GitHub repository to a temporary directory.
 */
export function cloneRepository(
  repoUrl: string,
  branch: string = "main"
): string {
  const repoName =
    repoUrl.split("/").pop()?.replace(".git", "") || "app";
  const targetDir = path.join(DEPLOY_DIR, `${repoName}-${Date.now()}`);

  execSync(`mkdir -p ${DEPLOY_DIR}`);
  execSync(`git clone --depth 1 --branch ${branch} ${repoUrl} ${targetDir}`, {
    timeout: 120_000,
    stdio: "pipe",
  });

  return targetDir;
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
