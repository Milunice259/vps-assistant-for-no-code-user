/** Internal DB-only reader. Caller must supply an already-authorized server allowlist. */
import { prisma } from "./db";
import { getMonitoringStatus } from "./monitoring-scheduler";
import { LOCAL_MOBILE_REVISION, mobileRevisionSelect, mobileServerRevision } from "./mobile-snapshot-store";
import { projectMobileObservation, type Reachability } from "./mobile-snapshot-view";

export const MAX_MOBILE_SERVERS = 100;
export async function readMobileSnapshot(allowedIds: readonly string[], now = Date.now()) {
  const ids = [...new Set(allowedIds)];
  if (ids.length > MAX_MOBILE_SERVERS) throw new Error("Mobile server limit exceeded");
  const [remote, observations, status] = await Promise.all([
    prisma.server.findMany({ where:{id:{in:ids.filter(id=>id!=="local")}}, select:{...mobileRevisionSelect,name:true}, orderBy:{name:"asc"} }),
    prisma.mobileServerSnapshot.findMany({ where:{serverId:{in:ids}} }),
    getMonitoringStatus(),
  ]);
  const worker = {enabled:status.enabled,online:status.workerOnline,intervalSeconds:status.intervalSeconds};
  const byId = new Map(observations.map(o=>[o.serverId,o]));
  const fleet = [
    ...(ids.includes("local")?[{id:"local",name:"This Server",active:true,revision:LOCAL_MOBILE_REVISION}]:[]),
    ...remote.map(s=>({id:s.id,name:s.name,active:s.isActive,revision:mobileServerRevision(s)})),
  ];
  if (fleet.some(s=>s.name.length>256)) throw new Error("Mobile server name limit exceeded");
  return {version:1 as const,generatedAt:now,worker,servers:fleet.map(s=>{
    const row = byId.get(s.id);
    const current = row?.revision===s.revision ? row : null;
    const reachability:Reachability = current?.reachability==="online" || current?.reachability==="offline" ? current.reachability : "unknown";
    const projected = projectMobileObservation(s.active,current ? {...current,reachability,observedAt:current.observedAt.getTime()} : null,worker,now);
    const show = projected.state==="online";
    return {id:s.id,name:s.name,...projected,
      stoppedContainers:show?current?.stoppedContainers??null:null,
      failedServices:show?current?.failedServices??null:null,
      expiringCertificates:show?current?.expiringCertificates??null:null,
      backupStale:show?current?.backupStale??null:null};
  })};
}
