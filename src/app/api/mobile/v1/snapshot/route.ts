import { authorizeMobileBearer, MobileError } from "@/lib/mobile-devices";
import { readMobileSnapshot } from "@/lib/mobile-snapshot-read";
import { mobileFailure, mobileJson, mobileRate } from "@/lib/mobile-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request) {
  try {
    mobileRate("snapshot");
    if(request.headers.has("cookie")||request.headers.has("origin")) throw new MobileError(403,"Native credentials only");
    const bearer=request.headers.get("authorization");
    const first=await authorizeMobileBearer(bearer);
    const data=await readMobileSnapshot(first.serverIds);
    // Recheck permission changes/revocation during the read before returning.
    const last=await authorizeMobileBearer(bearer);
    if(first.deviceId!==last.deviceId||first.serverIds.length!==last.serverIds.length||first.serverIds.some(id=>!last.serverIds.includes(id))) throw new MobileError(401,"Device authorization changed");
    return mobileJson(data);
  } catch(error) {return mobileFailure(error);}
}
