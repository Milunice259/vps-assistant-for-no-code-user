import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { configurationHash, createPayload } from "@/lib/container-recreate";

// Native inspect is encrypted/internal; outward callers must use deploymentDTO.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Native = Record<string, any>;
export type DeploymentDefinition = { kind: "image" | "compose" | "git"; [key: string]: unknown };
export type DeploymentRuntime = { containerIds: string[]; appId?: string; inspect?: Native; imageDigest?: string; repoDigests?: string[]; [key: string]: unknown };
export type DeploymentSnapshot = { inspect: Native; imageDigest: string; repoDigests: string[]; fingerprint: string };
export type DeploymentState = {
  version: 1; deploymentId: string; serverId: string; definition: DeploymentDefinition; runtime: DeploymentRuntime;
  original?: DeploymentSnapshot; current?: DeploymentSnapshot; retained?: DeploymentSnapshot[]; pending?: string;
};
export function deploymentFail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode, deploymentError: true }); }
export function validateJSON(value: unknown): void {
  const text = JSON.stringify(value);
  if (!text || text.length > 4_000_000) deploymentFail("Deployment definition is too large", 400);
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 30) deploymentFail("Deployment definition is too deeply nested", 400);
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object") deploymentFail("Deployment definition must contain JSON values", 400);
    if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return; }
    for (const [key, item] of Object.entries(v)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) deploymentFail("Invalid definition field", 400);
      walk(item, depth + 1);
    }
  };
  walk(value);
}
export const definitionKey = (id: string) => "deployment:v1:" + id;
export function sealDeployment(state: DeploymentState): string { validateJSON(state); return "enc:v1:" + encrypt(JSON.stringify(state)); }
export function snapshot(inspect: Native, repoDigests: string[] = []): DeploymentSnapshot {
  if (!/^[a-f0-9]{64}$/.test(inspect.Id) || !/^sha256:[a-f0-9]{64}$/.test(inspect.Image)) deploymentFail("Full runtime/image identity is required", 422);
  return { inspect, imageDigest: inspect.Image, repoDigests: repoDigests.filter(d => typeof d === "string" && /@sha256:[a-f0-9]{64}$/.test(d)), fingerprint: configurationHash(createPayload(inspect, inspect.Config.Env)) };
}
export async function saveDeploymentDefinition(deploymentId: string, serverId: string, definition: DeploymentDefinition, runtime: DeploymentRuntime): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(deploymentId) || typeof serverId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(serverId) || !definition || !["image", "compose", "git"].includes(definition.kind) || !Array.isArray(runtime?.containerIds) || !runtime.containerIds.every(id => /^[a-f0-9]{64}$/.test(id))) deploymentFail("Invalid deployment definition or full container identities", 400);
  validateJSON(definition); validateJSON(runtime);
  const record = await prisma.deploymentLog.findUnique({ where: { id: deploymentId }, select: { serverId: true } });
  if (!record || (record.serverId || "local") !== serverId) deploymentFail("Deployment target binding changed");
  const original = definition.kind === "image" && runtime.inspect ? snapshot(runtime.inspect, runtime.repoDigests) : undefined;
  if (original && (runtime.containerIds.length !== 1 || runtime.containerIds[0] !== original.inspect.Id)) deploymentFail("Deployment runtime identity mismatch");
  const state: DeploymentState = { version: 1, deploymentId, serverId, definition, runtime, ...(original ? { original, current: original, retained: [] } : {}) };
  try { await prisma.appSetting.create({ data: { key: definitionKey(deploymentId), value: sealDeployment(state) } }); }
  catch { deploymentFail("Original deployment definition already exists or could not be saved"); }
}
export async function readDeploymentDefinition(deploymentId: string): Promise<{ state: DeploymentState; value: string; key: string } | null> {
  const key = definitionKey(deploymentId);
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    if (!row.value.startsWith("enc:v1:")) throw Error();
    const state: DeploymentState = JSON.parse(decrypt(row.value.slice(7)));
    if (state.version !== 1 || state.deploymentId !== deploymentId || !["image", "compose", "git"].includes(state.definition.kind)) throw Error();
    validateJSON(state);
    return { state, value: row.value, key };
  } catch { deploymentFail("Encrypted deployment definition is unavailable or invalid", 422); }
}
export function deploymentDTO(state: DeploymentState) {
  const current = state.current;
  return {
    deploymentId: state.deploymentId, serverId: state.serverId, kind: state.definition.kind,
    originalDefinitionAvailable: true, appId: state.runtime.appId || null,
    containerIds: [...state.runtime.containerIds], imageDigest: current?.imageDigest || null,
    repoDigests: current?.repoDigests || [], originalImageDigest: state.original?.imageDigest || null,
    revision: configurationHash(state), pending: !!state.pending,
    retainedContainerIds: (state.retained || []).map(s => s.inspect.Id),
    rollbackScope: "Container configuration and image only; database, schema and external data are not restored",
  };
}
