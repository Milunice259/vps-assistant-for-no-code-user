import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { MAX_MOBILE_SERVERS } from "./mobile-snapshot-read";
type Tx = Prisma.TransactionClient;
export const DEVICE_LIMIT = 10;
const CODE_TTL = 5 * 60_000;
const TOKEN_TTL = 90 * 86_400_000;
const digest = (s:string) => createHash("sha256").update(s).digest("hex");
const codePattern = /^mp1_[A-Za-z0-9_-]{32}$/;
const tokenPattern = /^mv1_[A-Za-z0-9_-]{43}$/;
export class MobileError extends Error {
  constructor(public status:number, message:string) {super(message);}
}
const denied = () => new MobileError(401,"Invalid or expired device credential");
async function securityVersion(tx:Tx) {
  const row=await tx.appSetting.findUnique({where:{key:"security"}});
  if (!row) return 0;
  const value:unknown=JSON.parse(row.value);
  if (!value || typeof value!=="object" || Array.isArray(value)) throw denied();
  const version=(value as Record<string,unknown>).forceLogoutVersion??0;
  if (typeof version!=="number" || !Number.isSafeInteger(version) || version<0) throw denied();
  return version;
}
async function account(tx:Tx,id:string) {
  const user=await tx.user.findUnique({where:{id},select:{id:true,username:true,role:true,isActive:true,passwordHash:true,serverAccessMode:true,serverAccess:{select:{serverId:true}}}});
  if (!user?.isActive) throw denied();
  return user;
}
type Account=Awaited<ReturnType<typeof account>>;
function permitted(user:Account,id:string) {
  return user.role==="OWNER" || user.role==="ADMIN" || user.serverAccessMode==="ALL" || user.serverAccess.some(s=>s.serverId===id);
}
function validateIds(value:unknown): string[] {
  if (!Array.isArray(value)||!value.length||value.length>MAX_MOBILE_SERVERS||!value.every(id=>typeof id==="string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new MobileError(400,"Invalid server selection");
  return [...new Set(value as string[])];
}
async function scope(tx:Tx,user:Account,ids:string[]) {
  const allowed=ids.filter(id=>permitted(user,id));
  const rows=await tx.server.findMany({where:{id:{in:allowed.filter(id=>id!=="local")}},select:{id:true}});
  return [...(allowed.includes("local")?["local"]:[]),...rows.map(r=>r.id)];
}
const publicDeviceSelect={id:true,label:true,serverIds:true,createdAt:true,pairedAt:true,pairingExpiresAt:true,tokenExpiresAt:true,lastAccessAt:true,revokedAt:true} as const;
export async function listMobileDevices(userId:string) {
  return prisma.$transaction(async tx=>{
    const user=await account(tx,userId);
    const rows=await tx.mobileDevice.findMany({where:{userId},select:publicDeviceSelect,orderBy:{createdAt:"desc"},take:DEVICE_LIMIT});
    const available=await tx.server.findMany({where: user.role==="OWNER"||user.role==="ADMIN"||user.serverAccessMode==="ALL"?{}:{id:{in:user.serverAccess.map(s=>s.serverId)}},select:{id:true,name:true},orderBy:{name:"asc"},take:MAX_MOBILE_SERVERS+1});
    const servers=[...(permitted(user,"local")?[{id:"local",name:"This Server"}]:[]),...available];
    if (servers.length>MAX_MOBILE_SERVERS) throw new MobileError(409,"Mobile server limit exceeded");
    return {devices:rows.map(r=>({...r,serverIds:JSON.parse(r.serverIds) as string[]})),servers};
  });
}
export async function issueMobilePairing(userId:string,sessionVersion:number,label:unknown,selection:unknown) {
  if(typeof label!=="string"||!label.trim()||label.trim().length>60||/[\x00-\x1f\x7f]/.test(label)) throw new MobileError(400,"Invalid device name");
  const ids=validateIds(selection);
  const code="mp1_"+randomBytes(24).toString("base64url");
  return prisma.$transaction(async tx=>{
    const now=new Date(), user=await account(tx,userId), version=await securityVersion(tx);
    if(version!==sessionVersion) throw denied();
    const allowed=await scope(tx,user,ids);
    if(allowed.length!==ids.length) throw new MobileError(403,"Server selection denied");
    // Bound storage per owner, retaining current credentials; audit rows retain event history.
    await tx.mobileDevice.deleteMany({where:{userId,OR:[{revokedAt:{not:null}},{pairedAt:null,pairingExpiresAt:{lte:now}},{tokenExpiresAt:{lte:now}}]}});
    if(await tx.mobileDevice.count({where:{userId}})>=DEVICE_LIMIT) throw new MobileError(409,"Device limit reached");
    const expiresAt=new Date(now.getTime()+CODE_TTL);
    const row=await tx.mobileDevice.create({data:{userId,label:label.trim(),serverIds:JSON.stringify(allowed),pairingHash:digest(code),pairingExpiresAt:expiresAt,forceLogoutVersion:version,passwordRevision:digest(user.passwordHash)},select:{id:true}});
    await tx.auditLog.create({data:{action:"mobile_pairing_issued",userId,username:user.username,target:row.id}});
    return {id:row.id,code,expiresAt};
  });
}
export async function redeemMobilePairing(code:unknown) {
  if(typeof code!=="string"||!codePattern.test(code)) throw denied();
  const hash=digest(code),token="mv1_"+randomBytes(32).toString("base64url");
  return prisma.$transaction(async tx=>{
    const now=new Date();
    const row=await tx.mobileDevice.findUnique({where:{pairingHash:hash}});
    if(!row||row.revokedAt||row.pairedAt||row.pairingExpiresAt<=now) throw denied();
    const user=await account(tx,row.userId);
    if(row.forceLogoutVersion!==await securityVersion(tx)||row.passwordRevision!==digest(user.passwordHash)) throw denied();
    const ids=validateIds(JSON.parse(row.serverIds));
    if((await scope(tx,user,ids)).length!==ids.length) throw denied();
    const expiresAt=new Date(now.getTime()+TOKEN_TTL);
    const result=await tx.mobileDevice.updateMany({where:{id:row.id,pairingHash:hash,pairedAt:null,revokedAt:null,pairingExpiresAt:{gt:now}},data:{pairingHash:null,pairedAt:now,tokenHash:digest(token),tokenExpiresAt:expiresAt}});
    if(result.count!==1) throw denied();
    await tx.auditLog.create({data:{action:"mobile_device_paired",userId:user.id,username:user.username,target:row.id}});
    return {deviceId:row.id,token,expiresAt};
  });
}
export async function authorizeMobileBearer(header:string|null) {
  const token=header?.startsWith("Bearer ")?header.slice(7):"";
  if(!tokenPattern.test(token)) throw denied();
  return prisma.$transaction(async tx=>{
    const now=new Date();
    const row=await tx.mobileDevice.findUnique({where:{tokenHash:digest(token)}});
    if(!row||!row.pairedAt||row.revokedAt||!row.tokenExpiresAt||row.tokenExpiresAt<=now) throw denied();
    const user=await account(tx,row.userId);
    if(row.forceLogoutVersion!==await securityVersion(tx)||row.passwordRevision!==digest(user.passwordHash)) throw denied();
    const ids=await scope(tx,user,validateIds(JSON.parse(row.serverIds)));
    if(!ids.length) throw denied();
    if(!row.lastAccessAt||now.getTime()-row.lastAccessAt.getTime()>=15*60_000)
      await tx.mobileDevice.updateMany({where:{id:row.id,revokedAt:null},data:{lastAccessAt:now}});
    return {deviceId:row.id,serverIds:ids};
  });
}
export async function revokeMobileDevice(userId:string,id:unknown,sessionVersion:number) {
  if(typeof id!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new MobileError(400,"Invalid device");
  return prisma.$transaction(async tx=>{
    const user=await account(tx,userId);
    if(sessionVersion!==await securityVersion(tx)) throw denied();
    const result=await tx.mobileDevice.updateMany({where:{id,userId,revokedAt:null},data:{revokedAt:new Date(),pairingHash:null,tokenHash:null}});
    if(result.count!==1) throw new MobileError(404,"Device not found");
    await tx.auditLog.create({data:{action:"mobile_device_revoked",userId,username:user.username,target:id}});
  });
}
