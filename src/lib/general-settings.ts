import { prisma } from "./db";

export const DEFAULT_GENERAL_SETTINGS = {
  applicationName: "VPS Control",
  dockerRestartPolicy: "unless-stopped",
  dockerMemoryLimitMB: 0,
  cleanupSchedule: "never",
  backupSchedule: "never",
  backupRetentionDays: 30,
};
export type GeneralSettings = typeof DEFAULT_GENERAL_SETTINGS;
const KEY = "general";

export function validateGeneralSettings(input: unknown): input is GeneralSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const s = input as GeneralSettings;
  return Object.keys(input).length === Object.keys(DEFAULT_GENERAL_SETTINGS).length &&
    Object.keys(DEFAULT_GENERAL_SETTINGS).every(key => Object.hasOwn(input, key)) &&
    typeof s.applicationName === "string" && s.applicationName.trim() === s.applicationName &&
    s.applicationName.length > 0 && s.applicationName.length <= 80 && !/[\u0000-\u001f\u007f]/.test(s.applicationName) &&
    ["unless-stopped", "always", "on-failure", "no"].includes(s.dockerRestartPolicy) &&
    Number.isInteger(s.dockerMemoryLimitMB) && (s.dockerMemoryLimitMB === 0 || s.dockerMemoryLimitMB >= 64 && s.dockerMemoryLimitMB <= 65536) &&
    ["never", "daily", "weekly", "monthly"].includes(s.cleanupSchedule) &&
    ["never", "daily", "weekly", "monthly"].includes(s.backupSchedule) &&
    Number.isInteger(s.backupRetentionDays) && s.backupRetentionDays >= 1 && s.backupRetentionDays <= 3650;
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return { ...DEFAULT_GENERAL_SETTINGS };
  const settings: unknown = JSON.parse(row.value);
  if (!validateGeneralSettings(settings)) throw new Error("Stored general settings are invalid");
  return settings;
}

export async function saveGeneralSettings(settings: GeneralSettings): Promise<GeneralSettings> {
  if (!validateGeneralSettings(settings)) throw new Error("Invalid general settings");
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(settings) }, update: { value: JSON.stringify(settings) } });
  const saved = await getGeneralSettings();
  if (Object.keys(settings).some(key => settings[key as keyof GeneralSettings] !== saved[key as keyof GeneralSettings])) throw new Error("Settings changed during save; reload before retrying");
  return saved;
}

// ponytail: intent only; REC-01 and OPS-01 must supply independent authorized, asset-safe workers before activation.
export const SCHEDULE_CAPABILITIES = {
  backup: { active: false, phase: "REC-01", reason: "No independent integrity-checked backup worker or safe retention consumer exists." },
  cleanup: { active: false, phase: "OPS-01", reason: "No bounded cleanup worker preserving active data and rollback assets exists." },
};
