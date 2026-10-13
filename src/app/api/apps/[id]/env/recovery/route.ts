import { NextRequest, NextResponse } from "next/server";
import { authorizeApp } from "@/lib/app-access";
import { recoveryPreview, reconcileRecovery, importBaseline } from "@/lib/container-recreate";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const denied = await authorizeApp(id, true);
  if (denied) return denied;
  try { return NextResponse.json({success:true,data:await recoveryPreview(id)}); }
  catch { return NextResponse.json({success:false,error:"Recovery inspection unavailable; no changes made"},{status:409}); }
}
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const denied = await authorizeApp(id, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (body.action !== "baseline-preview" && body.safeModeOff !== true) return NextResponse.json({success:false,error:"Turn Safe Mode off before reconciling saved state"},{status:423});
    let data;
    if (body.action === "baseline-preview") data = await importBaseline(id,body.env);
    else if (body.action === "baseline-import") {
      if (typeof body.token !== "string") return NextResponse.json({success:false,error:"Preview required"},{status:400});
      data = await importBaseline(id,body.env,body.token,body.confirmation);
    } else if (body.action === "reconcile") data = await reconcileRecovery(id,body.token,body.confirmation);
    else return NextResponse.json({success:false,error:"Invalid recovery action"},{status:400});
    return NextResponse.json({success:true,data});
  } catch (error) { return NextResponse.json({success:false,error:"Recovery could not be confirmed; inspect the original target again"},{status:(error as {statusCode?:number}).statusCode || 409}); }
}
