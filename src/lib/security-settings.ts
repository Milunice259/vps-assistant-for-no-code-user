import { prisma } from "./db";

export interface SecuritySettings {
  sessionMaxAgeHours: number;
  passwordMinLength: number;
  passwordRequireComplexity: boolean;
  defaultSafeMode: boolean;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  sessionMaxAgeHours: 24,
  passwordMinLength: 12,
  passwordRequireComplexity: true,
  defaultSafeMode: true,
};

const KEY = "security";
const SESSION_HOURS = [1, 8, 24, 168];

export function normalizeSecuritySettings(input: Partial<SecuritySettings>): SecuritySettings {
  return {
    sessionMaxAgeHours: SESSION_HOURS.includes(Number(input.sessionMaxAgeHours)) ? Number(input.sessionMaxAgeHours) : DEFAULT_SECURITY_SETTINGS.sessionMaxAgeHours,
    passwordMinLength: Math.min(64, Math.max(8, Number(input.passwordMinLength) || DEFAULT_SECURITY_SETTINGS.passwordMinLength)),
    passwordRequireComplexity: input.passwordRequireComplexity !== false,
    defaultSafeMode: input.defaultSafeMode !== false,
  };
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SECURITY_SETTINGS;
  try {
    return normalizeSecuritySettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_SECURITY_SETTINGS;
  }
}

export async function saveSecuritySettings(input: Partial<SecuritySettings>): Promise<SecuritySettings> {
  const settings = normalizeSecuritySettings(input);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(settings) },
    update: { value: JSON.stringify(settings) },
  });
  return settings;
}
