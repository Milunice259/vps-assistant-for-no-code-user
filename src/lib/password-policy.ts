import type { SecuritySettings } from "./security-settings";

export const PASSWORD_POLICY_TEXT = "Password must be at least 12 characters with uppercase, lowercase, number, and symbol.";

export function passwordPolicyText(settings?: Pick<SecuritySettings, "passwordMinLength" | "passwordRequireComplexity">): string {
  const min = settings?.passwordMinLength ?? 12;
  return settings?.passwordRequireComplexity === false
    ? `Password must be at least ${min} characters.`
    : `Password must be at least ${min} characters with uppercase, lowercase, number, and symbol.`;
}

export function passwordPolicyError(
  password: string,
  settings?: Pick<SecuritySettings, "passwordMinLength" | "passwordRequireComplexity">
): string | null {
  const text = passwordPolicyText(settings);
  if (password.length < (settings?.passwordMinLength ?? 12)) return text;
  if (settings?.passwordRequireComplexity === false) return null;
  if (!/[a-z]/.test(password)) return text;
  if (!/[A-Z]/.test(password)) return text;
  if (!/\d/.test(password)) return text;
  if (!/[^A-Za-z0-9]/.test(password)) return text;
  return null;
}
