import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAccessServer } from "@/lib/server-access";
import { ADVANCED_COOKIE, verifyAdvancedToken } from "@/lib/operation-safety";
import { prisma } from "@/lib/db";
import { deploymentView, imageLifecycle } from "@/lib/deployment-lifecycle";
import { auditLog, getClientIp } from "@/lib/audit";
import { composeOperationPreview, composeRollbackPreview, rollbackCompose } from "@/lib/compose-deployment";
import { engine } from "@/lib/container-recreate";
import { execOnHost, isLocalServer } from "@/lib/local-server";
import { connectToServer } from "@/lib/server-ssh";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { deploymentFail, readDeploymentDefinition } from "@/lib/deployment-state";
import { readGitSource, gitRollbackPreview, rollbackGitCompose } from "@/lib/git-deployment";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{id:string}>};
async function authorize(request: NextRequest, id: string, write: boolean, body?: Record<string,unknown>) {
  const session = await getSession();
  if (!session) return NextResponse.json({success:false,error:"Unauthorized"},{status:401});
  if (!can(session.role as string,write ? "ADMIN" : "VIEWER")) return NextResponse.json({success:false,error:"Insufficient permissions"},{status:403});
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return NextResponse.json({success:false,error:"Invalid deployment ID"},{status:400});
  // Only target projection is read before target authorization; never definitions/logs/server secrets.
  const record = await prisma.deploymentLog.findUnique({where:{id},select:{serverId:true}});
  if (!record) return NextResponse.json({success:false,error:"Deployment not found"},{status:404});
  if (!await canAccessServer(session.sub as string,session.role as string,record.serverId || "local")) return NextResponse.json({success:false,error:"Server access denied"},{status:403});
  if (write && body?.mode !== "preview" && (body?.safeModeOff !== true || !await verifyAdvancedToken(request.cookies.get(ADVANCED_COOKIE)?.value,session))) return NextResponse.json({success:false,error:"Signed Advanced access and literal Safe Mode acknowledgment are required"},{status:423});
  return session;
}
function failure(error: unknown) { const e=error as {deploymentError?:boolean;statusCode?:number;message?:string}; return NextResponse.json({success:false,error:e.deploymentError ? e.message : "Deployment operation failed or is uncertain; inspect target and history before retrying"},{status:e.statusCode || 500}); }
export async function GET(request: NextRequest, context: Context) {
  try { const {id}=await context.params; const access=await authorize(request,id,false); if (access instanceof NextResponse) return access; return NextResponse.json({success:true,data:await deploymentView(id)}); } catch(error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  let applying=false, id="", actor:string|undefined;
  try {
    id=(await context.params).id;
    let body; try {body=await request.json();} catch {return NextResponse.json({success:false,error:"Invalid JSON"},{status:400});}
    if (!body || typeof body!=="object" || Array.isArray(body)) return NextResponse.json({success:false,error:"Body must be an object"},{status:400});
    const access=await authorize(request,id,true,body); if (access instanceof NextResponse) return access;
    actor=access.sub; applying=body.mode==="apply";
    const record=await prisma.deploymentLog.findUnique({where:{id},select:{serverId:true}});
    if (!record) return NextResponse.json({success:false,error:"Deployment not found"},{status:404});
    // Reauthorize the projection used for dispatch if the target changed since the first read.
    if (!await canAccessServer(access.sub as string,access.role as string,record.serverId || "local")) return NextResponse.json({success:false,error:"Server access denied"},{status:403});
    const serverId=record.serverId || "local";
    const saved=await readDeploymentDefinition(id);
    if (!saved || saved.state.serverId !== serverId) deploymentFail("Authenticated deployment definition is unavailable or target changed",422);
    const kind=saved.state.definition.kind;
    const git=kind === "git" || kind === "compose" && !!await readGitSource(id,serverId);
    const data=kind === "image" ? await imageLifecycle(id,body) : await composeLifecycle(id,serverId,body,git);
    if(applying) await auditLog({action:"deploy_docker",userId:actor,target:id,ip:getClientIp(request),details:JSON.stringify({action:body.action,outcome:"native_configuration_verified",containerId:"newContainerId" in data?data.newContainerId:undefined,dataRestored:false,schemaRestored:false})});
    return NextResponse.json({success:true,data});
  } catch(error) { if(applying) await auditLog({action:"deploy_docker",userId:actor,target:id,ip:getClientIp(request),details:JSON.stringify({outcome:"failed_or_uncertain"})}); return failure(error); }
}

async function composeLifecycle(id:string,serverId:string,body:Record<string,unknown>,git:boolean) {
  if (body.action === "recovery" && body.mode !== "preview") deploymentFail("Compose recovery is read-only; automatic reconciliation is unavailable",400);
  if (!["preview","apply"].includes(String(body.mode)) || !["rollback","recovery"].includes(String(body.action))) deploymentFail("Compose lifecycle supports rollback or read-only recovery; use reviewed Compose deployment for updates",400);
  if (body.mode === "apply" && (body.writableLayerLoss !== true || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision) || typeof body.confirmation !== "string" || !["unchanged","operator-confirmed"].includes(String(body.dataCompatibility)) || !["unchanged","operator-confirmed"].includes(String(body.schemaCompatibility)))) deploymentFail("Rollback requires exact preview and data/schema compatibility acknowledgments",400);
  let ssh:Awaited<ReturnType<typeof connectToServer>>["ssh"] | null=null;
  try {
    const connection=isLocalServer(serverId) ? null : await connectToServer(serverId);
    ssh=connection?.ssh || null;
    const run=async (command:string,timeout?:number)=>connection ? executeCommand(connection.ssh,command,timeout) : execOnHost(command,timeout);
    if (body.action === "recovery") return {...await composeOperationPreview(run,id,serverId),action:"recovery",dataRestored:false,schemaRestored:false};
    const preview=await (git ? gitRollbackPreview : composeRollbackPreview)(run,id,serverId);
    if (body.mode === "preview") return {...preview,action:"rollback",compatibilityRequired:true,writableLayerLossRequired:true,dataRestored:false,schemaRestored:false};
    if (body.revision !== preview.revision || body.confirmation !== preview.confirmation) deploymentFail("Rollback preview changed or exact confirmation is missing");
    const server=isLocalServer(serverId) ? null : await prisma.server.findUnique({where:{id:serverId}});
    if (!isLocalServer(serverId) && !server) deploymentFail("Server unavailable",404);
    const api=await engine(server);
    try {
      const result=await (git ? rollbackGitCompose : rollbackCompose)(run,api,id,serverId,body as {revision:string;confirmation:string;dataCompatibility:string;schemaCompatibility:string;writableLayerLoss:boolean});
      await prisma.deploymentLog.update({where:{id},data:{status:"UNVERIFIED",logs:"Compose rollback native configuration verified. Database, schema and external data were not restored. Application readiness is unverified."}});
      return {...result,readiness:"unverified",dataRestored:false,schemaRestored:false};
    } finally {await api.close();}
  } finally {await closeSSH(ssh);}
}
