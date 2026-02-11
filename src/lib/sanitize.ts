/**
 * Sanitize log output before persistence.
 * Strips patterns that look like secrets, tokens, or credentials.
 */

const SECRET_PATTERNS: readonly RegExp[] = [
  // Bearer tokens
  /Authorization:\s*Bearer\s+\S+/gi,
  // JWT-like strings (header.payload.signature)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Generic API keys / tokens (long hex or base64 strings assigned with =)
  /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)\s*[:=]\s*\S+/gi,
  // AWS-style access key IDs
  /AKIA[0-9A-Z]{16}/g,
  // Private key blocks
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
  // password=<value> patterns
  /password\s*[:=]\s*\S+/gi,
  // Authorization header values
  /Authorization:\s*\S+/gi,
];

const REDACTED = "[REDACTED]";

/**
 * Remove secret-like patterns from log text.
 * Safe for multi-line strings.
 */
export function sanitizeLogs(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}
