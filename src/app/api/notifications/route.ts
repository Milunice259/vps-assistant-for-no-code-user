/**
 * API: /api/notifications
 * CRUD for notification channels + alert rules.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendNotification } from "@/lib/notifications";
import { safeErrorMessage } from "@/lib/safe-error";

export const dynamic = "force-dynamic";

// ── GET — List all channels + their alert rules ──
export async function GET() {
  try {
    const channels = await prisma.notificationChannel.findMany({
      include: { alertRules: true },
      orderBy: { createdAt: "desc" },
    });

    const safeChannels = channels.map((channel) => ({
      ...channel,
      webhookUrl: "[hidden]",
    }));

    return NextResponse.json({ success: true, data: safeChannels });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to fetch channels");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST — Create a channel or alert rule ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type: actionType } = body as { type: string };

    if (actionType === "channel") {
      const { name, channelType, webhookUrl } = body as {
        name: string;
        channelType: string;
        webhookUrl: string;
      };

      if (!name || !channelType || !webhookUrl) {
        return NextResponse.json(
          { success: false, error: "name, channelType, and webhookUrl are required" },
          { status: 400 }
        );
      }

      const channel = await prisma.notificationChannel.create({
        data: { name, type: channelType, webhookUrl },
      });

      return NextResponse.json({ success: true, data: { ...channel, webhookUrl: "[hidden]" } });
    }

    if (actionType === "alert") {
      const { metric, operator, threshold, channelId, serverId, cooldownMin } = body as {
        metric: string;
        operator?: string;
        threshold: number;
        channelId: string;
        serverId?: string;
        cooldownMin?: number;
      };

      if (!metric || threshold === undefined || !channelId) {
        return NextResponse.json(
          { success: false, error: "metric, threshold, and channelId are required" },
          { status: 400 }
        );
      }

      const rule = await prisma.alertRule.create({
        data: {
          metric,
          operator: operator ?? "gt",
          threshold,
          channelId,
          serverId: serverId ?? null,
          cooldownMin: cooldownMin ?? 15,
        },
      });

      return NextResponse.json({ success: true, data: rule });
    }

    if (actionType === "test") {
      const { channelId } = body as { channelId: string };
      if (!channelId) {
        return NextResponse.json(
          { success: false, error: "channelId is required" },
          { status: 400 }
        );
      }

      const success = await sendNotification(channelId, {
        title: "Test Notification",
        message: "If you see this, your notification channel is working! 🎉",
        severity: "info",
      });

      return NextResponse.json({ success, data: { delivered: success } });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action type" },
      { status: 400 }
    );
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to create");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── DELETE — Remove a channel or alert rule ──
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const itemType = searchParams.get("type") || "channel";

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      );
    }

    if (itemType === "alert") {
      await prisma.alertRule.delete({ where: { id } });
    } else {
      await prisma.notificationChannel.delete({ where: { id } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = safeErrorMessage(error, "Failed to delete");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
