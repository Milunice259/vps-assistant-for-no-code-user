// Exact disposable nested Engine only; installed images, no pull/host port/production mutation.
const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {load}=require('./check-mon5-readiness.cjs');
const call=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
(async()=>{
 const owner='mon5-readiness-'+randomUUID();let engine;
 try{
 engine=call(['run','-d','--privileged','--name',owner,'--label','mon5.readiness.owner='+owner,'--env','DOCKER_TLS_CERTDIR=','docker:29-dind','dockerd','--host=unix:///var/run/docker.sock','--storage-driver=vfs']);
 const outer=JSON.parse(call(['inspect',engine]))[0],ip=outer.NetworkSettings.Networks.bridge.IPAddress;assert(ip);
 const cli=(...args)=>call(['exec',engine,'docker',...args]);
 for(let n=0;;n++){try{cli('info');break;}catch(e){if(n===50)throw e;await new Promise(r=>setTimeout(r,200));}}
 const transfer=spawnSync('bash',['-o','pipefail','-c',`docker image save node:20-alpine | docker exec -i ${engine} docker image load`],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(transfer.status,0,transfer.stderr);
 const id=cli('run','-d','--name','backend','--label','mon5.readiness.owner='+owner,'-p','8080:8080','--health-cmd','node -e "process.exit(0)"','--health-interval','1s','--health-timeout','1s','node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());require('http').createServer((q,s)=>{s.statusCode=require('fs').existsSync('/tmp/fail')?503:200;s.end('private-fixture-body');}).listen(8080,'0.0.0.0')");
 const inspect=()=>JSON.parse(cli('inspect',id))[0];
 let closed=0;
 const target={serverId:'local',key:'fixture',inspect:inspect(),api:{close:async()=>closed++,call:async(method,url)=>{assert.equal(method,'GET');if(url==='/containers/json?all=true')return [{Id:id,Image:'node:20-alpine',State:'running'}];throw Error('unexpected native call');}}};
 const local={isLocalServer:s=>s==='local',getLocalServerInfo:()=>({host:ip})};
 const helper={envTarget:async()=>{target.inspect=inspect();return target;},configurationHash:()=> 'f'.repeat(64)};
 const db={prisma:{server:{findUnique:async()=>({host:ip})}}};
 const routing=load('src/lib/app-routing.ts',{'@/lib/container-recreate':helper,'@/lib/local-server':local,'@/lib/db':db});
 const service=load('src/lib/app-readiness.ts',{'@/lib/container-recreate':helper,'@/lib/app-routing':routing,'@/lib/local-server':local,'@/lib/db':db});
 let r;
 for(let n=0;;n++){r=await service.checkAppReadiness('local::'+id);if(r.container.status==='healthy'&&r.backend.status==='verified')break;if(n===30)throw Error('native healthy deadline');await new Promise(r=>setTimeout(r,200));}
 assert.equal(r.tls.tls,'not_requested');assert(!JSON.stringify(r).includes('private-fixture-body'));
 cli('exec',id,'touch','/tmp/fail');r=await service.checkAppReadiness('local::'+id);assert.equal(r.container.status,'healthy');assert.equal(r.backend.status,'failed');assert.equal(r.backend.statusCode,503);
 cli('stop','-t','2',id);r=await service.checkAppReadiness('local::'+id);assert.equal(r.container.status,'unhealthy');assert.equal(r.backend.status,'unavailable');assert(closed>=3);
 console.log('MON01 native isolated Docker target: healthy Docker + HTTP 200, healthy Docker + actual HTTP 503, stopped backend unavailable, no unsupported TLS pass, secret-safe DTO, close verified');
 } finally {
 if(engine){const i=JSON.parse(call(['inspect',engine]))[0];assert.equal(i.Config.Labels['mon5.readiness.owner'],owner);const volumes=i.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);call(['rm','-f','-v',engine]);assert.throws(()=>call(['inspect',engine]));for(const v of volumes)assert.throws(()=>call(['volume','inspect',v]));console.log('MON01 exact isolated Engine and owned volumes cleanup verified');}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
