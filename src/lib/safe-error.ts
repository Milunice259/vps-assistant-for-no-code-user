/**
 * Safe error message utility — strips internal paths and limits length
 * to prevent leaking server internals to clients.
 */

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
      .replace(/\/[\w/.:-]+/g, "[path]")           // unix paths
      .replace(/[A-Z]:\\[\w\\.:-]+/gi, "[path]")   // windows paths
      .slice(0, 200);
  }
  return fallback;
}
