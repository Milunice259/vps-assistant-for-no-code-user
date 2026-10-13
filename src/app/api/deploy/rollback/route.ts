import { NextRequest, NextResponse } from "next/server";
import { POST as lifecycle } from "../[id]/route";
export async function POST(request: NextRequest) {
  let body;
  try { body=await request.json(); } catch { return NextResponse.json({success:false,error:"Invalid JSON"},{status:400}); }
  if (!body || typeof body!=="object" || Array.isArray(body) || typeof body.deploymentId!=="string") return NextResponse.json({success:false,error:"deploymentId is required"},{status:400});
  const forwarded=new NextRequest(request.url,{method:"POST",headers:request.headers,body:JSON.stringify({...body,action:"rollback"})});
  return lifecycle(forwarded,{params:Promise.resolve({id:body.deploymentId})});
}
