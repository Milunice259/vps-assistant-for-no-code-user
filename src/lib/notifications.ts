/**
 * Notification System — Sends alerts to Discord, Slack, and Telegram webhooks.
 * Supports threshold-based alerting with cooldown to prevent alert storms.
 */

import { prisma } from "@/lib/db";

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
 * Send a notification to a specific channel.
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

    const res = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    return res.ok;
  } catch (error) {
    console.error("[notify] Failed to send notification:", error);
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
  } catch (error) {
    console.error("[notify] Broadcast failed:", error);
  }
}

/**
 * Check all alert rules against current stats and fire notifications.
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

    const now = new Date();

    for (const rule of rules) {
      const value = stats[rule.metric as keyof typeof stats];
      if (value === undefined) continue;

      const triggered =
        rule.operator === "gt" ? value > rule.threshold : value < rule.threshold;

      if (!triggered) continue;

      // Check cooldown
      if (rule.lastFiredAt) {
        const elapsed = (now.getTime() - rule.lastFiredAt.getTime()) / 60_000;
        if (elapsed < rule.cooldownMin) continue;
      }

      const metricLabel = rule.metric.replace(/_/g, " ").toUpperCase();
      const isCritical = rule.metric === "offline" || value > 95;
      const message = formatAlertMessage(rule.metric, value, rule.threshold, rule.operator);
      const payload: AlertPayload = {
        title: `${metricLabel} Alert — ${serverName}`,
        message,
        severity: isCritical ? "critical" : "warning",
        server: serverName,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
      };

      await sendNotification(rule.channelId, payload);

      // Update cooldown timestamp
      await prisma.alertRule.update({
        where: { id: rule.id },
        data: { lastFiredAt: now },
      });
    }
  } catch (error) {
    console.error("[notify] Alert evaluation failed:", error);
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
      return `${value} tracked domain has an SSL certificate expiring soon (threshold: ${thresholdText}).`;
    case "backup_stale":
      return "No recent database backup was found. Create a fresh backup from the Backup page.";
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
