/**
 * Safe error message utility — translates technical errors to user-friendly
 * messages and strips internal paths to prevent leaking server internals.
 */

/** Map of technical error patterns → friendly messages for non-tech users */
const FRIENDLY_ERRORS: [RegExp, string][] = [
  [/SQLITE_BUSY/i, "The system is busy. Please try again in a moment."],
  [/SQLITE_CONSTRAINT/i, "This item already exists or conflicts with another."],
  [/ECONNREFUSED/i, "Could not connect to the server. Is it running?"],
  [/ECONNRESET/i, "Connection was interrupted. Please try again."],
  [/ETIMEDOUT|ESOCKETTIMEDOUT/i, "Connection timed out. The server may be slow or unreachable."],
  [/ENOTFOUND/i, "Server not found. Please check the hostname or IP address."],
  [/EACCES|EPERM/i, "Permission denied. Check your credentials or access rights."],
  [/ENOENT/i, "The requested file or resource was not found."],
  [/authentication failed/i, "Authentication failed. Check your username and password."],
  [/host key/i, "Could not verify the server's identity. Please check the SSH key."],
  [/all configured authentication methods failed/i, "Login failed. Verify your SSH credentials."],
  [/channel open failure/i, "Could not open a connection to the server."],
  [/handshake failed/i, "Secure connection could not be established."],
  [/invalid key/i, "The encryption key is invalid. Check your configuration."],
  [/JWT/i, "Your session has expired. Please log in again."],
  [/too many connections/i, "Server is overloaded. Try again later."],
  [/out of memory/i, "Server ran out of memory. Try a smaller operation."],
  [/disk.*(full|space)/i, "Server disk is full. Free up space before continuing."],
];

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    // Check for known patterns → return friendly message
    for (const [pattern, friendly] of FRIENDLY_ERRORS) {
      if (pattern.test(error.message)) return friendly;
    }

    // Strip paths but keep the message readable
    return error.message
      .replace(/\/[\w/.:-]+/g, "[path]")           // unix paths
      .replace(/[A-Z]:\\[\w\\.:-]+/gi, "[path]")   // windows paths
      .slice(0, 200);
  }
  return fallback;
}
