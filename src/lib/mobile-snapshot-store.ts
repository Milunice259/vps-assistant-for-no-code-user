import { createHash } from "node:crypto";
import { prisma } from "./db";
import { emptyResources, observedCount, type ResourceObservation } from "./mobile-observation";
import { percent, type Reachability } from "./mobile-snapshot-view";

export const mobileRevisionSelect = {
  id:true, host:true, port:true, username:true, authMethod:true, encryptedKey:true,
  encryptedPass:true, isActive:true, createdAt:true,
} as const;
type RevisionFields = {id:string;host:string;port:number;username:string;authMethod:string;
  encryptedKey:string|null;encryptedPass:string|null;isActive:boolean;createdAt:Date};
export function mobileServerRevision(server: RevisionFields): string {
  // updatedAt is unsuitable: connectToServer updates lastConnected each time.
  return createHash("sha256").update(JSON.stringify([server.id,server.host,server.port,server.username,
    server.authMethod,server.encryptedKey,server.encryptedPass,server.isActive,server.createdAt.toISOString()])).digest("hex");
}
export const LOCAL_MOBILE_REVISION = "local-v1";
export type MobileSample = ResourceObservation & {
  reachability:Reachability; observedAt:Date;
  stoppedContainers?:number; failedServices?:number; expiringCertificates?:number; backupStale?:number;
};
/** Scheduler only. Transaction rechecks configuration; a stale writer cannot replace newer data. */
export async function publishMobileSnapshot(serverId:string, revision:string, sample:MobileSample) {
  if (!Number.isFinite(sample.observedAt.getTime()) || sample.observedAt.getTime() > Date.now()) return;
  await prisma.$transaction(async tx => {
    if (serverId !== "local") {
      const current = await tx.server.findUnique({where:{id:serverId},select:mobileRevisionSelect});
      if (!current?.isActive || mobileServerRevision(current)!==revision) return;
    } else if (revision!==LOCAL_MOBILE_REVISION) return;
    const existing = await tx.mobileServerSnapshot.findUnique({where:{serverId},select:{observedAt:true}});
    if (existing && existing.observedAt >= sample.observedAt) return;
    const online = sample.reachability==="online";
    const metrics = online ? sample : emptyResources();
    const data = { revision, observedAt:sample.observedAt, reachability:sample.reachability,
      cpuPercent:percent(metrics.cpuPercent), memoryPercent:percent(metrics.memoryPercent), diskPercent:percent(metrics.diskPercent),
      stoppedContainers:online?observedCount(sample.stoppedContainers):null,
      failedServices:online?observedCount(sample.failedServices):null,
      expiringCertificates:online?observedCount(sample.expiringCertificates):null,
      backupStale:online && (sample.backupStale===0 || sample.backupStale===1)?sample.backupStale===1:null };
    await tx.mobileServerSnapshot.upsert({where:{serverId},create:{serverId,...data},update:data});
  });
}
/** Bounded lifecycle: prune deleted or administratively disabled servers. */
export async function pruneMobileSnapshots() {
  await prisma.$transaction(async tx => {
    const rows=await tx.server.findMany({where:{isActive:true},select:{id:true}});
    await tx.mobileServerSnapshot.deleteMany({where:{serverId:{notIn:["local",...rows.map(row=>row.id)]}}});
  });
}
