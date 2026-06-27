export const PASSWORD_POLICY_TEXT="Password must be at least 12 characters with uppercase, lowercase, number, and symbol.";

export function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return PASSWORD_POLICY_TEXT;
  if (!/[a-z]/.test(password)) return PASSWORD_POLICY_TEXT;
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_TEXT;
  if (!/\d/.test(password)) return PASSWORD_POLICY_TEXT;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_POLICY_TEXT;
  return null;
}
