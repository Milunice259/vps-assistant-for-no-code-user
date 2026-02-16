/**
 * Central input-validation helpers.
 *
 * Every function returns `{ valid: true }` or `{ valid: false, reason: string }`.
 * Import and call at the API boundary — never trust data past this gate.
 */

// ─── Result type ───

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

function ok(): ValidationResult {
  return { valid: true };
}
function fail(reason: string): ValidationResult {
  return { valid: false, reason };
}

// ─── Repository URL ───

const REPO_URL_RE =
  /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(\.git)?$/;

export function validateRepoUrl(url: unknown): ValidationResult {
  if (typeof url !== "string" || !url) return fail("repoUrl is required");
  if (!REPO_URL_RE.test(url))
    return fail(
      "repoUrl must be an HTTPS URL from github.com, gitlab.com, or bitbucket.org"
    );
  return ok();
}

// ─── Branch name ───

const BRANCH_RE = /^[a-zA-Z0-9._/-]{1,100}$/;

export function validateBranch(branch: unknown): ValidationResult {
  if (branch === undefined || branch === null) return ok(); // optional, default used
  if (typeof branch !== "string") return fail("branch must be a string");
  if (!BRANCH_RE.test(branch))
    return fail("branch contains invalid characters (allowed: a-z A-Z 0-9 . _ / -)");
  return ok();
}

// ─── Docker image ───

const DOCKER_IMAGE_RE =
  /^[a-z0-9]+([._/-][a-z0-9]+)*(:[a-zA-Z0-9._-]+)?$/;

export function validateDockerImage(image: unknown): ValidationResult {
  if (typeof image !== "string" || !image) return fail("image is required");
  if (image.length > 256) return fail("image name too long");
  if (!DOCKER_IMAGE_RE.test(image))
    return fail("image must match pattern: registry/name:tag (lowercase, no special chars)");
  return ok();
}

// ─── Restart policy ───

const ALLOWED_RESTART_POLICIES = ["always", "unless-stopped", "on-failure", "no"] as const;

export function validateRestartPolicy(policy: unknown): ValidationResult {
  if (policy === undefined || policy === null) return ok();
  if (typeof policy !== "string") return fail("restartPolicy must be a string");
  if (!(ALLOWED_RESTART_POLICIES as readonly string[]).includes(policy))
    return fail(`restartPolicy must be one of: ${ALLOWED_RESTART_POLICIES.join(", ")}`);
  return ok();
}

// ─── CPU limit ───

export function validateCpu(cpu: unknown): ValidationResult {
  if (cpu === undefined || cpu === null) return ok();
  const n = Number(cpu);
  if (!Number.isFinite(n) || n <= 0 || n > 32)
    return fail("cpuLimit must be a number between 0 and 32");
  return ok();
}

// ─── Memory limit ───

export function validateMemory(mem: unknown): ValidationResult {
  if (mem === undefined || mem === null) return ok();
  const n = Number(mem);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 64 || n > 65536)
    return fail("memoryLimit must be an integer between 64 and 65536 (MB)");
  return ok();
}

// ─── Path (customPath, projectPath) ───

const SAFE_PATH_RE = /^\/[a-zA-Z0-9._/-]*$/;

export function validatePath(path: unknown): ValidationResult {
  if (typeof path !== "string" || !path) return fail("path is required");
  if (!path.startsWith("/")) return fail("path must start with /");
  if (path.includes("..")) return fail("path must not contain ..");
  if (!SAFE_PATH_RE.test(path)) return fail("path contains invalid characters");
  return ok();
}

// ─── Env key ───

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

export function validateEnvKey(key: string): ValidationResult {
  if (!ENV_KEY_RE.test(key))
    return fail(`Invalid env key: ${key.slice(0, 30)}`);
  return ok();
}

// ─── Env value ───

const DANGEROUS_VALUE_CHARS = /[$`|&;\n\r]/;

export function validateEnvValue(value: string): ValidationResult {
  if (DANGEROUS_VALUE_CHARS.test(value))
    return fail("Env value contains forbidden characters ($, `, |, &, ;, newlines)");
  return ok();
}

// ─── Container ID ───

const CONTAINER_ID_RE = /^[a-zA-Z0-9_.-]{1,100}$/;

export function validateContainerId(id: unknown): ValidationResult {
  if (typeof id !== "string" || !id) return fail("containerId is required");
  if (!CONTAINER_ID_RE.test(id))
    return fail("containerId contains invalid characters");
  return ok();
}

// ─── Terminal command ───

const DANGEROUS_CMD_CHARS = /[$`|&;\n\r><]/;
const ALLOWED_CMD_PREFIXES = [
  // File & navigation
  "ls", "cat", "pwd", "echo", "head", "tail", "wc", "grep", "find", "which",
  "less", "more", "sort", "uniq", "awk", "sed", "xargs",
  "mkdir", "rm", "cp", "mv", "touch", "chmod", "chown", "ln",
  // System info
  "env", "printenv", "whoami", "id", "hostname", "uname", "date",
  "df", "du", "free", "top", "ps", "uptime", "kill",
  // Package managers (inside container)
  "apt", "apt-get", "apk", "yum", "dnf", "pip", "pip3",
  // Runtime / dev tools
  "npm", "npx", "node", "yarn", "pnpm", "python", "python3",
  "curl", "wget", "tar", "gzip", "gunzip", "zip", "unzip",
  // Shells & editors (inside container)
  "sh", "bash", "vi", "nano",
  // Services (inside container)
  "service", "systemctl",
] as const;

export function validateTerminalCommand(cmd: unknown): ValidationResult {
  if (typeof cmd !== "string" || !cmd) return fail("command is required");
  if (cmd.length > 4096) return fail("Command too long (max 4096 chars)");
  if (DANGEROUS_CMD_CHARS.test(cmd))
    return fail("Command contains forbidden characters ($, `, |, &, ;, newlines, >, <)");
  const executable = cmd.trim().split(/\s+/)[0];
  if (!executable) return fail("Empty command");
  if (!ALLOWED_CMD_PREFIXES.includes(executable as (typeof ALLOWED_CMD_PREFIXES)[number]))
    return fail(`Command '${executable}' is not in the allowed list`);
  return ok();
}

