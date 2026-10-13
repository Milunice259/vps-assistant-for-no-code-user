const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const http = require('node:http');
const {load} = require('./safe-env-recreate-regression.cjs');
process.env.ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
const crypto = load('src/lib/crypto.ts');
const env = load('src/lib/env-profile.ts', {'@/lib/crypto':crypto});
const rows = new Map();
const prisma = {app:{findUnique:async()=>null}, appSetting:{
 findUnique:async({where})=>rows.has(where.key)?{key:where.key,value:rows.get(where.key)}:null,
 create:async({data})=>{if(rows.has(data.key))throw Error('duplicate');rows.set(data.key,data.value);},
 updateMany:async({where,data})=>{if(rows.get(where.key)!==where.value)return {count:0};rows.set(where.key,data.value);return {count:1};}
}, $transaction:async fn=>{const before=new Map(rows);try{const result=await fn(prisma);if(transactionFault)throw Error('metadata fixture failure');return result;}catch(e){rows.clear();for(const [k,v] of before)rows.set(k,v);throw e;}}};
let transactionFault=false;
let fault, faultHit = false;
const engineTrace=[];
const interceptedHttp = {request(options, callback) {
 const hit = fault && (!faultHit || fault.repeat) && fault.match(options);
 if(hit)faultHit=true;
 return http.request(hit && !fault.after ? {...options,path:'/version',method:'GET'}:options, res=>{engineTrace.push({method:options.method,path:options.path,status:res.statusCode,injected:!!hit});if(hit)res.statusCode=500;callback(res);});
}};
const remote=process.env.SAFE12_REMOTE==='1';
if(remote)prisma.server={findUnique:async()=>({id:'local',host:'fixture.invalid',port:22,username:'fixture'})};
const sshMock={closeSSH:async()=>{},createSSHConnection:async config=>{assert.equal(config.serverId,'local');return {spawn:async command=>{
 assert(command.includes('--unix-socket /var/run/docker.sock'));const method=/ -X (\w+)/.exec(command)[1];const apiPath=/'http:\/\/localhost([^']+)'/.exec(command)[1];
 const {EventEmitter}=require('node:events');const stream=new EventEmitter();stream.stderr=new EventEmitter();stream.close=()=>{};
 stream.end=data=>{assert(!command.includes('ORIGINAL='));const req=interceptedHttp.request({socketPath:'/var/run/docker.sock',method,path:apiPath,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{let output='';res.on('data',c=>output+=c);res.on('end',()=>{stream.emit('data',Buffer.from(output+'\n'+res.statusCode));stream.emit('exit',0);stream.emit('close');});});req.on('error',e=>stream.emit('error',e));req.end(data);};return stream;
}};}};
const helper=load('src/lib/container-recreate.ts',{'node:http':interceptedHttp,'@/lib/db':{prisma},'@/lib/env-profile':env,'@/lib/crypto':crypto,'@/lib/local-server':{isLocalServer:id=>!remote&&id==='local'},'@/lib/ssh':sshMock});
const owned=new Set();
const fs=require('node:fs');const path=require('node:path');
const scratch=fs.mkdtempSync(path.join(process.env.TMPDIR || '/root/.hermes/cache/scratch','vps-safe12-'));
const networks=[];let volume;
fs.writeFileSync(path.join(scratch,'sentinel'),'owned fixture');
function docker(...args){return execFileSync('docker',args,{encoding:'utf8'}).trim();}
function inspect(id){return JSON.parse(docker('inspect',id))[0];}
async function run(){
 const name='vps-safe12-'+process.pid;
 for(const suffix of ['net1','net2']){const n=name+'-'+suffix;docker('network','create',n);networks.push(n);}
 volume=name+'-volume';docker('volume','create',volume);
 let id=docker('run','-d','--name',name,'--network',networks[0],'--mount',`type=volume,source=${volume},target=/data`,'--mount',`type=bind,source=${scratch},target=/owned,readonly`,'--restart','on-failure:2','--memory','64m','--label','safe12=fixture','-e','ORIGINAL=first\nsecond','node:20-alpine','sleep','infinity');owned.add(id);docker('network','connect','--alias','owned-alias',networks[1],id);
 try{
  const before=inspect(id);assert.equal(before.Mounts.length,2);assert.equal(before.HostConfig.Privileged,false);assert.equal(Object.keys(before.HostConfig.PortBindings||{}).length,0);
  await helper.withEnvTarget('local::'+id,async target=>helper.saveProfiles(target,[{id:'p',name:'test',vars:env.encodeProfileVars({ORIGINAL:'override',EXTRA:'new'}),isActive:false,createdAt:new Date().toISOString()}]));
  let release;const gate=new Promise(resolve=>release=resolve);let entered;const ready=new Promise(resolve=>entered=resolve);
  const concurrent=helper.withEnvTarget('local::'+id,async()=>{entered();await gate;});await ready;
  await assert.rejects(()=>helper.changeProfile('local::'+id,'p'),/operation is pending/);assert.equal((await helper.recoveryPreview('local::'+id)).canReconcile,false);release();await concurrent;
  await helper.withEnvTarget('local::'+id,async target=>{const state={...target.state,ownerPid:2147483647};const value=JSON.stringify(state);await prisma.appSetting.updateMany({where:{key:target.key,value:target.row.value},data:{value}});target.state.recovery='simulated-crash';});
  const crash=await helper.recoveryPreview('local::'+id);assert.equal(crash.canReconcile,true);await helper.reconcileRecovery('local::'+id,crash.token,crash.confirmation);
  const raceKey=[...rows.keys()][0];const update=prisma.appSetting.updateMany;let persisted;const waiting=new Promise(r=>persisted=r);let finish;const persistence=new Promise(r=>finish=r);prisma.appSetting.updateMany=async q=>{const result=await update(q);if(JSON.parse(q.data.value).operation){persisted();await persistence;}return result;};const racing=helper.withEnvTarget('local::'+id,async()=>{});await waiting;assert.equal((await helper.recoveryPreview('local::'+id)).canReconcile,false);finish();await racing;prisma.appSetting.updateMany=update;assert(!JSON.parse(rows.get(raceKey)).operation);
  console.log('SAFE12 live-worker lock-publication race rejected');
  console.log('SAFE12 persisted crash-lock read-only reconciliation passed');
  console.log('SAFE12 concurrent operation CAS denial passed');
  const result=await helper.changeProfile('local::'+id,'p');owned.add(result.newContainerId);
  assert.equal(result.verified,true);assert.equal(inspect(id).State.Running,false);
  await assert.rejects(()=>helper.withEnvTarget('local::'+id,async()=>{}),/recovery container is read-only/);
  const stale=await helper.recoveryPreview('local::'+id);assert.equal(stale.newAppId,result.newAppId);assert.equal(stale.containerId,result.newContainerId);assert.deepEqual(JSON.parse(JSON.stringify(stale.activeProfileNames)),['test']);console.log('SAFE12 stale discovery rejects backup mutation and resolves replacement identity passed');
  const applied=inspect(result.newContainerId);assert(applied.Config.Env.includes('EXTRA=new'));assert(applied.Config.Env.includes('ORIGINAL=override'));const mounts=i=>i.Mounts.map(m=>[m.Type,m.Source,m.Destination,m.RW]).sort((a,b)=>a[2].localeCompare(b[2]));assert.deepEqual(mounts(applied),mounts(before));assert.deepEqual(Object.keys(applied.NetworkSettings.Networks).sort(),networks.slice().sort());assert(applied.NetworkSettings.Networks[networks[1]].Aliases.includes('owned-alias'));assert.equal(docker('exec',result.newContainerId,'cat','/owned/sentinel'),'owned fixture');
  const state=JSON.parse([...rows.values()][0]);assert(!state.baseline.includes('second'));assert.equal(env.decodeEnvBaseline(state.baseline).includes('ORIGINAL=first\nsecond'),true);
  const reverted=await helper.changeProfile('local::'+result.newContainerId,null);owned.add(reverted.newContainerId);
  assert.deepEqual(inspect(reverted.newContainerId).Config.Env,before.Config.Env);
  console.log('SAFE12 real apply/revert passed');
  if(process.env.SAFE12_CONFLICT==='1'){
   const request=interceptedHttp.request;let foreign;
   interceptedHttp.request=(options,callback)=>{if(options.path.startsWith('/containers/create')){const n=new URL('http://fixture'+options.path).searchParams.get('name');foreign=docker('create','--name',n,'--network','none','node:20-alpine','sleep','infinity');owned.add(foreign);}return request(options,callback);};
   await assert.rejects(()=>helper.changeProfile('local::'+reverted.newContainerId,'p'),/recovery is pending/);
   assert.equal(inspect(foreign).Id,foreign);assert(!engineTrace.some(r=>r.method==='DELETE'&&r.path.includes(foreign)));
   console.log('SAFE12 foreign candidate name conflict retained; no DELETE passed');return;
  }
  if(process.env.SAFE12_QUICK==='1'){console.log('SAFE12 exact multi-network aliases, bind sentinel and volume identity passed');return;}
  const current=reverted.newContainerId;
  for(const [label,match,after] of [
   ['restart-update',o=>o.path.endsWith('/update'),false],
   ['lost-stop-response',o=>o.path.includes('/stop?'),true],
   ['lost-rename-response',o=>o.path.includes('/rename?'),true],
   ['disconnect',o=>o.path.endsWith('/disconnect'),false],
   ['create',o=>o.path.startsWith('/containers/create'),false],
   ['lost-create-response',o=>o.path.startsWith('/containers/create'),true],
   ['candidate-rename',o=>o.path.includes('/rename?')&&!o.path.includes(current),false],
   ['start',o=>o.path.endsWith('/start')&&!o.path.includes(current),false],
   ['readback',o=>o.path.endsWith('/json')&&!o.path.includes(current),false],
  ]){
   fault={match,after};faultHit=false;
   await assert.rejects(()=>helper.changeProfile('local::'+current,'p'),/original runtime and profile metadata were restored/);
   assert.equal(faultHit,true,label);fault=null;
   const restored=inspect(current);assert.equal(restored.Id,current);assert.equal(restored.Name,'/'+name);assert.equal(restored.State.Running,true);assert.deepEqual(restored.Config.Env,before.Config.Env);assert.deepEqual(restored.HostConfig.RestartPolicy,before.HostConfig.RestartPolicy);
   const state=JSON.parse([...rows.values()][0]);assert(!state.operation);assert(!state.recovery);assert.equal(state.profiles[0].isActive,false);
   console.log('SAFE12 rollback verified: '+label);
  }
  transactionFault=true;
  await assert.rejects(()=>helper.changeProfile('local::'+current,'p'),/original runtime and profile metadata were restored/);
  transactionFault=false;assert.equal(inspect(current).State.Running,true);assert.equal(JSON.parse([...rows.values()][0]).profiles[0].isActive,false);
  console.log('SAFE12 metadata-commit failure rollback verified');
  fault={match:o=>o.path.endsWith('/start'),repeat:true};faultHit=false;
  await assert.rejects(()=>helper.changeProfile('local::'+current,'p'),/recovery is pending/);fault=null;
  const pending=JSON.parse([...rows.values()][0]);assert(pending.operation);assert(pending.recovery);assert.equal(inspect(current).Id,current);assert.equal(pending.profiles[0].isActive,false);
  await assert.rejects(()=>helper.changeProfile('local::'+current,'p'),/operation is pending/);
  const preview=await helper.recoveryPreview('local::'+current);assert.equal(preview.canReconcile,true);assert.equal(preview.running,false);
  await assert.rejects(()=>helper.reconcileRecovery('local::'+current,preview.token,'wrong'),/not ready/);
  await helper.reconcileRecovery('local::'+current,preview.token,preview.confirmation);
  assert(!JSON.parse([...rows.values()][0]).operation);assert.equal(inspect(current).State.Running,false);
  console.log('SAFE12 explicit read-only stopped-original reconciliation passed');
  const stopped=await helper.changeProfile('local::'+current,'p');owned.add(stopped.newContainerId);assert.equal(inspect(stopped.newContainerId).State.Running,false);
  const stoppedRevert=await helper.changeProfile('local::'+stopped.newContainerId,null);owned.add(stoppedRevert.newContainerId);assert.equal(inspect(stoppedRevert.newContainerId).State.Running,false);
  const key=[...rows.keys()][0];const legacy=JSON.parse(rows.get(key));delete legacy.baseline;legacy.profiles[0].isActive=true;rows.set(key,JSON.stringify(legacy));
  const importPreview=await helper.importBaseline('local::'+stoppedRevert.newContainerId,before.Config.Env);
  await assert.rejects(()=>helper.importBaseline('local::'+stoppedRevert.newContainerId,['WRONG=value'],importPreview.token,importPreview.confirmation),/preview changed/);
  await helper.importBaseline('local::'+stoppedRevert.newContainerId,before.Config.Env,importPreview.token,importPreview.confirmation);
  assert.deepEqual(JSON.parse(JSON.stringify(env.decodeEnvBaseline(JSON.parse(rows.get(key)).baseline))),before.Config.Env);
  console.log('SAFE12 stopped lifecycle and encrypted authoritative legacy import passed');
 } finally {
  // Exact names for response-lost candidates; never broad prefix deletion.
  for(const value of rows.values()){const s=JSON.parse(value);if(s.recovery){const r=env.decodeProfileVars(s.recovery);for(const n of [r.backupName,r.candidateName]){try{owned.add(inspect(n).Id);}catch{}}}}
  try{owned.add(inspect(name).Id);}catch{}
  for(const target of owned){const i=inspect(target);assert(i.Name.startsWith('/vps-safe12-'));docker('rm','-f',target);}
  for(const target of owned){assert.throws(()=>docker('inspect',target));}
  for(const n of networks)docker('network','rm',n);
  docker('volume','rm',volume);fs.rmSync(scratch,{recursive:true});
 }
}
run().catch(e=>{console.error(e);console.error('Engine request trace (no payloads):',JSON.stringify(engineTrace));process.exitCode=1;});
