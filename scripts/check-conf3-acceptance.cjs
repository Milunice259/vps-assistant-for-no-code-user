// Authenticated isolated panel + real dedicated Local/Remote Engines only. Requires check-conf3-auth-qa start.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{jwtVerify}=require('jose');
const dir='/root/.hermes/cache/scratch/vps-conf3-integrated';
const registry=JSON.parse(fs.readFileSync(dir+'/registry.json'));
const sessions=JSON.parse(fs.readFileSync(dir+'/sessions.json'));
const env=Object.fromEntries(fs.readFileSync(dir+'/env','utf8').trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
process.env.JWT_SECRET=env.JWT_SECRET;
const ts=require('typescript'),vm=require('node:vm'),exportsSafety={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/operation-safety.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsSafety,process,TextEncoder,require:n=>n==='next/server'?{}:n==='./permissions'?{can:role=>['OWNER','ADMIN','MANAGER','OPERATOR'].includes(role)}:require(n)});
const safety=exportsSafety;
const evidence=[];
async function call(route,actor='owner',body,grant=false,method=body?'POST':'GET'){
 const headers={'cookie':'vps-session='+sessions[actor],origin:registry.base,'content-type':'application/json'};
 if(grant){const {payload}=await jwtVerify(sessions[actor],new TextEncoder().encode(env.JWT_SECRET));headers.cookie+='; vps-advanced='+await safety.createAdvancedToken(payload);}
 const res=await fetch(registry.base+route,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 return {status:res.status,json:await res.json()};
}
function inspect(f,id){return JSON.parse(execFileSync('docker',['exec',f.engine,'docker','inspect',id],{encoding:'utf8'}))[0];}
(async()=>{
 const saved={applicationName:'CONF3 accepted panel',dockerRestartPolicy:'always',dockerMemoryLimitMB:512,cleanupSchedule:'weekly',backupSchedule:'daily',backupRetentionDays:45};
 for(const actor of ['manager','viewer','noaccess'])assert.equal((await call('/api/settings/general',actor,saved,false,'PUT')).status,403);
 assert.equal((await call('/api/settings/general','owner',saved,false,'PUT')).status,200);
 const general=await call('/api/settings/general');assert.deepEqual(general.json.data,saved);
 assert.equal(general.json.schedules.backup.active,false);assert.equal(general.json.schedules.cleanup.active,false);
 const login=await fetch(registry.base+'/login').then(r=>r.text());assert(login.includes(saved.applicationName));
 console.log('PASS actual Settings Owner save/GET + role-denied writes + login metadata branding; schedules inactive');
 for(const f of registry.fixtures){
  const initial=inspect(f,f.name);const appId=f.scope==='local'?'local::'+initial.Id:'discovered::'+registry.ssh.serverId+'::'+initial.Id;
  const endpoint='/api/apps/'+encodeURIComponent(appId)+'/configuration';
  assert.equal((await call(endpoint,'noaccess')).status,403);
  let view=await call(endpoint);assert.equal(view.status,200);assert.equal(view.json.data.containerId,initial.Id);
  assert.equal((await call(endpoint,'viewer',{mode:'preview',action:'adopt',revision:view.json.data.revision,settings:view.json.data.runtime})).status,403);
  const adoption=await call(endpoint,'manager',{mode:'preview',action:'adopt',revision:view.json.data.revision,settings:view.json.data.runtime});assert.equal(adoption.status,200,'Safe Mode read-only preview');
  const payload={mode:'apply',token:adoption.json.data.token,confirmation:adoption.json.data.confirmation,safeModeOff:true};
  assert.equal((await call(endpoint,'manager',payload)).status,423);
  assert.equal((await call(endpoint,'manager',{...payload,safeModeOff:false},true)).status,423);
  const adopted=await call(endpoint,'manager',payload,true);assert.equal(adopted.status,200);assert.equal(adopted.json.data.adopted,true);
  assert.equal(inspect(f,f.name).Id,initial.Id,'Adoption never replaces');
  view=await call(endpoint);assert.equal(view.json.data.adopted,true);
  const settings={...view.json.data.runtime,name:'CONF3 accepted '+f.scope,cpuLimit:0.75,memoryLimit:128,restartPolicy:'on-failure',maximumRetryCount:2,logMaxSize:'2m',logMaxFiles:3};
  const preview=await call(endpoint,'manager',{mode:'preview',action:'apply',revision:view.json.data.revision,settings});assert.equal(preview.status,200);
  const bad=await call(endpoint,'manager',{mode:'apply',safeModeOff:true,token:preview.json.data.token,confirmation:'wrong'},true);assert.equal(bad.status,409);
  const applied=await call(endpoint,'manager',{mode:'apply',safeModeOff:true,token:preview.json.data.token,confirmation:preview.json.data.confirmation},true);assert.equal(applied.status,200,JSON.stringify({scope:f.scope,error:applied.json.error}));assert.equal(applied.json.data.verified,true);
  const current=inspect(f,f.name);assert.equal(current.Id,applied.json.data.newContainerId);assert.notEqual(current.Id,initial.Id);
  assert.equal(current.HostConfig.Memory,128*1048576);assert.equal(current.HostConfig.NanoCpus,750000000);assert.equal(current.HostConfig.RestartPolicy.Name,'on-failure');assert.equal(current.HostConfig.RestartPolicy.MaximumRetryCount,2);assert.equal(current.HostConfig.LogConfig.Config['max-size'],'2m');assert.equal(current.HostConfig.LogConfig.Config['max-file'],'3');
  assert.deepEqual(current.Config.Env,initial.Config.Env);assert.deepEqual(current.Config.Cmd,initial.Config.Cmd);assert.equal(inspect(f,initial.Id).State.Running,false);assert.equal(inspect(f,initial.Id).HostConfig.RestartPolicy.Name,'no');
  const currentId=applied.json.data.newAppId;
  const readback=await call('/api/apps/'+encodeURIComponent(currentId)+'/configuration');assert.equal(readback.status,200);assert.equal(readback.json.data.runtime.memoryLimit,128);assert.equal(readback.json.data.runtime.name,settings.name);
  const detail=await call('/api/apps/'+encodeURIComponent(currentId));assert.equal(detail.status,200);assert.equal(detail.json.data.name,settings.name);assert.equal(detail.json.data.memoryLimit,128);assert.equal(detail.json.data.cpuLimit,0.75);
  const inventory=await call('/api/apps?liveRemote=true');assert.equal(inventory.status,200);assert(inventory.json.data.some(a=>a.containerId===current.Id&&a.name===settings.name));
  const replay=await call(endpoint,'manager',{mode:'apply',safeModeOff:true,token:preview.json.data.token,confirmation:preview.json.data.confirmation},true);assert.notEqual(replay.status,200);
  evidence.push({scope:f.scope,originalId:initial.Id,newId:current.Id,newAppId:currentId,adopted:true,runtimeVerified:true,replayRejected:true,envStartupPreserved:true,recoveryRetained:true});
  console.log('PASS authenticated '+f.scope+' scope/roles/Safe Mode preview + adoption + runtime apply/readback + stale-token rejection');
 }
 fs.writeFileSync(dir+'/configuration-acceptance.json',JSON.stringify(evidence,null,2));
 console.log('PASS actual isolated authenticated API mutations; no production DB/socket or password login used.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
