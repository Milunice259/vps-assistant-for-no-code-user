import { decodeProfileVars, redactEnvVars, encodeProfileVars, mergeEnvVars } from "@/lib/env-profile";
import { authorizeApp } from "@/lib/app-access";
import { envTarget, listTargetProfiles, withEnvTarget, saveProfiles } from "@/lib/container-recreate";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try {
    const {id} = await context.params;
    const denied = await authorizeApp(id,true); if (denied) return denied;
    const target = await envTarget(id);
    try {
      const data = (await listTargetProfiles(target)).map(p=>({...p,vars:redactEnvVars(decodeProfileVars(p.vars))}));
      return NextResponse.json({success:true,data});
    } finally { await target.api.close(); }
  } catch (error) { return NextResponse.json({success:false,error:"Failed to list profiles"},{status:(error as {statusCode?:number}).statusCode || 500}); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const {id} = await context.params;
    const denied = await authorizeApp(id,true); if (denied) return denied;
    const body = await request.json();
    if (body?.safeModeOff !== true) return NextResponse.json({success:false,error:"Safe Mode is on. Turn it off before changing this app."},{status:423});
    if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({success:false,error:"Profile name is required"},{status:400});
    const vars = encodeProfileVars(mergeEnvVars(body.vars ?? {}));
    const data = await withEnvTarget(id,async target=> {
      const profiles = await listTargetProfiles(target);
      if (profiles.some(p=>p.name === body.name.trim())) throw Object.assign(new Error("Profile name already exists"),{statusCode:409});
      const profile = {id:randomUUID(),name:body.name.trim(),vars,isActive:false,createdAt:new Date().toISOString()};
      await saveProfiles(target,[profile,...profiles]);
      return {...profile,vars:redactEnvVars(decodeProfileVars(vars))};
    });
    return NextResponse.json({success:true,data});
  } catch (error) { return NextResponse.json({success:false,error:"Failed to create profile"},{status:(error as {statusCode?:number}).statusCode || 500}); }
}
