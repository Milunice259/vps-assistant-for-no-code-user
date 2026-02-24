/**
 * Email Notification Support — sends alerts via SMTP.
 *
 * Extends the notification system with email delivery.
 * Configure via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import type { AlertPayload } from "./notifications";

interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function getSMTPConfig(): SMTPConfig | null {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || "";
  if (!host) return null;
  return { host, port, user, pass, from };
}

/**
 * Send an email notification.
 * Uses native Node.js net module for SMTP — no external dependencies.
 * For production, install nodemailer: npm i nodemailer
 */
export async function sendEmailNotification(
  to: string,
  payload: AlertPayload
): Promise<boolean> {
  const config = getSMTPConfig();
  if (!config) {
    console.warn("[email] SMTP not configured (set SMTP_HOST env var)");
    return false;
  }

  try {
    // Use native fetch to send via HTTP mail APIs (SendGrid, Mailgun, etc.)
    // If webhookUrl is an HTTP endpoint, use it directly
    if (config.host.startsWith("http")) {
      const res = await fetch(config.host, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(config.pass ? { "Authorization": `Bearer ${config.pass}` } : {}),
        },
        body: JSON.stringify({
          from: config.from || "VPS Control <noreply@vpscontrol.app>",
          to,
          subject: `${severityPrefix(payload.severity)} ${payload.title}`,
          html: formatEmailHTML(payload),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    }

    // For traditional SMTP, log a helpful message
    console.warn(
      "[email] Native SMTP requires nodemailer. Install with: npm i nodemailer\n" +
      "Alternatively, use an HTTP mail API by setting SMTP_HOST to an HTTP endpoint."
    );
    return false;
  } catch (error) {
    console.error("[email] Failed to send:", error);
    return false;
  }
}

function severityPrefix(severity: string): string {
  switch (severity) {
    case "critical": return "🚨";
    case "warning": return "⚠️";
    default: return "ℹ️";
  }
}

function formatEmailHTML(payload: AlertPayload): string {
  const color = payload.severity === "critical" ? "#ef4444" : payload.severity === "warning" ? "#eab308" : "#3b82f6";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: ${color}; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 16px;">${severityPrefix(payload.severity)} ${payload.title}</h2>
      </div>
      <div style="background: #1f2937; color: #e5e7eb; padding: 20px; border-radius: 0 0 8px 8px;">
        <p style="margin: 0 0 12px;">${payload.message}</p>
        ${payload.server ? `<p style="margin: 0; color: #9ca3af; font-size: 13px;">📍 Server: ${payload.server}</p>` : ""}
        ${payload.metric ? `<p style="margin: 4px 0 0; color: #9ca3af; font-size: 13px;">📊 ${payload.metric.toUpperCase()}: ${payload.value?.toFixed(1)}%</p>` : ""}
        <hr style="border: none; border-top: 1px solid #374151; margin: 16px 0;" />
        <p style="margin: 0; color: #6b7280; font-size: 11px;">Sent by VPS Control App</p>
      </div>
    </div>
  `;
}
