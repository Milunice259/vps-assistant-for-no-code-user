// Native disposable proxy + resource acceptance; only an explicitly authorized isolated Engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');
const { load } = require('./safe-env-recreate-regression.cjs');
const engineName = process.env.CONF3_ROUTING_ENGINE;
assert(['vps-conf3-integrated-local-engine', 'vps-conf3-integrated-remote-engine'].includes(engineName), 'Set CONF3_ROUTING_ENGINE to the parent-authorized isolated Engine name');
assert.equal(process.env.CONF3_ROUTING_AUTHORIZED, '1', 'Obtain parent approval, then set CONF3_ROUTING_AUTHORIZED=1');
const outer = JSON.parse(execFileSync('docker', ['inspect', engineName], { encoding: 'utf8' }))[0];
assert.equal(outer.Name, '/' + engineName); assert.match(outer.Config.Image, /^docker:29-dind$/);
const mount = outer.Mounts.find(m => m.Destination === '/var/run');
assert.equal(mount?.Name, engineName.replace('-engine', '-socket'));
const socket = mount.Source + '/docker.sock'; assert(fs.statSync(socket).isSocket());
const cli = (...args) => execFileSync('docker', ['--host', 'unix://' + socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const inspect = id => JSON.parse(cli('inspect', id))[0];
const name = 'conf3-routing2-' + process.pid;
const label = 'conf3-routing2.owner=' + name;
const owned = new Set(); const network = name + '-net';
const rows = new Map();
process.env.ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
const crypto = load('src/lib/crypto.ts');
const env = load('src/lib/env-profile.ts', { '@/lib/crypto': crypto });
const prisma = { app: { findUnique: async () => null }, appSetting: { findUnique: async ({ where }) => rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null, create: async ({ data }) => { assert(!rows.has(data.key)); rows.set(data.key, data.value); }, updateMany: async ({ where, data }) => { if (rows.get(where.key) !== where.value) return { count: 0 }; rows.set(where.key, data.value); return { count: 1 }; } }, $transaction: async fn => { const before = new Map(rows); try { return await fn(prisma); } catch(e) { rows.clear(); for(const [k,v] of before)rows.set(k,v); throw e; } } };
const local = { isLocalServer: id => id === 'local', getLocalServerInfo: () => ({ host: '127.0.0.1' }) };
const transport = { request: (options, callback) => { assert.equal(options.socketPath, '/var/run/docker.sock'); return http.request({ ...options, socketPath: socket }, callback); } };
const helper = load('src/lib/container-recreate.ts', { 'node:http': transport, '@/lib/db': { prisma }, '@/lib/env-profile': env, '@/lib/crypto': crypto, '@/lib/local-server': local, '@/lib/ssh': {} });
const routing = load('src/lib/app-routing.ts', { '@/lib/container-recreate': helper, '@/lib/db': { prisma }, '@/lib/local-server': local });
const configuration = load('src/lib/app-configuration.ts', { '@/lib/app-routing': routing, '@/lib/container-recreate': helper, '@/lib/db': { prisma }, '@/lib/env-profile': env });
async function poll(fn) { let error; for(let i=0;i<30;i++) { try { return fn(); } catch(e) { error=e; await new Promise(r=>setTimeout(r,500)); } } throw error; }
async function run() {
 let proxy;
 try {
  // Transfer the already-installed native image; no pull/install and no production container writes.
  try { cli('image', 'inspect', 'traefik:v3.6.1'); } catch {
   const transfer = spawnSync('bash', ['-o', 'pipefail', '-c', `docker image save traefik:v3.6.1 | docker --host ${JSON.stringify('unix://' + socket)} image load`], { encoding: 'utf8', maxBuffer: 1024*1024 });
   assert.equal(transfer.status,0, transfer.stderr);
  }
  cli('network','create','--label',label,network);
  proxy = cli('run','-d','--name',name+'-proxy','--label',label,'--network',network,'-v','/var/run/docker.sock:/var/run/docker.sock:ro','traefik:v3.6.1','--providers.docker=true','--providers.docker.exposedbydefault=false','--entrypoints.web.address=:80'); owned.add(proxy);
  const serverCode = "process.on('SIGTERM',()=>process.exit());require('http').createServer((req,res)=>res.end('conf3-routing2-native-ok')).listen(8080,'0.0.0.0')";
  let id = cli('run','-d','--name',name+'-app','--label',label,'--network',network,'--memory','64m','--cpus','0.25','--restart','on-failure:2','--log-driver','json-file','--log-opt','max-size=5m','--log-opt','max-file=2','--health-cmd','true','--health-interval','1s','--health-timeout','1s','--cap-drop','NET_RAW','--security-opt','no-new-privileges','-e','FIXTURE_SECRET=conf3-routing2-private','node:20-alpine','node','-e',serverCode); owned.add(id);
  const original = inspect(id);
  let appId='local::'+id; let view = await configuration.configurationView(appId);
  const p=view.routing.proxies.find(p=>p.id===proxy); assert.equal(p?.supported,true);
  const domain='127.0.0.1.sslip.io';
  const desired={...view.runtime,cpuLimit:0.5,memoryLimit:80,domain,routing:{proxyId:proxy,backendPort:8080,entrypoint:'web',resolver:null,network}};
  const preview=await configuration.previewConfiguration(appId,view.revision,'apply',desired);
  assert.equal(preview.routingCheck.dns.verified,true);
  const result=await configuration.applyConfiguration(appId,preview.token,preview.confirmation); owned.add(result.newContainerId);
  id=result.newContainerId;appId=result.newAppId;
  const actual=inspect(id); assert.equal(actual.HostConfig.NanoCpus,500000000);assert.equal(actual.HostConfig.Memory,80*1048576);
  assert.deepEqual(actual.Config.Env,original.Config.Env);assert.deepEqual(actual.Config.Cmd,original.Config.Cmd);assert.deepEqual(actual.HostConfig.CapDrop,original.HostConfig.CapDrop);assert.deepEqual(actual.HostConfig.SecurityOpt,original.HostConfig.SecurityOpt);
  assert.equal(inspect(original.Id).State.Running,false);assert.equal(Object.keys(inspect(original.Id).NetworkSettings.Networks).length,0);
  assert.equal(result.routing.nativeConfigurationVerified,true);assert.equal(result.routing.activeProxy,'unverified');assert.equal(result.routing.tls,'not_requested');
  await poll(()=>assert.equal(cli('exec',proxy,'wget','-qO-','--header','Host: '+domain,'http://127.0.0.1:80/'),'conf3-routing2-native-ok'));
  view=await configuration.configurationView(appId);assert.equal(view.runtime.domain,domain);assert.equal(view.saved.domain,domain);assert.equal(view.runtime.routing.backendPort,8080);
  // An unrelated foreign route survives update and owner-route removal.
  const target=await helper.envTarget(appId);
  try { const nativeRoute=await routing.routingReadback(target,id,domain,desired.routing);assert.equal(nativeRoute.nativeConfigurationVerified,true); } finally { await target.api.close(); }
  const edit=await configuration.previewConfiguration(appId,view.revision,'apply',{...view.runtime,cpuLimit:0.6});
  const changed=await configuration.applyConfiguration(appId,edit.token,edit.confirmation);owned.add(changed.newContainerId);id=changed.newContainerId;appId=changed.newAppId;
  await poll(()=>assert.equal(cli('exec',proxy,'wget','-qO-','--header','Host: '+domain,'http://127.0.0.1:80/'),'conf3-routing2-native-ok'));
  view=await configuration.configurationView(appId);
  const removal=await configuration.previewConfiguration(appId,view.revision,'apply',{...view.runtime,domain:null,routing:null});
  const removed=await configuration.applyConfiguration(appId,removal.token,removal.confirmation);owned.add(removed.newContainerId);
  const final=inspect(removed.newContainerId);assert(!final.Config.Labels['vps-assistant.routing-owner']);assert(!final.Config.Labels['traefik.enable']);assert(!final.Config.Labels['traefik.docker.network']);
  console.log('CONF04 native isolated Engine passed: actual Traefik capability discovery; live DNS; CPU/memory plus owned domain/port replacement; native readback; actual HTTP proxy route; repeated edit with retained originals; exact route removal/default restore');
 } finally {
  // Each exact fixture ID has its immutable owner label; never scan/remove by prefix.
  for(const raw of rows.values()){const state=JSON.parse(raw);if(state.current)owned.add(state.current);if(state.recovery){const recovery=env.decodeEncryptedVars(state.recovery);for(const n of [recovery.backupName,recovery.candidateName])try{owned.add(inspect(n).Id);}catch{}}}
  for(const id of owned){try{const i=inspect(id);assert.equal(i.Config.Labels['conf3-routing2.owner'],name);cli('rm','-f',id);}catch(e){if(!String(e.message).includes('No such'))throw e;}}
  for(const id of owned)assert.throws(()=>cli('inspect',id));
  try{assert.equal(JSON.parse(cli('network','inspect',network))[0].Labels['conf3-routing2.owner'],name);cli('network','rm',network);}catch(e){if(!String(e.message).includes('not found'))throw e;}
  console.log('CONF04 exact registered proxy/app/recovery/network cleanup verified; parent fixtures untouched');
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
