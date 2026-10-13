#!/usr/bin/env node
// Native nested Engine + private SQLite + real collectors/worker/webhook HTTP.
// Fixture boundaries: in-process SSH server executes real shell commands against
// the nested socket; registered Remote is not a separate VPS. Next cookies only
// are injected for signed route reads. Host stats/services are read-only host data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const { Server } = require('ssh2');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || '/root/.hermes/cache/scratch', 'mon5-final-runtime-'));
fs.chmodSync(scratch, 0o700);
const owner = path.basename(scratch), registry = { owner, scratch, engine: null, volumes: [], processes: [] };
const record = () => fs.writeFileSync(path.join(scratch, 'resources.json'), JSON.stringify(registry));
const outerEnv = { ...process.env };
const docker = args => execFileSync('docker', args, { env: outerEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, seconds = 60) { const end = Date.now() + seconds * 1000; do { if (await fn()) return; await wait(250); } while (Date.now() < end); throw Error('Runtime deadline exceeded'); }
let db, ssh, receiver, worker, socket, token = '', received = [], fail = true;
const children = new Set(), clients = new Set();
const env = { ...process.env, DATABASE_URL: 'file:' + path.join(scratch, 'panel.db'), JWT_SECRET: randomUUID()+randomUUID(), ENCRYPTION_KEY: require('node:crypto').randomBytes(32).toString('hex'), NODE_ENV: 'production' };
const evidence = [];
const pass = text => { evidence.push(text); console.log('PASS ' + text); };
const runtime = path.join(scratch, 'runtime');
function load(file) { return require(path.join(runtime, file)); }
async function stopWorker() { if (!worker) return; const current = worker; worker = null; current.kill('SIGTERM'); await until(() => current.exitCode !== null || current.signalCode !== null, 15); }
function startWorker() { worker = spawn(process.execPath, [path.join(runtime, 'monitoring-worker.cjs')], { env, stdio: ['ignore', 'ignore', 'pipe'] }); registry.processes.push(worker.pid); record(); }
(async () => {
 record();
 try {
  registry.engine = docker(['run','-d','--privileged','--name',owner,'--label','mon5.runtime.owner='+owner,'--env','DOCKER_TLS_CERTDIR=','docker:29-dind','dockerd','--host=unix:///var/run/docker.sock','--storage-driver=vfs']); record();
  const outer = JSON.parse(docker(['inspect',registry.engine]))[0];
  registry.volumes = outer.Mounts.filter(m => m.Type === 'volume').map(m => m.Name); record();
  socket = '/proc/'+outer.State.Pid+'/root/var/run/docker.sock';
  const cli = (...args) => docker(['exec',registry.engine,'docker',...args]);
  await until(() => { try { cli('info'); return true; } catch { return false; } });
  const transfer = spawnSync('bash',['-o','pipefail','-c',`docker image save node:20-alpine | docker exec -i ${registry.engine} docker image load`],{encoding:'utf8',timeout:120000}); assert.equal(transfer.status,0,transfer.stderr);
  env.DOCKER_HOST = 'unix://'+socket;
  Object.assign(process.env, env);
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env,stdio:'pipe',timeout:60000});
  execFileSync(process.execPath,['scripts/monitoring-worker.cjs','--build',runtime],{env,stdio:'pipe'});
  fs.symlinkSync(path.join(root,'node_modules'),path.join(scratch,'node_modules'),'dir');
  fs.copyFileSync(path.join(root,'scripts/monitoring-worker.cjs'),path.join(runtime,'monitoring-worker.cjs'));
  fs.renameSync(runtime,path.join(scratch,'monitoring-runtime'));
  fs.symlinkSync(path.join(scratch,'monitoring-runtime'),runtime,'dir');
  // The unchanged worker resolves its runtime relative to itself.
  fs.symlinkSync(path.join(scratch,'monitoring-runtime'),path.join(runtime,'monitoring-runtime'),'dir');
  db = load('lib/db.js').prisma;
  await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  const privateKey = require('ssh2').utils.generateKeyPairSync('ed25519').private;
  ssh = new Server({hostKeys:[privateKey]}, client => {
   clients.add(client); client.on('close', () => clients.delete(client));
   client.on('error', () => {}); // Identity probe deliberately rejects before authentication.
   client.on('authentication', ctx => ctx.method === 'publickey' ? ctx.accept() : ctx.reject());
   client.on('ready', () => client.on('session',(accept) => accept().on('exec',(accept,reject,info) => {
    const stream = accept();
    const command = info.command.replace('--unix-socket /var/run/docker.sock','--unix-socket '+socket);
    const child = spawn('/bin/sh',['-c',command],{env}); children.add(child);
    child.stdout.pipe(stream); child.stderr.pipe(stream.stderr); stream.pipe(child.stdin);
    child.on('close', code => { children.delete(child); stream.exit(code || 0); stream.end(); });
    stream.on('close', () => { if (child.exitCode === null) child.kill('SIGKILL'); });
   })));
  });
  await new Promise(r => ssh.listen(0,'127.0.0.1',r));
  const remotePort = ssh.address().port;
  const connection = load('lib/ssh/connection.js');
  const fingerprint = await connection.probeSSHIdentity({host:'127.0.0.1',port:remotePort});
  const key = require('ssh2').utils.generateKeyPairSync('ed25519').private;
  const encrypt = load('lib/crypto.js').encrypt;
  await db.server.create({data:{id:'remote',name:'Runtime Remote',host:'127.0.0.1',port:remotePort,username:'fixture',authMethod:'KEY',encryptedKey:encrypt(key)}});
  await db.appSetting.create({data:{key:connection.sshIdentitySettingKey('remote'),value:JSON.stringify({host:'127.0.0.1',port:remotePort,fingerprint})}});
  const run = name => cli('run','-d','--name',name,'--label','mon5.runtime.owner='+owner,'node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());setInterval(()=>{},1000)");
  let localId = run('managed'), remoteId = run('remote-managed'), discoveredId = run('discovered');
  await db.server.create({data:{id:'local',name:'Local',host:outer.NetworkSettings.Networks.bridge.IPAddress,username:'fixture',isActive:false}});
  await db.app.createMany({data:[{id:'managed',name:'Managed',serverId:'local',containerId:localId},{id:'remote-app',name:'Remote',serverId:'remote',containerId:remoteId}]});
  const metrics = load('lib/monitoring-metrics.js'), base = new Date();
  const first = await metrics.collectMonitoringMetrics(base); assert.equal(first.gaps,0); assert(first.sampled >= 3);
  const before = await Promise.all(['managed','remote-app','local::'+discoveredId].map(id => metrics.readMonitoringHistory(id,'1h',base)));
  const old = [localId,remoteId,discoveredId];
  old.forEach(id => cli('rm','-f',id));
  localId=run('managed'); remoteId=run('remote-managed'); discoveredId=run('discovered');
  await db.app.update({where:{id:'managed'},data:{containerId:localId}}); await db.app.update({where:{id:'remote-app'},data:{containerId:remoteId}});
  const next = new Date(+base+60000); const second = await metrics.collectMonitoringMetrics(next); assert.equal(second.gaps,0);
  const after = await Promise.all(['managed','remote-app','local::'+discoveredId].map(id => metrics.readMonitoringHistory(id,'1h',next)));
  after.forEach((h,i) => { assert.equal(h.identity,before[i].identity); assert.equal(h.points.filter(p => p.cpu !== null).length,2); assert(h.points.filter(p => p.cpu !== null).every(p => p.mem >= 0 && p.netIn >= 0)); });
  assert.equal((await metrics.readMonitoringHistory('local::'+old[0],'1h',next)).identity,after[0].identity);
  pass('actual docker ps/stats Local, SSH Remote and discovered SQLite history survives native rm/create IDs');
  // Readiness uses actual Engine API through a socket-path adapter only; no fake inspect/HTTP result.
  const nativeHttp = http.request;
  http.request = function(options,...args) { if (options?.socketPath === '/var/run/docker.sock') options={...options,socketPath:socket}; return nativeHttp.call(this,options,...args); };
  const local = load('lib/local-server.js'), originalInfo = local.getLocalServerInfo;
  local.getLocalServerInfo = () => ({...originalInfo(),host:outer.NetworkSettings.Networks.bridge.IPAddress});
  const backend = cli('run','-d','--name','backend','-p','8080:8080','--health-cmd','node -e "process.exit(0)"','--health-interval','1s','node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());require('http').createServer((q,s)=>{s.statusCode=require('fs').existsSync('/tmp/fail')?503:200;s.end('PRIVATE BODY');}).listen(8080,'0.0.0.0')");
  const readiness = load('lib/app-readiness.js'); let ready;
  await until(async () => { ready=await readiness.checkAppReadiness('local::'+backend); return ready.container.status==='healthy' && ready.backend.status==='verified'; });
  cli('exec',backend,'touch','/tmp/fail'); ready=await readiness.checkAppReadiness('local::'+backend); assert.equal(ready.backend.statusCode,503); assert.equal(ready.container.status,'healthy'); assert(!JSON.stringify(ready).includes('PRIVATE BODY'));
  cli('stop','-t','1',backend); ready=await readiness.checkAppReadiness('local::'+backend); assert.equal(ready.backend.status,'unavailable');
  pass('actual Engine inspect plus HTTP 200/503 and stopped readiness; healthy Docker does not hide HTTP failure');
  http.request=nativeHttp;
  receiver=http.createServer((req,res)=>{let body=''; req.on('data',c=>body+=c); req.on('end',()=>{received.push(JSON.parse(body));res.statusCode=fail?503:204;res.end();});});
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
  await db.notificationChannel.create({data:{id:'channel',name:'Isolated receiver',type:'discord',webhookUrl:'http://127.0.0.1:'+receiver.address().port}});
  await db.alertRule.create({data:{id:'rule',metric:'app_down',operator:'gt',threshold:0,channelId:'channel',serverId:'local',cooldownMin:15}});
  await load('lib/monitoring-scheduler.js').saveMonitoringConfig({enabled:true,intervalSeconds:30});
  const stateKey='monitoring.alert:'+JSON.stringify(['rule','channel','local']);
  const state=async()=>JSON.parse((await db.appSetting.findUnique({where:{key:stateKey}})).value);
  startWorker();
  await until(async()=>{const s=await db.appSetting.findUnique({where:{key:'monitoring.status'}});return s && JSON.parse(s.value).outcome==='ok';});
  assert.equal(received.length,1); assert.equal((await state()).attempts,1); assert.equal((await state()).lastSuccess,0); assert.equal((await db.alertRule.findUnique({where:{id:'rule'}})).lastFiredAt,null);
  await stopWorker(); fail=false; const failedAt=(await load('lib/monitoring-scheduler.js').getMonitoringStatus()).lastCompletedAt;
  startWorker(); await wait(6000); assert.equal(received.length,1,'restart must retain retry/interval');
  await until(async()=>received.length===2,65); await until(async()=> (await state()).active);
  assert((await state()).lastSuccess>failedAt); assert(await db.appSetting.count({where:{key:{startsWith:'monitoring:v1:sample:'}}})>0);
  cli('start',backend);
  await until(async()=>received.length===3,65); await until(async()=>!(await state()).active);
  assert(received[2].embeds[0].title.includes('Recovered'));
  await stopWorker();
  pass('unchanged independent worker actual collectors, real webhook HTTP 503 retry across restart, confirmed success cooldown and recovery');
  // Real signed auth and route export; Next request cookie context is the sole route mock.
  const auth=load('lib/auth.js'); await db.user.create({data:{id:'viewer',username:'viewer',passwordHash:'unused',role:'VIEWER',serverAccessMode:'SELECTED'}});
  token=await auth.createSessionToken('viewer','viewer','VIEWER');
  const headers=require('next/headers'); const originalCookies=headers.cookies; headers.cookies=async()=>({get:()=>token?{value:token}:undefined});
  const routeFile=path.join(runtime,'metrics-route.cjs');
  let code=ts.transpileModule(fs.readFileSync(path.join(root,'src/app/api/apps/[id]/metrics/route.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  code=code.replace(/require\(["']@\/([^"']+)["']\)/g,(_,id)=>'require('+JSON.stringify(path.join(runtime,id+'.js'))+')'); fs.writeFileSync(routeFile,code);
  const route=require(routeFile), {NextRequest}=require('next/server'), context={params:Promise.resolve({id:'managed'})}, request=new NextRequest('http://fixture/metrics?range=1h');
  const rows=await db.appSetting.findMany({orderBy:{key:'asc'}});
  assert.equal((await route.GET(request,context)).status,403); await db.userServerAccess.create({data:{userId:'viewer',serverId:'local'}});
  assert.equal((await route.GET(request,context)).status,200); assert.equal((await route.GET(request,{params:Promise.resolve({id:'remote-app'})})).status,403);
  await db.userServerAccess.deleteMany({where:{userId:'viewer'}}); assert.equal((await route.GET(request,context)).status,403); token=''; assert.equal((await route.GET(request,context)).status,401);
  assert.deepEqual(await db.appSetting.findMany({orderBy:{key:'asc'}}),rows); headers.cookies=originalCookies;
  pass('real signed scoped/revoked/anonymous metrics route reads leave private SQLite unchanged; Next cookies injected, no browser mounted');
  console.log(JSON.stringify({evidence,boundaries:['SSH fixture runs actual shell on same host, not external VPS','socket path and Local IP fixture adapters','Next cookies injection; no browser mounted','real isolated Discord-format HTTP receiver, not public provider','TLS covered separately by check-conf3-tls-runtime.cjs; not exercised here']}));
 } finally {
  await stopWorker(); for(const child of children) child.kill('SIGKILL');
  if(receiver) { receiver.closeAllConnections(); await new Promise(r=>receiver.close(r)); } for (const client of clients) client._sock.destroy(); if(ssh) await new Promise(r=>ssh.close(r)); if(db) await db.$disconnect();
  if(registry.engine){const outer=JSON.parse(docker(['inspect',registry.engine]))[0];assert.equal(outer.Config.Labels['mon5.runtime.owner'],owner);docker(['rm','-f','-v',registry.engine]);assert.throws(()=>docker(['inspect',registry.engine]));for(const volume of registry.volumes)assert.throws(()=>docker(['volume','inspect',volume]));}
  fs.rmSync(scratch,{recursive:true,force:true}); assert(!fs.existsSync(scratch)); console.log('PASS exact owned Engine/volumes/processes/receiver/SSH/private SQLite/runtime scratch cleanup');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
