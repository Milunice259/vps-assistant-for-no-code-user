// Actual services + disposable nested Unix Engine. Never mounts production Docker socket.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),cryptoNative=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {load}=require('./safe-env-recreate-regression.cjs');
const scratch=fs.mkdtempSync(path.join(process.env.TMPDIR || '/root/.hermes/cache/scratch','deploy4-image-'));
const name=`vps-deploy4-image-engine-${process.pid}`;
const registry={hostContainer:name,nestedContainers:[],networks:[],volumes:[],scratch};
fs.writeFileSync(path.join(scratch,'fixture-registry.json'),JSON.stringify(registry));
const socket=path.join(scratch,'socket/docker.sock');
function host(...args){return execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();}
function nested(...args){return host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock',...args);}
const rows=new Map(),logs=new Map();let commitFault=false;
const prisma={app:{findUnique:async()=>null},server:{findUnique:async()=>null},deploymentLog:{findUnique:async({where})=>logs.get(where.id),update:async({where,data})=>{logs.set(where.id,{...logs.get(where.id),...data});return logs.get(where.id);}},appSetting:{findUnique:async({where})=>rows.has(where.key)?{key:where.key,value:rows.get(where.key)}:null,create:async({data})=>{if(rows.has(data.key))throw Error('duplicate');rows.set(data.key,data.value);},updateMany:async({where,data})=>{if(rows.get(where.key)!==where.value)return {count:0};rows.set(where.key,data.value);return {count:1};}},$transaction:async fn=>{const before=new Map(rows),beforeLogs=new Map(logs);try{const result=await fn(prisma);if(commitFault)throw Error('fixture commit failure');return result;}catch(e){rows.clear();for(const [k,v] of before)rows.set(k,v);logs.clear();for(const [k,v] of beforeLogs)logs.set(k,v);throw e;}}};
process.env.ENCRYPTION_KEY=cryptoNative.randomBytes(32).toString('hex');
const crypto=load('src/lib/crypto.ts');
const env=load('src/lib/env-profile.ts',{'@/lib/crypto':crypto});
const trace=[];
const intercepted={request(options,cb){assert.equal(options.socketPath,'/var/run/docker.sock');trace.push({method:options.method,path:options.path});return http.request({...options,socketPath:socket},cb);}};
const helper=load('src/lib/container-recreate.ts',{'node:http':intercepted,'@/lib/db':{prisma},'@/lib/crypto':crypto,'@/lib/env-profile':env,'@/lib/local-server':{isLocalServer:id=>id==='local'},'@/lib/ssh':{}});
const state=load('src/lib/deployment-state.ts',{'@/lib/db':{prisma},'@/lib/crypto':crypto,'@/lib/container-recreate':helper});
const validation=load('src/lib/validation.ts');
const preflight=load('src/lib/deploy-preflight.ts',{'js-yaml':require('js-yaml'),'./general-settings':{},'./compose-deployment':{},'@/lib/validation':validation});
const routing=load('src/lib/app-routing.ts',{'@/lib/container-recreate':helper,'@/lib/local-server':{getLocalServerInfo:()=>({host:'127.0.0.1'}),isLocalServer:id=>id==='local'},'node:dns/promises':{Resolver:class{async resolve4(){return ['127.0.0.1'];}async resolve6(){return [];}}},'@/lib/db':{prisma}});
const image=load('src/lib/image-deployment.ts',{'@/lib/container-recreate':helper,'@/lib/db':{prisma},'@/lib/app-routing':routing,'@/lib/deployment-state':state,'@/lib/deploy-preflight':preflight,'@/lib/local-server':{isLocalServer:id=>id==='local'}});
const lifecycle=load('src/lib/deployment-lifecycle.ts',{'@/lib/db':{prisma},'@/lib/image-deployment':image,'@/lib/container-recreate':helper,'@/lib/deployment-state':state});
function inspect(id){return JSON.parse(nested('inspect',id))[0];}
function register(kind,id){registry[kind].push(id);fs.writeFileSync(path.join(scratch,'fixture-registry.json'),JSON.stringify(registry));}
async function main(){
 fs.mkdirSync(path.join(scratch,'socket'));fs.mkdirSync(path.join(scratch,'registry'));
 const id=host('run','-d','--name',name,'--label','vps-panel.fixture=deploy4-image','--privileged','--network','none','--mount',`type=bind,source=${scratch},target=/fixtures`,'--tmpfs','/var/lib/docker:rw,size=1200m','-e','DOCKER_TLS_CERTDIR=','docker:29-dind','dockerd','--host=unix:///fixtures/socket/docker.sock','--insecure-registry=172.16.0.0/12');
 registry.hostId=id;fs.writeFileSync(path.join(scratch,'fixture-registry.json'),JSON.stringify(registry));
 try{
  const deadline=Date.now()+60000;while(true){try{nested('info');break;}catch{if(Date.now()>deadline)throw Error('fixture engine not ready');await new Promise(r=>setTimeout(r,500));}}
  // Read-only host export. Load only into the nested Engine.
  const archive=path.join(scratch,'node.tar');execFileSync('docker',['save','-o',archive,'node:20-alpine'],{timeout:120000});
  host('exec',name,'sh','-c','docker -H unix:///fixtures/socket/docker.sock load -i /fixtures/node.tar');
  const nodeId=JSON.parse(host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','image','inspect','node:20-alpine'))[0].Id;
  // Docker CLI within fixtures uses the exact nested socket for every call.

  // Prepare a minimal native registry from the real OCI archive: config+gzip layers, two immutable manifests.
  execFileSync('python3',['-c',`import tarfile,json,pathlib,gzip,hashlib\np=pathlib.Path(${JSON.stringify(scratch)})\nt=tarfile.open(p/'node.tar')\nm=json.load(t.extractfile('manifest.json'))[0]\nc=t.extractfile(m['Config']).read()\nlayers=[]\nfor n in m['Layers']:\n b=t.extractfile(n).read()\n if not b.startswith(b'\\x1f\\x8b'): b=gzip.compress(b,compresslevel=1,mtime=0)\n d='sha256:'+hashlib.sha256(b).hexdigest();(p/'registry'/d.replace(':','_')).write_bytes(b);layers.append({'mediaType':'application/vnd.docker.image.rootfs.diff.tar.gzip','size':len(b),'digest':d})\nfor tag in ['v1','v2']:\n cfg=json.loads(c);cfg['config']['Env']=[x for x in cfg['config'].get('Env',[]) if not x.startswith('FIXTURE_VERSION=')]+['FIXTURE_VERSION='+tag];cfg['config']['Cmd']=['node','-e','process.on("SIGTERM",()=>process.exit());require("http").createServer((req,res)=>res.end("native-image-route")).listen(8080)'];cfg['config']['Healthcheck']={'Test':['CMD','node','-e','process.exit(0)'],'Interval':1000000000,'Timeout':1000000000,'Retries':2}\n b=json.dumps(cfg,separators=(',',':')).encode();d='sha256:'+hashlib.sha256(b).hexdigest();(p/'registry'/d.replace(':','_')).write_bytes(b)\n manifest=json.dumps({'schemaVersion':2,'mediaType':'application/vnd.docker.distribution.manifest.v2+json','config':{'mediaType':'application/vnd.docker.container.image.v1+json','size':len(b),'digest':d},'layers':layers},separators=(',',':')).encode();(p/'registry'/tag).write_bytes(manifest);(p/'registry'/('sha256_'+hashlib.sha256(manifest).hexdigest())).write_bytes(manifest)\n`],{timeout:120000});
  const serverCode=`const http=require('http'),fs=require('fs'),crypto=require('crypto');http.createServer((req,res)=>{if(req.url==='/v2/'||req.url==='/v2'){res.end('{}');return;}const match=req.url.match(/^\\/v2\\/fixture\\/(blobs|manifests)\\/(.+)$/);if(!match){res.statusCode=404;res.end();return;}let p='/registry/'+match[2].replace(':','_');if(!fs.existsSync(p)){res.statusCode=404;res.end();return;}const b=fs.readFileSync(p);res.setHeader('Content-Type',match[1]==='manifests'?'application/vnd.docker.distribution.manifest.v2+json':'application/octet-stream');res.setHeader('Docker-Content-Digest','sha256:'+crypto.createHash('sha256').update(b).digest('hex'));res.setHeader('Content-Length',b.length);res.end(req.method==='HEAD'?undefined:b);}).listen(5000,'0.0.0.0');`;
  const reg=host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','run','-d','--name','deploy4-registry','--mount','type=bind,source=/fixtures/registry,target=/registry,readonly',nodeId,'node','-e',serverCode);register('nestedContainers',reg);
  const regInspect=JSON.parse(host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','inspect',reg))[0];
  const address=regInspect.NetworkSettings.Networks.bridge.IPAddress+':5000/fixture';
  const api=await helper.engine(null);await api.call('GET','/version');await api.close();
  const network=host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','network','create','deploy4-data');register('networks',network);
  const volume=host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','volume','create','deploy4-data');register('volumes',volume);
  const proxyArchive=path.join(scratch,'proxy.tar');execFileSync('docker',['save','-o',proxyArchive,'traefik:v3.6.1'],{timeout:120000});
  nested('load','-i','/fixtures/proxy.tar');
  const proxy=nested('run','-d','--name','deploy4-proxy','--network','deploy4-data','--mount','type=bind,source=/fixtures/socket/docker.sock,target=/var/run/docker.sock,readonly','traefik:v3.6.1','--providers.docker=true','--providers.docker.exposedbydefault=false','--entrypoints.web.address=:80');register('nestedContainers',proxy);
  fs.mkdirSync(path.join(scratch,'data'));fs.writeFileSync(path.join(scratch,'data/sentinel'),'bind-data');
  logs.set('fixture',{serverId:null});
  const input={type:'image',image:address+':v1',name:'deploy4-app',env:{SECRET_FIXTURE:'private-sentinel'},mounts:[{type:'volume',source:volume,target:'/data',consent:true},{type:'bind',source:'/fixtures/data',target:'/owned',readOnly:true,consent:true}],domain:'deploy4.test',routing:{proxyId:proxy,backendPort:8080,entrypoint:'web',resolver:null,network:'deploy4-data'},networks:['deploy4-data'],healthcheck:{test:['CMD','node','-e','process.exit(0)'],intervalSeconds:1,timeoutSeconds:1,retries:2}};
  const deployed=await image.deployImage(input,'local','fixture',async command=>host('exec',name,'sh','-c',command));register('nestedContainers',deployed.containerId);assert.equal(deployed.status,'RUNNING');
  const first=JSON.parse(host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','inspect',deployed.containerId))[0];
  assert.equal(nested('exec',deployed.containerId,'cat','/owned/sentinel'),'bind-data');
  nested('network','connect','deploy4-data',reg);
  const proxyAddress=inspect(proxy).NetworkSettings.Networks['deploy4-data'].IPAddress;
  const routeProbe=`require('http').get({host:${JSON.stringify(proxyAddress)},port:80,headers:{Host:'deploy4.test'}},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{if(res.statusCode!==200||t!=='native-image-route')process.exit(1);console.log('native route verified');});}).on('error',()=>process.exit(1));`;
  const routeDeadline=Date.now()+15000;while(true){try{assert.equal(nested('exec',reg,'node','-e',routeProbe),'native route verified');break;}catch{if(Date.now()>routeDeadline){console.error(nested('logs',proxy));throw Error('native Traefik route unavailable');}await new Promise(r=>setTimeout(r,500));}}
  assert.equal(deployed.routing.nativeConfigurationVerified,true);
  assert(rows.get(state.definitionKey('fixture')).startsWith('enc:v1:'));assert(!rows.get(state.definitionKey('fixture')).includes('private-sentinel'));
  const before=trace.length;const preview=await lifecycle.imageLifecycle('fixture',{mode:'preview',action:'update',image:address+':v2'});assert(!trace.slice(before).some(c=>c.method!=='GET'));assert(!JSON.stringify(preview).includes('private-sentinel'));
  await assert.rejects(()=>lifecycle.imageLifecycle('fixture',{mode:'apply',action:'update',image:address+':v2',revision:preview.revision,confirmation:preview.confirmation}),/compatibility/);
  const updated=await lifecycle.imageLifecycle('fixture',{mode:'apply',action:'update',image:address+':v2',revision:preview.revision,confirmation:preview.confirmation,dataCompatibility:'operator-confirmed',schemaCompatibility:'unchanged'});register('nestedContainers',updated.newContainerId);
  const second=JSON.parse(host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','inspect',updated.newContainerId))[0];assert.notEqual(second.Image,first.Image);assert(second.Config.Env.includes('SECRET_FIXTURE=private-sentinel'));assert.equal(second.Mounts[0].Name,first.Mounts[0].Name);assert.equal(updated.verified,true);
  const rollback=await lifecycle.imageLifecycle('fixture',{mode:'preview',action:'rollback'});
  const restored=await lifecycle.imageLifecycle('fixture',{mode:'apply',action:'rollback',revision:rollback.revision,confirmation:rollback.confirmation,dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed'});register('nestedContainers',restored.newContainerId);
  const third=JSON.parse(host('exec',name,'docker','-H','unix:///fixtures/socket/docker.sock','inspect',restored.newContainerId))[0];assert.equal(third.Image,first.Image);assert.deepEqual(third.Config.Env,first.Config.Env);assert.equal(third.Mounts[0].Name,first.Mounts[0].Name);
  const recreate=await lifecycle.imageLifecycle('fixture',{mode:'preview',action:'recreate'});commitFault=true;
  await assert.rejects(()=>lifecycle.imageLifecycle('fixture',{mode:'apply',action:'recreate',revision:recreate.revision,confirmation:recreate.confirmation,dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed',writableLayerLoss:true}),/original runtime and profile metadata were restored/);commitFault=false;
  const unchanged=await lifecycle.deploymentView('fixture');assert.equal(unchanged.pending,false);assert.equal(unchanged.drift,false);assert.equal(unchanged.containerIds[0],restored.newContainerId);
  const original=(await state.readDeploymentDefinition('fixture')).state.original;assert.equal(original.inspect.Id,deployed.containerId);assert.equal(original.imageDigest,first.Image);
  await assert.rejects(()=>state.saveDeploymentDefinition('fixture','local',{kind:'image'}, {containerIds:[restored.newContainerId],inspect:third}),/already exists/);
  console.log('DEPLOY4 real nested Engine: immutable encrypted original, native registry digest update, stateful volume/bind preservation, actual Traefik HTTP routing, secret-safe read-only preview, original rollback, atomic commit-failure recovery PASS');
 } finally {
  const info=JSON.parse(host('inspect',name))[0];assert.equal(info.Id,registry.hostId);assert.equal(info.Config.Labels['vps-panel.fixture'],'deploy4-image');assert(!info.Mounts.some(m=>m.Source==='/var/run/docker.sock'));
  // Whole nested namespace belongs to this exact registered daemon; no production asset deletion.
  host('rm','-f',registry.hostId);assert.throws(()=>host('inspect',registry.hostId));fs.rmSync(scratch,{recursive:true,force:true});console.log('DEPLOY4 exact host fixture and nested registry/assets cleanup PASS');
 }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
