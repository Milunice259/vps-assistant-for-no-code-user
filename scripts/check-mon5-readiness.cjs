const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}) {
 const exports = {};
 const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:id=>id in mocks?mocks[id]:require(id),Buffer,URL,structuredClone,setTimeout,clearTimeout,console,Error,process},{filename:file});
 return exports;
}
module.exports = {load};
if (require.main === module) (async()=>{
 const {EventEmitter}=require('node:events');
 let host='192.0.2.10', requests=0, tlsCalls=0, closed=0, code=200, mode='normal', resolves=0, options;
 const local={isLocalServer:id=>id==='local',getLocalServerInfo:()=>({host})};
 const db={prisma:{server:{findUnique:async()=>({host})}}};
 const routing={inspectedRouting:t=>t.route||{owned:false},validateDomain:d=>{assert.match(d,/^[a-z0-9.-]+$/);assert(d.includes('.'));},validateRouting:()=>{},routingInventory:async()=>({proxies:[]}),verifyRoutingTls:async t=>{tlsCalls++;assert.equal(t.app.server.host,'192.0.2.10');return {tls:'failed',reason:'Certificate chain, DNS SAN or validity period is invalid'};}};
 const target={serverId:'local',inspect:{Id:'a'.repeat(64),Config:{Env:['TOKEN=do-not-leak'],Healthcheck:{Test:['CMD','do-not-leak']}},State:{Running:true,Status:'running',Health:{Status:'healthy',Log:[{Output:'do-not-leak'}]}},NetworkSettings:{Ports:{'8080/tcp':[{HostIp:'0.0.0.0',HostPort:'8080'}]}}},api:{close:async()=>closed++}};
 const transport={request:(o,cb)=>{requests++;options=o;assert.equal(require('node:net').isIP(o.host),4);assert.equal(o.path,'/');assert.equal(o.agent,false);assert.equal(o.maxHeaderSize,8192);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{if(mode==='normal')queueMicrotask(()=>cb({statusCode:code,destroy(){}}));else if(mode==='error')queueMicrotask(()=>req.emit('error',Error('do-not-leak')));};return req;}};
 const dns={Resolver:class{async resolve4(){resolves++;return ['192.0.2.10'];}async resolve6(){resolves++;return [];}}};
 const service=load('src/lib/app-readiness.ts',{'@/lib/container-recreate':{envTarget:async()=>target},'@/lib/app-routing':routing,'@/lib/local-server':local,'@/lib/db':db,'node:http':transport,'node:dns/promises':dns});
 let r=await service.checkAppReadiness('local::fixture');assert.equal(r.container.status,'healthy');assert.equal(r.backend.status,'verified');assert.equal(r.tls.tls,'not_requested');assert.equal(closed,1);assert(!JSON.stringify(r).includes('do-not-leak'));
 code=503;r=await service.readTargetReadiness(target);assert.equal(r.container.status,'healthy');assert.equal(r.backend.status,'failed');assert.equal(r.backend.statusCode,503);
 code=302;const before=requests;r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'failed');assert.equal(requests,before+1);
 mode='error';r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'failed');assert(!JSON.stringify(r).includes('do-not-leak'));
 mode='slow';const start=Date.now();r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'failed');assert(Date.now()-start<3500);mode='normal';code=200;
 target.inspect.State.Health.Status='starting';r=await service.readTargetReadiness(target);assert.equal(r.container.status,'unknown');assert.equal(r.container.health,'starting');
 delete target.inspect.State.Health;r=await service.readTargetReadiness(target);assert.equal(r.container.status,'unknown');assert.equal(r.backend.status,'verified');
 target.inspect.State.Running=false;r=await service.readTargetReadiness(target);assert.equal(r.container.status,'unhealthy');assert.equal(r.backend.status,'unavailable');target.inspect.State.Running=true;
 const bindings=target.inspect.NetworkSettings.Ports;target.inspect.NetworkSettings.Ports={};r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'unsupported');target.inspect.NetworkSettings.Ports=bindings;
 for(const unsafe of ['127.0.0.1','169.254.169.254','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','100.100.100.200']){host=unsafe;const n=requests;r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'unavailable');assert.equal(requests,n);}
 host='registered.test';r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'verified');assert.equal(options.host,'192.0.2.10');assert.equal(resolves,2);
 const incomplete=load('src/lib/app-readiness.ts',{'@/lib/container-recreate':{},'@/lib/app-routing':routing,'@/lib/local-server':local,'@/lib/db':db,'node:http':transport,'node:dns/promises':{Resolver:class{async resolve4(){return ['192.0.2.10'];}async resolve6(){throw Object.assign(Error('timeout'),{code:'ETIMEOUT'});}}}});
 const n=requests;r=await incomplete.readTargetReadiness(target);assert.equal(r.backend.status,'unavailable');assert.equal(requests,n);
 host='192.0.2.10';target.route={owned:true,domain:'app.test',routing:{backendPort:8080}};r=await service.readTargetReadiness(target);assert.equal(r.backend.status,'verified');assert.equal(r.tls.tls,'failed');assert.equal(tlsCalls,1);
 host='169.254.169.254';r=await service.readTargetReadiness(target);assert.equal(r.tls.tls,'unavailable');assert.equal(tlsCalls,1);
 let deny=true,called=0;const route=load('src/app/api/apps/[id]/health/route.ts',{'@/lib/app-access':{authorizeApp:async()=>deny?{status:403}:null},'@/lib/app-readiness':{checkAppReadiness:async()=>{called++;return r;}},'next/server':{NextResponse:{json:(body,opts)=>({body,status:opts?.status||200})}}});
 assert.equal((await route.GET({}, {params:Promise.resolve({id:'fixture'})})).status,403);assert.equal(called,0);deny=false;assert.equal((await route.GET({}, {params:Promise.resolve({id:'fixture'})})).status,200);assert.equal(called,1);
 console.log('MON01 actual-source: independent Docker/HTTP/TLS, starting/absent/stopped, HTTP 503/redirect/error/deadline, secret whitelist, registered numeric pin, SSRF deny, incomplete DNS, authorization and close passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
