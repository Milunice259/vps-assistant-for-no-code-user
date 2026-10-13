import { decodeProfileVars, redactEnvVars, encodeProfileVars, mergeEnvVars } from "@/lib/env-profile";
import { authorizeApp } from "@/lib/app-access";
import { withEnvTarget, listTargetProfiles, updateTargetProfiles, changeProfile } from "@/lib/container-recreate";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{id:string;profileId:string}>};
export async function PUT(request:NextRequest,context:Context) {
  try {
    const {id,profileId}=await context.params;
    const denied=await authorizeApp(id,true); if(denied) return denied;
    const body=await request.json();
    if(body?.safeModeOff!==true) return NextResponse.json({success:false,error:"Safe Mode is on. Turn it off before changing this app."},{status:423});
    if(body.name!==undefined && (typeof body.name!=="string" || !body.name.trim())) return NextResponse.json({success:false,error:"Profile name is required"},{status:400});
    const data=await withEnvTarget(id,async target=>{
      const profiles=await listTargetProfiles(target);
      const existing=profiles.find(p=>p.id===profileId);
      if(!existing) throw Object.assign(new Error("Profile not found"),{statusCode:404});
      const profile={...existing,name:body.name===undefined?existing.name:body.name.trim(),vars:encodeProfileVars(body.vars===undefined?decodeProfileVars(existing.vars):mergeEnvVars(body.vars,decodeProfileVars(existing.vars)))};
      if(profiles.some(p=>p.id!==profileId && p.name===profile.name)) throw Object.assign(new Error("Profile name already exists"),{statusCode:409});
      const result=await updateTargetProfiles(target,profiles.map(p=>p.id===profileId?profile:p));
      return {...profile,newAppId:result?.newAppId,vars:redactEnvVars(decodeProfileVars(profile.vars))};
    });
    return NextResponse.json({success:true,data});
  } catch(error) {return NextResponse.json({success:false,error:"Failed to update profile"},{status:(error as {statusCode?:number}).statusCode || 500});}
}
export async function DELETE(request:NextRequest,context:Context) {
  try {
    const {id,profileId}=await context.params;
    const denied=await authorizeApp(id,true); if(denied) return denied;
    if(request.headers.get("X-Safe-Mode-Off")!=="true") return NextResponse.json({success:false,error:"Safe Mode is on. Turn it off before changing this app."},{status:423});
    return NextResponse.json({success:true,data:await changeProfile(id,profileId,true)});
  } catch(error) {return NextResponse.json({success:false,error:"Failed to delete profile; inspect recovery state before retrying"},{status:(error as {statusCode?:number}).statusCode || 500});}
}
