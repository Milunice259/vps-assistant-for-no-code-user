import { NextResponse } from "next/server";
import { MobileError } from "./mobile-devices";

export function mobileJson(data:unknown,status=200) {
  return NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}
export function mobileFailure(error:unknown) {
  return error instanceof MobileError ? mobileJson({success:false,error:error.message},error.status)
    : mobileJson({success:false,error:"Mobile service unavailable"},503);
}
// Read actual bytes, not just the attacker-controlled Content-Length.
export async function mobileBody(request:Request,limit=8192):Promise<Record<string,unknown>> {
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json") throw new MobileError(415,"JSON required");
  const length=request.headers.get("content-length");
  if(length!==null && (!/^\d+$/.test(length)||Number(length)>limit)) throw new MobileError(413,"Request too large");
  if(!request.body) throw new MobileError(400,"JSON required");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[]; let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>limit) { void reader.cancel().catch(()=>{}); throw new MobileError(413,"Request too large"); }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {
    const value:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error();
    return value as Record<string,unknown>;
  } catch {throw new MobileError(400,"Invalid JSON");}
}
// A fixed global bucket per process, independent of spoofable forwarding headers.
// Single panel instance; no per-credential unbounded attacker-controlled map.
const limits = new Map<string,{start:number,count:number}>();
export function mobileRate(kind:"redeem"|"snapshot"|"manage") {
  const now=Date.now(), max=kind==="redeem"?30:kind==="snapshot"?600:120;
  let entry=limits.get(kind);
  if(!entry||now-entry.start>=60_000) {entry={start:now,count:0};limits.set(kind,entry);}
  if(++entry.count>max) throw new MobileError(429,"Too many requests");
}
export function requireWebOrigin(request:Request) {
  const origin=request.headers.get("origin"),host=request.headers.get("host");
  try { if(!origin||!host||new URL(origin).host!==host) throw new Error(); }
  catch {throw new MobileError(403,"Origin denied");}
}
