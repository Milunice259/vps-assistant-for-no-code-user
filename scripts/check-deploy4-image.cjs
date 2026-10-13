const assert=require('node:assert/strict');
const {load,fixture,mockCrypto}=require('./safe-env-recreate-regression.cjs');
const env=load('src/lib/env-profile.ts',{'@/lib/crypto':mockCrypto});
const helper=load('src/lib/container-recreate.ts',{'@/lib/db':{prisma:{}},'@/lib/crypto':mockCrypto,'@/lib/env-profile':env,'@/lib/local-server':{},'@/lib/ssh':{}});
const state=load('src/lib/deployment-state.ts',{'@/lib/db':{prisma:{}},'@/lib/crypto':mockCrypto,'@/lib/container-recreate':helper});
const validation=load('src/lib/validation.ts');
const preflight=load('src/lib/deploy-preflight.ts',{'./compose-deployment':{},'./general-settings':{},'@/lib/validation':validation});
const image=load('src/lib/image-deployment.ts',{'@/lib/container-recreate':helper,'@/lib/db':{},'@/lib/app-routing':{validateDomain:()=>{},validateRouting:()=>{}},'@/lib/deployment-state':state,'@/lib/deploy-preflight':preflight,'@/lib/local-server':{}});
for(const ref of ['nginx:latest','localhost:5000/team/app:v1','registry.example.org/a/b@sha256:'+'a'.repeat(64)]) assert(image.validImageReference(ref));
for(const ref of ['x;touch /owned','registry:99999/a','x@sha256:abc','UPPER/x','x\n']) assert(!image.validImageReference(ref));
for(const extra of [{mounts:[{type:'bind',source:'/var/run/docker.sock',target:'/socket',consent:true}]},{mounts:[{type:'bind',source:'/etc',target:'/data',consent:true}]},{mounts:[{type:'volume',source:'data',target:'/data',consent:false}]},{networks:['host']},{healthcheck:{test:['CMD-SHELL','true'],intervalSeconds:-1}}]) assert.throws(()=>image.validateImageInput({type:'image',image:'node:20-alpine',...extra}));
const snap=state.snapshot(fixture);const dto=state.deploymentDTO({version:1,deploymentId:'fixture',serverId:'local',definition:{kind:'image',env:{SECRET:'private'}},runtime:{containerIds:[fixture.Id]},original:snap,current:snap});assert(!JSON.stringify(dto).includes('private'));assert(!JSON.stringify(dto).includes('TOKEN='));
let role='VIEWER',scope=true,advanced=false;const calls=[];
class Response{static json(body,{status=200}={}){return new Response(body,status);}constructor(body,status){this.body=body;this.status=status;}}
const prisma={deploymentLog:{findUnique:async q=>{calls.push('target-projection');assert(Object.keys(q.select).every(k=>['serverId','detectedStack'].includes(k)));return {serverId:null};}}};
const route=load('src/app/api/deploy/[id]/route.ts',{'next/server':{NextResponse:Response},'@/lib/auth':{getSession:async()=>({sub:'actor',role})},'@/lib/permissions':{can:(r,required)=>required==='VIEWER'||r==='OWNER'||r==='ADMIN'},'@/lib/server-access':{canAccessServer:async()=>scope},'@/lib/operation-safety':{ADVANCED_COOKIE:'advanced',verifyAdvancedToken:async()=>advanced},'@/lib/db':{prisma},'@/lib/deployment-lifecycle':{deploymentView:async()=>{calls.push('sensitive-view');return{};},imageLifecycle:async()=>{calls.push('service');return{};}},'@/lib/audit':{auditLog:async()=>{},getClientIp:()=>''},'@/lib/compose-deployment':{},'@/lib/container-recreate':{},'@/lib/local-server':{},'@/lib/server-ssh':{},'@/lib/ssh':{},'@/lib/deployment-state':{...state,readDeploymentDefinition:async()=>({state:{serverId:'local',definition:{kind:'image'}}})},'@/lib/git-deployment':{readGitSource:async()=>null}});
const context={params:Promise.resolve({id:'fixture'})};const req=body=>({json:async()=>body,cookies:{get:()=>({value:'fixture'})}});
(async()=>{
 assert.equal((await route.POST(req({mode:'apply',safeModeOff:true}),context)).status,403);assert.deepEqual(calls,[]);
 role='ADMIN';scope=false;assert.equal((await route.POST(req({mode:'preview'}),context)).status,403);assert(!calls.includes('service'));calls.length=0;
 scope=true;assert.equal((await route.POST(req({mode:'apply',safeModeOff:true}),context)).status,423);assert(!calls.includes('service'));calls.length=0;
 advanced=true;assert.equal((await route.POST(req({mode:'apply',safeModeOff:false}),context)).status,423);assert(!calls.includes('service'));calls.length=0;
 advanced=false;assert.equal((await route.POST(req({mode:'preview'}),context)).status,200);assert(calls.includes('service'));calls.length=0;
 role='VIEWER';scope=false;assert.equal((await route.GET(req({}),context)).status,403);assert(!calls.includes('sensitive-view'));
 console.log('DEPLOY4 offline actual-source native validation, secret-safe DTO, Viewer/target denial, signed Advanced + literal acknowledgment, read-only preview PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
