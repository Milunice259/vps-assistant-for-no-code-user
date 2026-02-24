/**
 * Container Crash Detector — monitors Docker containers for crash loops.
 *
 * Periodically checks container restart counts and detects:
 * - Containers that restarted 3+ times in 5 minutes (crash loop)
 * - Containers that transitioned from running to stopped/exited
 *
 * Sends notifications via the broadcast system.
 */

import { broadcastNotification } from "./notifications";

// Track restart counts per container
const restartHistory = new Map<string, { count: number; firstSeen: number }>();
const previousStates = new Map<string, string>();

const CRASH_LOOP_THRESHOLD = 3; // 3 restarts
const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000; // in 5 minutes

export interface ContainerStatus {
  name: string;
  state: string;
  restartCount?: number;
}

/**
 * Evaluate container statuses for crash loops and unexpected stops.
 * Call this periodically (e.g., every 60 seconds).
 */
export async function evaluateContainerHealth(
  containers: ContainerStatus[],
  serverName: string
): Promise<void> {
  const now = Date.now();

  for (const container of containers) {
    const key = `${serverName}:${container.name}`;

    // ── Crash loop detection ──
    if (container.state === "restarting" || (container.restartCount && container.restartCount > 0)) {
      const entry = restartHistory.get(key);

      if (!entry || now - entry.firstSeen > CRASH_LOOP_WINDOW_MS) {
        // Start new tracking window
        restartHistory.set(key, { count: 1, firstSeen: now });
      } else {
        entry.count++;
        if (entry.count >= CRASH_LOOP_THRESHOLD) {
          // Fire crash loop alert
          await broadcastNotification({
            title: `Crash Loop Detected — ${container.name}`,
            message: `Container "${container.name}" on ${serverName} has restarted ${entry.count} times in the last 5 minutes. This may indicate a configuration or application error.`,
            severity: "critical",
            server: serverName,
          });
          // Reset to prevent alert spam
          restartHistory.delete(key);
        }
      }
    }

    // ── Unexpected stop detection ──
    const prevState = previousStates.get(key);
    if (prevState === "running" && (container.state === "exited" || container.state === "dead")) {
      await broadcastNotification({
        title: `Container Stopped — ${container.name}`,
        message: `Container "${container.name}" on ${serverName} has stopped unexpectedly (was running, now ${container.state}).`,
        severity: "warning",
        server: serverName,
      });
    }

    previousStates.set(key, container.state);
  }
}

/**
 * Clear tracking data (useful for tests or when removing a server).
 */
export function resetCrashDetector(): void {
  restartHistory.clear();
  previousStates.clear();
}
