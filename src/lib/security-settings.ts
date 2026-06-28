import { prisma } from "./db";

export interface SecuritySettings {
  sessionMaxAgeHours: number;
  idleTimeoutMinutes: number;
  rememberMeEnabled: boolean;
  rememberMeDays: number;
  passwordMinLength: number;
  passwordRequireComplexity: boolean;
  defaultSafeMode: boolean;
  loginMaxAttempts: number;
  loginWindowSeconds: number;
  loginLockoutMinutes: number;
  auditRetentionDays: number;
  forceLogoutVersion: number;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  sessionMaxAgeHours: 24,
  idleTimeoutMinutes: 60,
  rememberMeEnabled: false,
  rememberMeDays: 7,
  passwordMinLength: 12,
  passwordRequireComplexity: true,
  defaultSafeMode: true,
  loginMaxAttempts: 5,
  loginWindowSeconds: 60,
  loginLockoutMinutes: 15,
  auditRetentionDays: 90,
  forceLogoutVersion: 0,
};

const KEY = "security";
const SESSION_HOURS = [1, 8, 24, 168];
const REMEMBER_DAYS = [7, 14, 30];
const IDLE_MINUTES = [0, 15, 30, 60];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

export function normalizeSecuritySettings(input: Partial<SecuritySettings>): SecuritySettings {
  return {
    sessionMaxAgeHours: SESSION_HOURS.includes(Number(input.sessionMaxAgeHours)) ? Number(input.sessionMaxAgeHours) : DEFAULT_SECURITY_SETTINGS.sessionMaxAgeHours,
    idleTimeoutMinutes: IDLE_MINUTES.includes(Number(input.idleTimeoutMinutes)) ? Number(input.idleTimeoutMinutes) : DEFAULT_SECURITY_SETTINGS.idleTimeoutMinutes,
    rememberMeEnabled: input.rememberMeEnabled === true,
    rememberMeDays: REMEMBER_DAYS.includes(Number(input.rememberMeDays)) ? Number(input.rememberMeDays) : DEFAULT_SECURITY_SETTINGS.rememberMeDays,
    passwordMinLength: clamp(input.passwordMinLength, 8, 64, DEFAULT_SECURITY_SETTINGS.passwordMinLength),
    passwordRequireComplexity: input.passwordRequireComplexity !== false,
    defaultSafeMode: input.defaultSafeMode !== false,
    loginMaxAttempts: clamp(input.loginMaxAttempts, 3, 20, DEFAULT_SECURITY_SETTINGS.loginMaxAttempts),
    loginWindowSeconds: clamp(input.loginWindowSeconds, 30, 300, DEFAULT_SECURITY_SETTINGS.loginWindowSeconds),
    loginLockoutMinutes: clamp(input.loginLockoutMinutes, 1, 1440, DEFAULT_SECURITY_SETTINGS.loginLockoutMinutes),
    auditRetentionDays: clamp(input.auditRetentionDays, 7, 3650, DEFAULT_SECURITY_SETTINGS.auditRetentionDays),
    forceLogoutVersion: clamp(input.forceLogoutVersion, 0, Number.MAX_SAFE_INTEGER, DEFAULT_SECURITY_SETTINGS.forceLogoutVersion),
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
  const current = await getSecuritySettings();
  const settings = normalizeSecuritySettings({ ...current, ...input });
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(settings) },
    update: { value: JSON.stringify(settings) },
  });
  return settings;
}
