import { runNotificationChecks } from "@/lib/notification-checks";

const KEY = "__vpsNotificationScheduler";
const intervalMin = Math.max(5, Number(process.env.NOTIFICATION_CHECK_INTERVAL_MIN || 15));

const store = globalThis as typeof globalThis & Record<string, NodeJS.Timeout | undefined>;

if (process.env.NEXT_PHASE !== "phase-production-build" && process.env.DISABLE_NOTIFICATION_SCHEDULER !== "true" && !store[KEY]) {
  // ponytail: Docker/Next single-process scheduler; upgrade to external cron when running multi-replica.
  store[KEY] = setInterval(() => {
    runNotificationChecks().catch((error) => console.error("[notify] Scheduled check failed:", error));
  }, intervalMin * 60_000);
  store[KEY]?.unref?.();
}
