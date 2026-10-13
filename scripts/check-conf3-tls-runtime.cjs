// One private native Engine, installed images only; child-only CA trust. No production mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = '/root/.hermes/cache/scratch';
const call = (args, options = {}) => execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options}).trim();
if (process.argv[2] !== 'child') {
 assert.equal(process.env.CONF3_TLS_AUTHORIZED,'1','Explicit disposable Engine authorization required');
 const name='conf3-tls-finish-'+randomUUID(), dir=path.join(root,name); fs.mkdirSync(dir,{mode:0o700});
 let engine;
 try {
  const openssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:['ignore','pipe','pipe']});
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','2','-subj','/CN=CONF3 isolated fixture CA');
  openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=unused.invalid');
  fs.writeFileSync(path.join(dir,'san.ext'),'subjectAltName=DNS:app.conf3.test\nextendedKeyUsage=serverAuth\n',{mode:0o600});
  openssl('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','1','-extfile','san.ext');
  for(const f of fs.readdirSync(dir))fs.chmodSync(path.join(dir,f),0o600);
  engine=call(['run','-d','--privileged','--name',name,'--label','conf3-tls.owner='+name,'--mount','type=bind,source='+dir+',target=/fixture','--env','DOCKER_TLS_CERTDIR=','docker:29-dind','dockerd','--host=unix:///var/run/docker.sock','--host=unix:///fixture/docker.sock','--storage-driver=vfs']);
  const i=JSON.parse(call(['inspect',engine]))[0]; assert.equal(i.Name,'/'+name); const ip=i.NetworkSettings.Networks.bridge.IPAddress; assert(ip);
  // Use the nested Unix socket via private docker exec CLI; no host socket mount, TCP Engine or image pulls.
  for(let attempt=0;;attempt++){try{call(['exec',engine,'docker','info']);break;}catch(e){if(attempt>40)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}}
  for(const image of ['traefik:v3.6.1','node:20-alpine']) {
   const transfer=spawnSync('bash',['-o','pipefail','-c',`docker image save ${image} | docker exec -i ${engine} docker image load`],{encoding:'utf8',maxBuffer:1024*1024}); assert.equal(transfer.status,0,transfer.stderr);
  }
  const env={...process.env,CONF3_TLS_ENGINE:engine,CONF3_TLS_OWNER:name,CONF3_TLS_DIR:dir,CONF3_TLS_IP:ip};
  const untrusted=spawnSync(process.execPath,[__filename,'child','untrusted'],{env:{...env,NODE_EXTRA_CA_CERTS:''},encoding:'utf8'}); assert.equal(untrusted.status,0,untrusted.stderr+untrusted.stdout); process.stdout.write(untrusted.stdout);
  const trusted=spawnSync(process.execPath,[__filename,'child','trusted'],{env:{...env,NODE_EXTRA_CA_CERTS:path.join(dir,'ca.crt')},encoding:'utf8'}); assert.equal(trusted.status,0,trusted.stderr+trusted.stdout); process.stdout.write(trusted.stdout);
 } finally {
  if(engine){const i=JSON.parse(call(['inspect',engine]))[0];assert.equal(i.Config.Labels['conf3-tls.owner'],name);const volumes=i.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);call(['rm','-f','-v',engine]);assert.throws(()=>call(['inspect',engine]));for(const volume of volumes)assert.throws(()=>call(['volume','inspect',volume]));}
  fs.rmSync(dir,{recursive:true,force:true});assert(!fs.existsSync(dir));console.log('CONF04 TLS exact isolated Engine + volumes + private key scratch cleanup verified');
 }
} else {
 const { load }=require('./safe-env-recreate-regression.cjs');
 const engine=process.env.CONF3_TLS_ENGINE, owner=process.env.CONF3_TLS_OWNER, dir=process.env.CONF3_TLS_DIR, ip=process.env.CONF3_TLS_IP;
 assert.match(owner,/^conf3-tls-finish-[a-f0-9-]{36}$/);assert.equal(JSON.parse(call(['inspect',engine]))[0].Config.Labels['conf3-tls.owner'],owner);
 const cli=(...args)=>call(['exec',engine,'docker',...args]); const inspect=id=>JSON.parse(cli('inspect',id))[0];
 const domain='app.conf3.test', network='tls-net';
 const writeAcme=()=>fs.writeFileSync(path.join(dir,'acme.json'),JSON.stringify({fixture:{Account:null,Certificates:[{domain:{main:domain},certificate:fs.readFileSync(path.join(dir,'server.crt')).toString('base64'),key:fs.readFileSync(path.join(dir,'server.key')).toString('base64'),Store:'default'}]}}),{mode:0o600});
 const local={isLocalServer:id=>id==='local',getLocalServerInfo:()=>({host:ip})};
 const dns={Resolver:class{async resolve4(host){assert([domain,'wrong.conf3.test',ip].includes(host));return [ip];}async resolve6(){return [];}}};
 const rows=new Map();process.env.ENCRYPTION_KEY=require('node:crypto').randomBytes(32).toString('hex');
 const crypto=load('src/lib/crypto.ts'),env=load('src/lib/env-profile.ts',{'@/lib/crypto':crypto});
 const prisma={server:{findUnique:async()=>({host:ip})},app:{findUnique:async()=>null},appSetting:{findUnique:async({where})=>rows.has(where.key)?{key:where.key,value:rows.get(where.key)}:null,create:async({data})=>{assert(!rows.has(data.key));rows.set(data.key,data.value);},updateMany:async({where,data})=>{if(rows.get(where.key)!==where.value)return {count:0};rows.set(where.key,data.value);return {count:1};}},$transaction:async fn=>fn(prisma)};
 // Native HTTP over a second private Unix socket in this Engine's own scratch bind.
 const transport={request:(options,callback)=>{assert.equal(options.socketPath,'/var/run/docker.sock');return http.request({...options,socketPath:path.join(dir,'docker.sock')},callback);}};
 const helper=load('src/lib/container-recreate.ts',{'node:http':transport,'@/lib/db':{prisma},'@/lib/env-profile':env,'@/lib/crypto':crypto,'@/lib/local-server':local,'@/lib/ssh':{}});
 const routing=load('src/lib/app-routing.ts',{'node:dns/promises':dns,'@/lib/container-recreate':helper,'@/lib/db':{prisma},'@/lib/local-server':local});
 const configuration=load('src/lib/app-configuration.ts',{'@/lib/app-routing':routing,'@/lib/container-recreate':helper,'@/lib/db':{prisma},'@/lib/env-profile':env});
 async function poll(fn){let e;for(let n=0;n<40;n++){try{return await fn();}catch(error){e=error;await new Promise(r=>setTimeout(r,250));}}throw e;}
 async function run(){
  // Restart dockerd with a second private Unix path shared through our own scratch bind only.
  let proxy, id;
  if(process.argv[3]==='untrusted'){
   writeAcme();cli('network','create',network);
   proxy=cli('run','-d','--name','proxy','--network',network,'--label','conf3-tls.owner='+owner,'-p','8443:443','-v','/var/run/docker.sock:/var/run/docker.sock:ro','-v','/fixture:/fixture','traefik:v3.6.1','--providers.docker=true','--providers.docker.exposedbydefault=false','--entrypoints.secure.address=:443','--entrypoints.web.address=:80','--certificatesresolvers.fixture.acme.storage=/fixture/acme.json','--certificatesresolvers.fixture.acme.caserver=https://127.0.0.1:1/directory','--certificatesresolvers.fixture.acme.httpchallenge.entrypoint=web');
   id=cli('run','-d','--name','app','--network',network,'--label','conf3-tls.owner='+owner,'--memory','64m','--cpus','0.25','--cap-drop','NET_RAW','--security-opt','no-new-privileges','node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());require('http').createServer((q,s)=>s.end('native-https-ok')).listen(8080,'0.0.0.0')");
  }else {proxy=inspect('proxy').Id;id=inspect('app').Id;}
  const r={proxyId:proxy,entrypoint:'secure',resolver:'fixture',backendPort:8080,network};
  const target={key:'safe-env:'+helper.configurationHash(['local','/app']),serverId:'local',inspect:inspect(id),api:{close:async()=>{}}};
  target.api.call=async(method,url)=>{assert.equal(method,'GET');if(url==='/containers/json?all=true')return cli('ps','-aq','--no-trunc').split('\n').filter(Boolean).map(c=>{const i=inspect(c);return {Id:i.Id,Image:i.Config.Image,State:i.State.Running?'running':'exited',Labels:i.Config.Labels,Names:[i.Name]};});const m=url.match(/^\/containers\/([a-f0-9]{64})\/json$/);assert(m);return inspect(m[1]);};
  const payload={Labels:{...target.inspect.Config.Labels}};routing.transformRouting(target,domain,r,payload);
  if(process.argv[3]==='untrusted'){
   cli('rm','-f',id);id=cli('run','-d','--name','app','--network',network,...Object.entries(payload.Labels).flatMap(([k,v])=>['--label',k+'='+v]),'--memory','64m','--cpus','0.25','--cap-drop','NET_RAW','--security-opt','no-new-privileges','node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());require('http').createServer((q,s)=>s.end('native-https-ok')).listen(8080,'0.0.0.0')");target.inspect=inspect(id);
   await poll(async()=>assert.equal((await routing.routingReadback(target,id,domain,r)).tls,'failed'));assert.equal((await routing.routingReadback({...target,serverId:'remote-fixture',app:{server:{host:ip}}},id,domain,r)).tls,'failed');console.log('CONF04 native Traefik untrusted private CA rejected for Local and Remote');return;
  }
  target.inspect=inspect(id);
  await poll(async()=>assert.equal((await routing.routingReadback(target,id,domain,r)).tls,'verified'));
  const result=await routing.routingReadback(target,id,domain,r);assert.equal(result.activeProxy,'unverified');assert.equal(result.certificate.hostnameVerified,true);assert.equal(result.certificate.chainTrusted,true);assert(Date.parse(result.certificate.validTo)>Date.now());
  const remote={...target,serverId:'remote-fixture',app:{server:{host:ip}}};assert.equal((await routing.routingReadback(remote,id,domain,r)).tls,'verified');
  // Force only test SNI to the installed app certificate while the real native TLS verifier expects another SAN.
  const nativeTls=require('node:tls');const wrong=load('src/lib/app-routing.ts',{'node:dns/promises':dns,'node:tls':{...nativeTls,connect:options=>nativeTls.connect({...options,servername:domain,checkServerIdentity:(_,certificate)=>nativeTls.checkServerIdentity('wrong.conf3.test',certificate)})},'@/lib/container-recreate':helper,'@/lib/db':{prisma},'@/lib/local-server':local});
  assert.equal((await wrong.verifyRoutingTls(target,'wrong.conf3.test',r)).tls,'failed');
  assert.equal((await wrong.verifyRoutingTls(remote,'wrong.conf3.test',r)).tls,'failed');
  const get=(servername,checkServerIdentity)=>new Promise((resolve,reject)=>{const req=https.get({host:ip,port:8443,agent:false,servername,headers:{Host:domain},rejectUnauthorized:true,...(checkServerIdentity?{checkServerIdentity}:{})},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(text));});req.on('error',reject);req.setTimeout(4000,()=>req.destroy(Error('timeout')));});
  await poll(async()=>assert.equal(await get(domain),'native-https-ok'));
  await assert.rejects(()=>get(domain,(_,cert)=>require('node:tls').checkServerIdentity('wrong.conf3.test',cert)),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');
  // Actual source preview/apply with live nested Engine and in-memory metadata boundary.
  let appId='local::'+id, view=await configuration.configurationView(appId); const original=inspect(id);
  call(['exec',engine,'iptables','-I','FORWARD','-p','tcp','--dport','443','-j','DROP']);
  const desired={...view.runtime,cpuLimit:0.5,memoryLimit:80};delete desired.domain;delete desired.routing;
  const preview=await configuration.previewConfiguration(appId,view.revision,'apply',desired);
  const changed=await configuration.applyConfiguration(appId,preview.token,preview.confirmation);
  assert.equal(changed.verified,true);assert.equal(changed.routing.tls,'pending');
  id=changed.newContainerId;appId=changed.newAppId;const actual=inspect(id);
  assert.equal(actual.HostConfig.NanoCpus,500000000);assert.equal(actual.HostConfig.Memory,80*1048576);assert.deepEqual(actual.Config.Env,original.Config.Env);assert.deepEqual(actual.Config.Cmd,original.Config.Cmd);const keptLabels={...actual.Config.Labels};delete keptLabels['vps-assistant.safe-operation'];assert.deepEqual(keptLabels,original.Config.Labels);assert.deepEqual(actual.HostConfig.CapDrop,original.HostConfig.CapDrop);assert.deepEqual(actual.HostConfig.SecurityOpt,original.HostConfig.SecurityOpt);assert.equal(inspect(original.Id).State.Running,false);
  call(['exec',engine,'iptables','-D','FORWARD','-p','tcp','--dport','443','-j','DROP']);await poll(async()=>assert.equal((await configuration.configurationView(appId)).routing.tls,'verified'));await poll(async()=>assert.equal(await get(domain),'native-https-ok'));
  console.log('CONF04 native installed Traefik HTTPS passed: actual private-CA certificate + SNI + SAN + validity; exact source Local and Remote pins; backend HTTPS response; wrong SAN rejected; actual resource edit preserves route/env/security; unavailable TLS does not undo applied replacement; repeat read-only readiness succeeds');
 }
 run().catch(e=>{console.error(e);process.exitCode=1;});
}
