import { NextRequest, NextResponse } from "next/server";
import { authorizeApp } from "@/lib/app-access";
import { getSession } from "@/lib/auth";
import { auditLog, getClientIp } from "@/lib/audit";
import { configurationView, previewConfiguration, applyConfiguration } from "@/lib/app-configuration";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  const status = (error as { statusCode?: number })?.statusCode || 500;
  return NextResponse.json({ success: false, error: status === 500 ? "Configuration inspection or operation failed; inspect the target before retrying" : (error as Error).message }, { status });
}
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id);
    if (denied) return denied;
    return NextResponse.json({ success: true, data: await configurationView(id) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  let id = "";
  let applying = false;
  let actor: string | undefined;
  try {
    id = (await context.params).id;
    const denied = await authorizeApp(id, true);
    if (denied) return denied;
    actor = (await getSession())?.sub;
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }
    if (body?.mode === "preview") return NextResponse.json({ success: true, data: await previewConfiguration(id, body.revision, body.action, body.settings) });
    if (body?.mode !== "apply") return NextResponse.json({ success: false, error: "Invalid operation mode" }, { status: 400 });
    if (body.safeModeOff !== true) return NextResponse.json({ success: false, error: "Turn Safe Mode off before applying configuration" }, { status: 423 });
    applying = true;
    const data = await applyConfiguration(id, body.token, body.confirmation);
    await auditLog({ action: "app_configuration_updated", userId: actor, target: id, ip: getClientIp(request), details: JSON.stringify({ operation: "app_configuration", outcome: "verified", containerId: data.newContainerId, settings: "settings" in data ? data.settings : undefined }) });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (applying) await auditLog({ action: "app_configuration_updated", userId: actor, target: id, ip: getClientIp(request), details: JSON.stringify({ operation: "app_configuration", outcome: "failed_or_uncertain" }) });
    return failure(error);
  }
}
