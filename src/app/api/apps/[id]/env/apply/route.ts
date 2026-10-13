import { authorizeApp } from "@/lib/app-access";
import { changeProfile } from "@/lib/container-recreate";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const denied = await authorizeApp(id, true);
    if (denied) return denied;
    const body = await request.json();
    if (body?.safeModeOff !== true) return NextResponse.json({success:false,error:"Safe Mode is on. Turn it off before changing this app."},{status:423});
    if (body.profileId !== null && (typeof body.profileId !== "string" || !body.profileId)) return NextResponse.json({success:false,error:"profileId must be a string or null"},{status:400});
    return NextResponse.json({success:true,data:await changeProfile(id,body.profileId)});
  } catch (error) {
    const status = (error as {statusCode?:number}).statusCode || 500;
    return NextResponse.json({success:false,error:status === 500 ? "Failed to apply profile" : (error as Error).message},{status});
  }
}
