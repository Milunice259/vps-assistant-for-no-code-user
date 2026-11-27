import { redeemMobilePairing, MobileError } from "@/lib/mobile-devices";
import { mobileBody, mobileFailure, mobileJson, mobileRate } from "@/lib/mobile-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    mobileRate("redeem");
    // Native-only exchange; never use a browser session or browser Origin.
    if(request.headers.has("origin")||request.headers.has("cookie")||request.headers.has("authorization")) throw new MobileError(403,"Native pairing only");
    const body=await mobileBody(request,1024);
    if(Object.keys(body).length!==1||!("code" in body)) throw new MobileError(400,"Invalid pairing request");
    return mobileJson(await redeemMobilePairing(body.code));
  } catch(error) {return mobileFailure(error);}
}