// ─── Compose YAML safety ───

const COMPOSE_DANGEROUS_KEYS = [
  "privileged",
  "cap_add",
  "cap_drop",
  "network_mode",
  "devices",
  "pid",
  "ipc",
  "security_opt",
  "cgroup_parent",
] as const;

const COMPOSE_ALLOWED_SERVICE_KEYS = new Set([
  "image",
  "ports",
  "environment",
  "env_file",
  "restart",
  "volumes",
  "command",
  "entrypoint",
  "labels",
  "depends_on",
  "healthcheck",
  "logging",
  "deploy",
  "build",
  "container_name",
  "working_dir",
  "expose",
  "networks",
  "stdin_open",
  "tty",
]);

export function validateComposeObject(parsed: unknown): ValidationResult {
  if (!parsed || typeof parsed !== "object") return fail("Invalid compose content");
  const doc = parsed as Record<string, unknown>;

  // Must have services
  if (!doc.services || typeof doc.services !== "object")
    return fail("Compose file must contain a 'services' key");

  const services = doc.services as Record<string, unknown>;

  for (const [svcName, svcDef] of Object.entries(services)) {
    if (!svcDef || typeof svcDef !== "object")
      return fail(`Service '${svcName}' is invalid`);

    const svc = svcDef as Record<string, unknown>;

    // Check dangerous keys
    for (const key of COMPOSE_DANGEROUS_KEYS) {
      if (key in svc) {
        if (key === "privileged" && svc[key] === true)
          return fail(`Service '${svcName}': 'privileged: true' is forbidden`);
        if (key === "network_mode" && svc[key] === "host")
          return fail(`Service '${svcName}': 'network_mode: host' is forbidden`);
        if (["cap_add", "devices", "security_opt"].includes(key))
          return fail(`Service '${svcName}': '${key}' is forbidden`);
      }
    }

    // Check for root volume mounts
    if (Array.isArray(svc.volumes)) {
      for (const vol of svc.volumes) {
        if (typeof vol === "string") {
          const hostPart = vol.split(":")[0];
          if (hostPart === "/" || hostPart === "//" || hostPart?.includes(".."))
            return fail(`Service '${svcName}': mounting '/' or '..' in volumes is forbidden`);
        }
      }
    }

    // Check for unknown keys
    for (const key of Object.keys(svc)) {
      if (!COMPOSE_ALLOWED_SERVICE_KEYS.has(key))
        return fail(`Service '${svcName}': unknown key '${key}' is not allowed`);
    }
  }

  return ok();
}

// ─── Domain (FQDN) ───

/**
 * Validate an FQDN domain.
 * Labels: 1–63 chars of [a-zA-Z0-9-], no leading/trailing hyphens.
 * Total length: ≤ 253 chars. At least 2 labels (e.g. "example.com").
 * Accepts punycode labels (xn-- prefix).
 */
export function validateDomain(domain: unknown): ValidationResult {
  if (domain === undefined || domain === null || domain === "") return ok();
  if (typeof domain !== "string") return fail("domain must be a string");

  const d = domain.toLowerCase().replace(/\.$/, ""); // strip trailing dot
  if (d.length > 253) return fail("Domain too long (max 253 chars)");

  const labels = d.split(".");
  if (labels.length < 2) return fail("Domain must have at least 2 labels (e.g. example.com)");

  const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63)
      return fail(`Domain label '${label}' is invalid (must be 1–63 chars)`);
    if (!LABEL_RE.test(label))
      return fail(`Domain label '${label}' contains invalid characters`);
  }
  return ok();
}

// ─── Health check command ───

/**
 * Validate a healthCheck command using the same safety rules as terminal commands.
 * Rejects shell metacharacters and requires an allowed executable prefix.
 * Empty/null is acceptable (no health check).
 */
export function validateHealthCheck(cmd: unknown): ValidationResult {
  if (cmd === undefined || cmd === null || cmd === "") return ok();
  if (typeof cmd !== "string") return fail("healthCheck must be a string");
  if (cmd.length > 4096) return fail("healthCheck too long (max 4096 chars)");
  if (DANGEROUS_CMD_CHARS.test(cmd))
    return fail("healthCheck contains forbidden characters ($, `, |, &, ;, newlines, >, <)");
  const executable = cmd.trim().split(/\s+/)[0];
  if (!executable) return fail("Empty health check command");
  // Health check allows the same executables as terminal, plus curl and wget
  const healthCheckPrefixes = [...ALLOWED_CMD_PREFIXES, "curl", "wget"] as const;
  if (!(healthCheckPrefixes as readonly string[]).includes(executable))
    return fail(`healthCheck command '${executable}' is not allowed`);
  return ok();
}

