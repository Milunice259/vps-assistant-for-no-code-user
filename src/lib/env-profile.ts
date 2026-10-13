import { encrypt, decrypt } from "@/lib/crypto";

export const REDACTED = "[REDACTED]";
const PREFIX = "enc:v1:";

// Docker Env is an ordered array; it can contain multiline values and non-shell keys.
export function encodeEnvBaseline(env: string[]): string {
  return PREFIX + encrypt(JSON.stringify(env));
}

export function decodeEnvBaseline(stored: string): string[] {
  if (!stored.startsWith(PREFIX)) throw new Error("Encrypted baseline required");
  const env: unknown = JSON.parse(decrypt(stored.slice(PREFIX.length)));
  if (!Array.isArray(env) || !env.every(v => typeof v === "string" && v.includes("=") && !v.includes("\0"))) throw new Error("Invalid baseline");
  return env;
}

function invalidVars(): never {
  throw Object.assign(new Error("Invalid environment variables or unresolved redacted value"), { statusCode: 400 });
}

/** Masks mean keep the same key's original value; omitted keys are deliberately deleted. */
export function mergeEnvVars(input: unknown, original: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidVars();
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")) invalidVars();
    if (value === REDACTED) {
      if (!Object.hasOwn(original, key) || original[key] === REDACTED) invalidVars();
      return [key, original[key]];
    }
    return [key, value];
  }));
}

export function decodeProfileVars(stored: string): Record<string, string> {
  // ponytail: legacy JSON is read-only compatible; migrate only after a backed-up migration.
  return mergeEnvVars(JSON.parse(stored.startsWith(PREFIX) ? decrypt(stored.slice(PREFIX.length)) : stored));
}

export function decodeEncryptedVars(stored: string): Record<string, string> {
  if (typeof stored !== "string" || !stored.startsWith(PREFIX)) throw new Error("Authenticated encrypted state required");
  return mergeEnvVars(JSON.parse(decrypt(stored.slice(PREFIX.length))));
}

export function encodeProfileVars(vars: Record<string, string>): string {
  return PREFIX + encrypt(JSON.stringify(mergeEnvVars(vars)));
}

/** All values can contain credentials (URLs and arbitrary keys included). Never return plaintext. */
export function redactEnvVars(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(vars).map((key) => [key, REDACTED]));
}
