/**
 * Notification System — Sends alerts to Discord, Slack, and Telegram webhooks.
 * Per-target persisted delivery retries, recovery and successful-send cooldown.
 */

import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { getGeneralSettings } from "./general-settings";

export type NotificationType = "discord" | "slack" | "telegram" | "email";

export interface AlertPayload {
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  server?: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

// ── Color maps ──
const SEVERITY_COLORS = {
  info: 0x3b82f6,      // blue
  warning: 0xeab308,   // yellow
  critical: 0xef4444,  // red
};

const SEVERITY_EMOJI = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

/**
 * Send a notification to a specific channel; never log private webhook errors.
 */
export async function sendNotification(
  channelId: string,
  payload: AlertPayload
): Promise<boolean> {
  try {
    const channel = await prisma.notificationChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel || !channel.enabled) return false;

    const type = channel.type as NotificationType;
    const body = formatPayload(type, payload);
    const { applicationName } = await getGeneralSettings();
    // Discord sender names are plain text, unlike HTML/Markdown alert bodies.
    if (type === "discord") (body as Record<string, unknown>).username = applicationName;

    const res = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return false;
    if (type === "telegram") return (await res.json() as { ok?: boolean }).ok === true;
    return true;
  } catch {
    console.error("[notify] delivery_failed");
    return false;
  }
}

/**
 * Send a notification to ALL enabled channels.
 */
export async function broadcastNotification(
  payload: AlertPayload
): Promise<void> {
  try {
    const channels = await prisma.notificationChannel.findMany({
      where: { enabled: true },
    });

    await Promise.allSettled(
      channels.map((ch) => sendNotification(ch.id, payload))
    );
  } catch {
    console.error("[notify] broadcast_failed");
  }
}

/**
 * Check rules against known stats; unknown metrics never imply recovery.
 */
export async function evaluateAlertRules(
  stats: Record<string, number>,
  serverName: string,
  serverId?: string
): Promise<void> {
  try {
    const rules = await prisma.alertRule.findMany({
      where: {
        enabled: true,
        OR: [
          { serverId: serverId ?? null },
          { serverId: null },  // rules that apply to all servers
        ],
      },
      include: { channel: true },
    });

    for (const rule of rules) {
      try {
        const value = stats[rule.metric];
        if (value === undefined || !Number.isFinite(value) || !["gt", "lt"].includes(rule.operator) || !rule.channel.enabled) continue;
        const triggered = rule.operator === "gt" ? value > rule.threshold : value < rule.threshold;
        // Rule/channel/server identity prevents global rules suppressing other servers.
        const key = `monitoring.alert:${JSON.stringify([rule.id, rule.channelId, serverId ?? "local"])}`;
        const initial = JSON.stringify({ active: false, lastSuccess: 0, attempts: 0, retryAt: 0, leaseUntil: 0 });
        await prisma.$executeRawUnsafe("INSERT OR IGNORE INTO app_settings (key,value,updated_at) VALUES (?,?,?)", key, initial, new Date());
        const row = await prisma.appSetting.findUnique({ where: { key } });
        if (!row) continue;
        const state = JSON.parse(row.value) as { active: boolean; lastSuccess: number; attempts: number; retryAt: number; leaseUntil: number; owner?: string; pending?: boolean };
        const now = Date.now();
        if (state.leaseUntil > now) continue;
        // A failed alert is cancelled if it healed before any successful delivery.
        const recovery = !triggered && state.active;
        if (!triggered && !recovery) {
          if (state.pending !== undefined) await prisma.$executeRawUnsafe("UPDATE app_settings SET value=?,updated_at=? WHERE key=? AND value=?", initial, new Date(now), key, row.value);
          continue;
        }
        const sameTransition = state.pending === triggered;
        if (sameTransition && state.retryAt > now) continue;
        if (triggered && state.active && state.pending === undefined && now - state.lastSuccess < rule.cooldownMin * 60_000) continue;
        const owner = randomUUID();
        const claimed = JSON.stringify({ ...state, pending: triggered, owner, leaseUntil: now + 30_000 });
        const changed = await prisma.$executeRawUnsafe("UPDATE app_settings SET value=?,updated_at=? WHERE key=? AND value=?", claimed, new Date(now), key, row.value);
        if (changed !== 1) continue;
        const payload: AlertPayload = {
          title: `${rule.metric.replace(/_/g, " ").toUpperCase()} ${recovery ? "Recovered" : "Alert"} — ${serverName}`,
          message: recovery ? "The monitored condition has returned to its configured normal range." : formatAlertMessage(rule.metric, value, rule.threshold, rule.operator),
          severity: recovery ? "info" : rule.metric === "offline" || value > 95 ? "critical" : "warning",
          server: serverName, metric: rule.metric, value, threshold: rule.threshold,
        };
        const delivered = await sendNotification(rule.channelId, payload);
        const completedAt = Date.now();
        const attempts = sameTransition ? state.attempts + 1 : 1;
        const next = delivered
          ? { active: triggered, lastSuccess: triggered ? completedAt : 0, attempts: 0, retryAt: 0, leaseUntil: 0 }
          : { ...state, pending: triggered, attempts, retryAt: completedAt + Math.min(900_000, 30_000 * 2 ** Math.min(attempts - 1, 5)), leaseUntil: 0 };
        // ponytail: webhook delivery is at-least-once after a process crash; providers lack idempotency.
        // Successful delivery alone advances cooldown; exact claim ownership fences late sends.
        await prisma.$transaction(async tx => {
          const saved = await tx.$executeRawUnsafe("UPDATE app_settings SET value=?,updated_at=? WHERE key=? AND value=?", JSON.stringify(next), new Date(completedAt), key, claimed);
          if (saved === 1 && delivered && triggered) await tx.alertRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date(completedAt) } });
        });
      } catch {
        console.error("[notify] rule_evaluation_failed");
      }
    }
  } catch {
    console.error("[notify] evaluation_failed");
  }
}

