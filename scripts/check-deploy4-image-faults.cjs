const assert=require('node:assert/strict');
const {load,fixture,mockCrypto}=require('./safe-env-recreate-regression.cjs');
const env=load('src/lib/env-profile.ts',{'@/lib/crypto':mockCrypto});
const helper=load('src/lib/container-recreate.ts',{'@/lib/db':{prisma:{}},'@/lib/crypto':mockCrypto,'@/lib/env-profile':env,'@/lib/local-server':{},'@/lib/ssh':{}});
const validation=load('src/lib/validation.ts');
const preflight=load('src/lib/deploy-preflight.ts',{'./compose-deployment':{},'./general-settings':{},'@/lib/validation':validation});
async function scenario(fault){
 let settings=new Map(),apps=[],calls=[],runtime,ownedName,payload,inTx=false;
 const prisma={server:{findUnique:async()=>({id:'remote'})},deploymentLog:{findUnique:async()=>({serverId:'remote'})},appSetting:{
  create:async({data})=>{if(fault==='save'||settings.has(data.key))throw Error('save');settings.set(data.key,data.value);return data;},
  findUnique:async({where})=>settings.has(where.key)?{key:where.key,value:settings.get(where.key)}:null,
  updateMany:async({where,data})=>{if(fault==='state'&&inTx)return {count:0};if(settings.get(where.key)!==where.value)return {count:0};settings.set(where.key,data.value);return {count:1};}
 },app:{create:async({data})=>{if(fault==='app')throw Error('app');const row={...data,id:'app'};apps.push(row);return row;}},$transaction:async fn=>{const before=new Map(settings),a=apps.slice();inTx=true;try{return await fn(prisma);}catch(e){settings=before;apps=a;throw e;}finally{inTx=false;}}};
 const state=load('src/lib/deployment-state.ts',{'@/lib/db':{prisma},'@/lib/crypto':mockCrypto,'@/lib/container-recreate':helper});
 const api={close:async()=>{},call:async(method,path,body)=>{
  calls.push([method,path]);
  if(method==='POST') {const saved=await state.readDeploymentDefinition('fault');assert(saved.state.pending);assert.equal(saved.state.definition.env.SECRET,'private');}
  if(path.startsWith('/images/create'))return {};
  if(path.startsWith('/images/'))return {Id:fixture.Image,Config:{Env:[]},RepoDigests:[]};
  if(path.startsWith('/containers/create')) {ownedName=decodeURIComponent(path.split('name=')[1]);payload=body;runtime=structuredClone(fixture);runtime.Name='/'+ownedName;runtime.Image=fixture.Image;runtime.Config={...runtime.Config,Env:body.Env,Labels:body.Labels};runtime.State={Running:false};if(['create-lost','create-unknown','create-foreign'].includes(fault))throw Error('lost');return {Id:fault==='create-malformed'?'bad':fixture.Id};}
  if(path.endsWith('/start')) {runtime.State.Running=true;if(fault==='start')throw Error('start');return {};}
  if(path.startsWith('/containers/')&&path.endsWith('/json')){if(fault==='inspect'||fault==='create-unknown')throw Error('inspect');if(fault==='create-foreign')return {...runtime,Config:{...runtime.Config,Labels:{}}};return runtime;}
  throw Error('unexpected '+path);
 }};
 const image=load('src/lib/image-deployment.ts',{'@/lib/container-recreate':{...helper,engine:async()=>{if(fault==='engine')throw Error('engine');return api;}},'@/lib/db':{prisma},'@/lib/app-routing':{validateDomain:()=>{},validateRouting:()=>{}},'@/lib/deployment-state':state,'@/lib/deploy-preflight':preflight,'@/lib/local-server':{isLocalServer:id=>id==='local'}});
 const body={type:'image',image:'node:20-alpine',name:'fixture',env:{SECRET:'private'}};
 for(const source of ['/var','/var/lib','/opt','/var/lib/docker','/var/lib/docker/volumes','/opt/vps-panel','/opt/vps-panel/data','/usr','/usr/local'])await assert.rejects(image.deployImage({...body,mounts:[{type:'bind',source,target:'/data',consent:true}]},'remote','fault'));assert.equal(calls.length,0);
 if(fault)await assert.rejects(image.deployImage(body,'remote','fault'));else await image.deployImage(body,'remote','fault');
 const saved=await state.readDeploymentDefinition('fault');
 if(fault==='save'){assert.equal(saved,null);assert.equal(calls.length,0);return;}
 assert.equal(saved.state.definition.env.SECRET,'private');assert.equal(settings.size,1);
 if(fault==='engine'){assert(!saved.state.pending);assert.equal(calls.length,0);assert.equal(saved.state.runtime.operation.phase,'failed_before_mutation');}
 else if(fault){assert(saved.state.pending);assert.equal(apps.length,0);if(['create-unknown','create-foreign'].includes(fault))assert.equal(saved.state.runtime.containerIds.length,0);else assert.deepEqual(Array.from(saved.state.runtime.containerIds),[fixture.Id]);}
 else {assert(!saved.state.pending);assert.equal(apps.length,1);assert(saved.state.original);assert.equal(saved.state.runtime.appId,'app');}
 assert(!calls.some(([m])=>m==='DELETE'));assert.equal(calls.filter(([,p])=>p.startsWith('/containers/create')).length,fault==='engine'?0:1);
 const lifecycle=load('src/lib/deployment-lifecycle.ts',{'@/lib/db':{prisma},'@/lib/image-deployment':image,'@/lib/container-recreate':{...helper,envTarget:async()=>({inspect:runtime,serverId:'remote',revision:'target',api}),withEnvTarget:async()=>{throw Error('unexpected mutation');}},'@/lib/deployment-state':state});
 const view=await lifecycle.deploymentView('fault');assert(!JSON.stringify(view).includes('private'));
 if(!fault){const preview=await lifecycle.imageLifecycle('fault',{mode:'preview',action:'recreate'});assert.equal(preview.compatibilityRequired,true);assert.equal(preview.writableLayerPreserved,false);assert.match(preview.recoveryScope,/Writable-layer/);await assert.rejects(lifecycle.imageLifecycle('fault',{mode:'apply',action:'recreate',revision:preview.revision,confirmation:preview.confirmation}),/compatibility/);assert(!(await state.readDeploymentDefinition('fault')).state.pending);}
 if(fault&&fault!=='engine')await assert.rejects(image.deployImage(body,'remote','fault'));assert.equal(calls.filter(([,p])=>p.startsWith('/containers/create')).length,fault==='engine'?0:1);
}
(async()=>{for(const fault of ['save','engine','create-lost','create-unknown','create-foreign','create-malformed','start','inspect','app','state',null]){await scenario(fault);console.log('Image actual-service fault check PASS:',fault||'success/recreate-ack');}})().catch(e=>{console.error(e);process.exitCode=1;});
