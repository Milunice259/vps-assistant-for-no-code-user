import { getSession } from "@/lib/auth";
import { issueMobilePairing, listMobileDevices, revokeMobileDevice, MobileError } from "@/lib/mobile-devices";
import { mobileBody, mobileFailure, mobileJson, mobileRate, requireWebOrigin } from "@/lib/mobile-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
async function webSession(request:Request) {
  mobileRate("manage");
  if(request.headers.has("authorization")) throw new MobileError(401,"Web session required");
  const session=await getSession();
  if(!session) throw new MobileError(401,"Web session required");
  return session;
}
export async function GET(request:Request) {
  try { const s=await webSession(request);return mobileJson(await listMobileDevices(s.sub)); }
  catch(error) {return mobileFailure(error);}
}
export async function POST(request:Request) {
  try {
    requireWebOrigin(request); const s=await webSession(request), body=await mobileBody(request);
    if(Object.keys(body).length!==2||!("label" in body)||!("serverIds" in body)) throw new MobileError(400,"Invalid device request");
    return mobileJson(await issueMobilePairing(s.sub,s.forceLogoutVersion,body.label,body.serverIds),201);
  } catch(error) {return mobileFailure(error);}
}
export async function DELETE(request:Request) {
  try {
    requireWebOrigin(request); const s=await webSession(request),body=await mobileBody(request,1024);
    if(Object.keys(body).length!==1||!("id" in body)) throw new MobileError(400,"Invalid device request");
    await revokeMobileDevice(s.sub,body.id,s.forceLogoutVersion);
    return mobileJson({success:true});
  } catch(error) {return mobileFailure(error);}
}