/**
 * Format payload for different webhook types.
 */
function formatAlertMessage(metric: string, value: number, threshold: number, operator: string) {
  const thresholdText = `${operator === "gt" ? ">" : "<"} ${threshold}`;
  switch (metric) {
    case "offline":
      return "This server could not be reached during the scheduled health check. Check VPS power/network first, then SSH credentials and firewall rules.";
    case "app_down":
      return `${value} app/container is not running (threshold: ${thresholdText}).`;
    case "service_down":
      return `${value} important system service is not active (threshold: ${thresholdText}).`;
    case "ssl_expiring":
      return `${value} tracked domain has an expired or soon-expiring SSL certificate (threshold: ${thresholdText}).`;
    case "backup_stale":
      return "No recent canonical panel database snapshot was found. Create a fresh backup from the Backup page.";
    default:
      return `${metric.toUpperCase()} is ${value.toFixed(1)}% (threshold: ${thresholdText}%)`;
  }
}

function formatValue(metric: string | undefined, value: number) {
  if (!metric || ["cpu", "memory", "disk"].includes(metric)) return `${value.toFixed(1)}%`;
  return String(value);
}

function formatPayload(type: NotificationType, payload: AlertPayload): unknown {
  const emoji = SEVERITY_EMOJI[payload.severity];

  switch (type) {
    case "discord":
      return {
        embeds: [
          {
            title: `${emoji} ${payload.title}`,
            description: payload.message,
            color: SEVERITY_COLORS[payload.severity],
            fields: [
              ...(payload.server ? [{ name: "Server", value: payload.server, inline: true }] : []),
              ...(payload.metric ? [{ name: "Metric", value: payload.metric.toUpperCase(), inline: true }] : []),
              ...(payload.value !== undefined ? [{ name: "Value", value: formatValue(payload.metric, payload.value), inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };

    case "slack":
      return {
        text: `${emoji} *${payload.title}*\n${payload.message}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${emoji} *${payload.title}*\n${payload.message}`,
            },
          },
          ...(payload.server
            ? [
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `*Server:* ${payload.server}` },
                    ...(payload.metric ? [{ type: "mrkdwn", text: `*Metric:* ${payload.metric.toUpperCase()} = ${payload.value === undefined ? "n/a" : formatValue(payload.metric, payload.value)}` }] : []),
                  ],
                },
              ]
            : []),
        ],
      };

    case "telegram":
      // Telegram Bot API — send to chat via webhook/bot
      return {
        text: `${emoji} <b>${payload.title}</b>\n\n${payload.message}${payload.server ? `\n\n📍 Server: ${payload.server}` : ""}`,
        parse_mode: "HTML",
        disable_notification: payload.severity === "info",
      };

    default:
      return { text: `${emoji} ${payload.title}: ${payload.message}` };
  }
}
