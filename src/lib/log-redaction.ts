const MAX_LINE_CHARS = 64 * 1024;

/** Shared server/app log delivery policy; never modify the original logs. */
export function redactLogs(text: string): string {
  return text
    // Start at a key boundary: retrying the greedy prefix inside long words is quadratic.
    .replace(/((?<![\w.-])(?:[\w.-]*(?:password|passwd|pwd|token|secret|api[_-]?key)|authorization|bearer)["']?\s*[:=]\s*)(?:"(?:\\[^\r\n]|[^"\\\r\n])*(?:"|\\?$)|'(?:\\[^\r\n]|[^'\\\r\n])*(?:'|\\?$)|`(?:\\[^\r\n]|[^`\\\r\n])*(?:`|\\?$)|(?:basic|bearer)\s+[^\s,;}]+|[^\s,;}]+)/gim, "$1[REDACTED]")
    .replace(/(\bbearer\s+)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/[^\s:/]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2");
}

/** Frame before redacting: transport chunks are not log/security boundaries. */
export function createLogRedactor(emit: (line: string) => void) {
  const decoder = new TextDecoder();
  let pending = "";
  let oversized = false;
  function text(chunk: string) {
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf("\n", offset);
      const part = chunk.slice(offset, end < 0 ? chunk.length : end);
      if (!oversized) {
        if (pending.length + part.length > MAX_LINE_CHARS) {
          pending = "";
          oversized = true;
        } else pending += part;
      }
      if (end < 0) break;
      if (oversized) emit("[Oversized log line redacted]");
      else if (pending.trim()) emit(redactLogs(pending.replace(/\r$/, "")));
      pending = "";
      oversized = false;
      offset = end + 1;
    }
  }
  return {
    write(chunk: Uint8Array) { text(decoder.decode(chunk, { stream: true })); },
    end() {
      text(decoder.decode());
      if (oversized) emit("[Oversized log line redacted]");
      else if (pending.trim()) emit(redactLogs(pending));
      pending = "";
      oversized = false;
    },
  };
}
