import yaml from "js-yaml";
import { validateComposeAssets } from "./compose-deployment";
import { getGeneralSettings } from "./general-settings";
import { validateDockerImage, validateRestartPolicy, validateCpu, validateMemory, validateEnvKey, validateEnvValue, validatePath, validateComposeObject } from "@/lib/validation";

export type DeployRunner = (command: string, timeoutMs?: number) => Promise<string>;
export type DockerInput = {
  type: "image" | "compose"; serverId?: string; image?: string; name?: string;
  ports?: string[]; env?: Record<string, string>; cpuLimit?: number; memoryLimit?: number; restartPolicy?: string;
  composeContent?: string; projectPath?: string; projectName?: string;
  composeMode?: "create" | "update"; composeDeploymentId?: string;
  composeConsent?: { directory?: string; builds?: string[]; recreate?: boolean; foreignBinds?: string[]; externalVolumes?: string[]; externalNetworks?: string[] };
  composeFiles?: Record<string, string>;
  composeRevision?: string;
  dataCompatibility?: "unchanged" | "operator-confirmed";
  schemaCompatibility?: "unchanged" | "operator-confirmed";
  composePlan?: { revision: string; services: string[] };
};
export const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const marker = "__PANEL_DEPLOY_EXIT_";
// SSH can resolve silent nonzero exits. Never infer success from resolution.
export async function checked(run: DeployRunner, command: string, timeout = 10_000) {
  let output: string;
  try { output = await run(`( ${command} ) 2>&1; code=$?; printf '\\n${marker}%s__\\n' "$code"`, timeout); }
  catch { throw new Error("Target command failed. No automatic rollback was attempted."); }
  const match = output.trim().match(/(?:^|\n)__PANEL_DEPLOY_EXIT_(\d+)__$/);
  if (!match || match[1] !== "0") throw new Error("Target command failed or completion could not be verified. No automatic rollback was attempted.");
  return output.trim().slice(0, match.index).trim();
}
const portNumber = (value: unknown) => /^\d{1,5}$/.test(String(value)) && Number(value) > 0 && Number(value) <= 65535;
const safeName = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value);
export function validateDockerDeploy(body: DockerInput): string | null {
  if (body.type === "image") {
    for (const result of [validateDockerImage(body.image), validateRestartPolicy(body.restartPolicy), validateCpu(body.cpuLimit), validateMemory(body.memoryLimit === 0 ? undefined : body.memoryLimit)]) if (!result.valid) return result.reason;
    if ((body.name !== undefined && !safeName(body.name)) || (body.cpuLimit !== undefined && typeof body.cpuLimit !== "number") || (body.memoryLimit !== undefined && typeof body.memoryLimit !== "number") || (body.restartPolicy !== undefined && typeof body.restartPolicy !== "string")) return "Malformed image options";
    if (body.ports !== undefined && (!Array.isArray(body.ports) || body.ports.some(p => typeof p !== "string" || !/^\d{1,5}:\d{1,5}(?:\/(?:tcp|udp))?$/.test(p) || p.split("/")[0].split(":").some(n => !portNumber(n))))) return "Invalid port mapping";
    if (body.env !== undefined) {
      if (!body.env || typeof body.env !== "object" || Array.isArray(body.env)) return "Invalid environment options";
      for (const [key, value] of Object.entries(body.env)) if (!validateEnvKey(key).valid || !validateEnvValue(value).valid) return "Invalid environment options";
    }
    return null;
  }
  if (body.type !== "compose") return "type must be image or compose";
  if (typeof body.composeContent !== "string" || !body.composeContent || body.composeContent.length > 262144) return "Compose content is required (maximum 256 KiB)";
  if (!validatePath(body.projectPath).valid || !/^\/[a-zA-Z0-9_-][a-zA-Z0-9._/-]*[a-zA-Z0-9_-]$/.test(body.projectPath || "")) return "Use a new absolute project directory";
  if (body.projectName !== undefined && (typeof body.projectName !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(body.projectName))) return "Invalid project name";
  let doc;
  try {
    doc = yaml.load(body.composeContent) as Record<string, unknown>;
    // Scan parsed YAML too: escapes can spell dollars. Consume $$ pairs before interpolation.
    if (/\$(?:[A-Za-z_]|\{)/.test(JSON.stringify(doc).replace(/\$\$/g, ""))) return "Compose interpolation is not supported; use $$ for literal dollars";
  } catch { return "Invalid Compose YAML"; }
  if (!validateComposeObject(doc).valid) return "Unsupported or unsafe Compose configuration";
  return validateComposeAssets(body, doc);
}
export function projectName(body: DockerInput) {
  return body.projectName || body.projectPath!.split("/").pop()!.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}
export async function resourcePreflight(run: DeployRunner, needsDocker: boolean) {
  if (needsDocker) await checked(run, "docker info >/dev/null");
  const disk = await checked(run, "df -P / | tail -1 | awk '{print $5}' | tr -d '%'");
  const memory = await checked(run, "awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {if (t > 0) printf \"%.0f\", a/t*100}' /proc/meminfo");
  if (!/^\d+$/.test(disk) || Number(disk) > 100 || !/^\d+$/.test(memory) || Number(memory) > 100) throw new Error("Resource readings are unavailable. Run pre-flight again.");
  if (Number(disk) >= 90 || Number(memory) < 8) throw new Error("Insufficient disk space or available memory for deployment.");
}
async function requireFresh(run: DeployRunner, kind: "container" | "volume" | "network", name: string) {
  const command = kind === "container" ? "docker ps -a --format '{{.Names}}'" : `docker ${kind} ls --format '{{.Name}}'`;
  const names = await checked(run, command);
  if (names.split(/\s+/).includes(name)) throw new Error("An asset with this name already exists");
}
export async function dockerPreflight(run: DeployRunner, body: DockerInput) {
  // Resolve once before both planning and execution; Compose owns its explicit definition.
  if (body.type === "image") {
    const settings = await getGeneralSettings();
    if (body.restartPolicy === undefined) body.restartPolicy = settings.dockerRestartPolicy;
    if (body.memoryLimit === undefined && settings.dockerMemoryLimitMB > 0) body.memoryLimit = settings.dockerMemoryLimitMB;
  }
  await resourcePreflight(run, true);
  let ports: Array<{ published: string; protocol: string }> = [];
  const services: string[] = [];
  if (body.type === "image") {
    if (body.name) await requireFresh(run, "container", body.name);
    ports = (body.ports || []).map(p => ({ published: p.split(":")[0], protocol: p.endsWith("/udp") ? "udp" : "tcp" }));
  } else {
    const { composePreflight } = await import("./compose-deployment");
    return await composePreflight(run, body);
  }
  const allocated = new Set<string>();
  if (ports.length) {
    const active = (await checked(run, "docker ps -q")).split(/\s+/).filter(Boolean);
    if (active.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Docker port inventory is unavailable");
    if (active.length) {
      const inventory = await checked(run, `docker inspect --format '{{json .NetworkSettings.Ports}}' ${active.map(quote).join(" ")}`);
      const rows = inventory.split("\n");
      if (rows.length !== active.length) throw new Error("Docker port inventory is incomplete");
      for (const row of rows) {
        const mappings = JSON.parse(row);
        if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) throw new Error("Docker port inventory is unavailable");
        for (const [containerPort, bindings] of Object.entries(mappings)) {
          const protocol = containerPort.split("/")[1];
          if (bindings === null) continue;
          if (!["tcp", "udp"].includes(protocol) || !Array.isArray(bindings)) throw new Error("Unsupported Docker port inventory");
          for (const binding of bindings) {
            if (!portNumber(binding?.HostPort)) throw new Error("Unknown allocated Docker port");
            allocated.add(`${Number(binding.HostPort)}/${protocol}`);
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  for (const port of ports) {
    const key = `${port.published}/${port.protocol}`;
    if (allocated.has(key)) throw new Error(`Port ${key} is already allocated by Docker`);
    if (seen.has(key)) throw new Error("Duplicate published port");
    seen.add(key);
    const listening = await checked(run, `ss -${port.protocol === "udp" ? "lun" : "ltn"}H '( sport = :${Number(port.published)} )'`);
    if (listening) throw new Error(`Port ${key} is already in use`);
  }
  return { services };
}
export function readiness(containers: unknown, expectedServices?: string[], expectedId?: string): "RUNNING" | "FAILED" | "UNVERIFIED" {
  if (!Array.isArray(containers) || !containers.length || containers.some(c => !c || typeof c !== "object" || !c.State || typeof c.State !== "object")) return "UNVERIFIED";
  if (containers.some(c => ["exited", "dead"].includes(c.State?.Status) || c.State?.Health?.Status === "unhealthy")) return "FAILED";
  if (expectedId && (containers.length !== 1 || containers[0]?.Id !== expectedId)) return "UNVERIFIED";
  if (expectedServices && (expectedServices.some(s => !containers.some(c => c.Config?.Labels?.["com.docker.compose.service"] === s)) || containers.some(c => !expectedServices.includes(c.Config?.Labels?.["com.docker.compose.service"])))) return "UNVERIFIED";
  return containers.every(c => c.State?.Status === "running" && c.State?.Health?.Status === "healthy") ? "RUNNING" : "UNVERIFIED";
}
