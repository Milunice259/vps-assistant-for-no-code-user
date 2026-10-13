const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./safe-env-recreate-regression.cjs');
process.env.ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
const crypto = load('src/lib/crypto.ts');
const env = load('src/lib/env-profile.ts', { '@/lib/crypto': crypto });
const rows = new Map();
let commitFault = false, fault = null, hit = false;
const prisma = { app: { findUnique: async () => null }, appSetting: { findUnique: async ({ where }) => rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null, create: async ({ data }) => { assert(!rows.has(data.key)); rows.set(data.key, data.value); }, updateMany: async ({ where, data }) => { if (rows.get(where.key) !== where.value) return { count: 0 }; rows.set(where.key, data.value); return { count: 1 }; } }, $transaction: async fn => { const saved = new Map(rows); try { const result = await fn(prisma); if (commitFault) throw Error('owned metadata failure'); return result; } catch (e) { rows.clear(); for (const [k,v] of saved) rows.set(k,v); throw e; } } };
const intercepted = { request(options, callback) { const inject = fault && !hit && fault(options); if (inject) hit = true; return http.request(inject ? { ...options, path: '/version', method: 'GET' } : options, res => { if (inject) res.statusCode = 500; callback(res); }); } };
const helper = load('src/lib/container-recreate.ts', { 'node:http': intercepted, '@/lib/db': { prisma }, '@/lib/env-profile': env, '@/lib/crypto': crypto, '@/lib/local-server': { isLocalServer: id => id === 'local' }, '@/lib/ssh': {} });
const routing = load('src/lib/app-routing.ts', { '@/lib/container-recreate': helper, '@/lib/db': { prisma }, '@/lib/local-server': { isLocalServer: id => id === 'local', getLocalServerInfo: () => ({ host: '127.0.0.1' }) } });
const configuration = load('src/lib/app-configuration.ts', { '@/lib/app-routing': routing, '@/lib/container-recreate': helper, '@/lib/env-profile': env, '@/lib/db': { prisma } });
// Owned resource checks do not edit domains; omit routing rather than silently changing native foreign routes.
const resourceSettings = runtime => { const { domain, routing, ...settings } = runtime; void domain; void routing; return settings; };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const inspect = id => JSON.parse(docker('inspect', id))[0];
const owned = new Set(), networks = [];
const name = `conf34-config-${process.pid}`;
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR, 'conf34-config-'));
const volume = name + '-data';
fs.writeFileSync(path.join(scratch, 'sentinel'), 'conf34 exact owned fixture');
function preserve(a, b) { assert.deepEqual(b.Config.Env, a.Config.Env); assert.deepEqual(b.Config.Cmd, a.Config.Cmd); assert.deepEqual(b.Config.Entrypoint, a.Config.Entrypoint); assert.deepEqual(b.HostConfig.CapDrop, a.HostConfig.CapDrop); assert.deepEqual(b.HostConfig.SecurityOpt, a.HostConfig.SecurityOpt); const mounts = i => i.Mounts.map(m => [m.Type,m.Source,m.Destination,m.RW]).sort((a,b) => a[2].localeCompare(b[2])); assert.deepEqual(mounts(b), mounts(a)); }
async function run() {
 try {
  for (const suffix of ['a','b','c']) { const net = name + '-' + suffix; docker('network', 'create', net); networks.push(net); }
  docker('volume','create',volume);
  let id = docker('run','-d','--name',name,'--network',networks[0],'--mount',`type=volume,source=${volume},target=/data`,'--mount',`type=bind,source=${scratch},target=/fixture,readonly`,'--memory','64m','--cpus','0.25','--restart','on-failure:2','--cap-drop','NET_RAW','--security-opt','no-new-privileges','--log-driver','json-file','--log-opt','max-size=5m','--log-opt','max-file=2','--health-cmd','true','--health-interval','1s','--health-timeout','1s','-e','FIXTURE_SECRET=conf34-private-sentinel','node:20-alpine','node','-e',"process.on('SIGTERM',()=>process.exit());setInterval(()=>{},1000)"); owned.add(id);
  docker('network','connect','--alias','conf34-alias',networks[1],id);
  const original = inspect(id);
  let appId = 'local::' + id;
  let view = await configuration.configurationView(appId);
  const adoption = await configuration.previewConfiguration(appId, view.revision, 'adopt', view.runtime);
  await configuration.applyConfiguration(appId, adoption.token, adoption.confirmation);
  assert.equal(inspect(id).Id,id); assert.equal(inspect(id).State.Running,true);
  view = await configuration.configurationView(appId); assert.equal(view.adopted,true); assert.equal(view.runtime.cpuLimit,0.25);
  assert(![...rows.values()].join('').includes('conf34-private-sentinel'));
  const settings = { ...resourceSettings(view.runtime), cpuLimit:0.5,memoryLimit:80,restartPolicy:'unless-stopped',maximumRetryCount:0,logMaxSize:'8m',logMaxFiles:3,healthCheck:'test -r /fixture/sentinel',ports:[],networks:[networks[1],networks[2]] };
  // New port uses a kernel-assigned currently free loopback port; Engine collision still fails safely.
  const net = require('node:net'); const server = net.createServer(); await new Promise(r => server.listen(0,'127.0.0.1',r)); const port = server.address().port; await new Promise(r=>server.close(r)); settings.ports=[{hostIp:'127.0.0.1',hostPort:port,containerPort:8080,protocol:'tcp'}];
  let preview = await configuration.previewConfiguration(appId,view.revision,'apply',settings);
  const applied = await configuration.applyConfiguration(appId,preview.token,preview.confirmation); owned.add(applied.newContainerId);
  id = applied.newContainerId; appId = applied.newAppId;
  const current = inspect(id); preserve(original,current);
  assert.equal(current.HostConfig.NanoCpus,500000000); assert.equal(current.HostConfig.Memory,80*1048576); assert.equal(current.HostConfig.RestartPolicy.Name,'unless-stopped'); assert.equal(current.HostConfig.LogConfig.Config['max-size'],'8m'); assert.equal(current.HostConfig.LogConfig.Config['max-file'],'3'); assert.equal(current.HostConfig.PortBindings['8080/tcp'][0].HostPort,String(port)); assert.deepEqual(Object.keys(current.NetworkSettings.Networks).sort(),[networks[1],networks[2]].sort()); assert(current.NetworkSettings.Networks[networks[1]].Aliases.includes('conf34-alias')); assert.equal(current.State.Health.Status,'healthy'); assert.equal(inspect(original.Id).State.Running,false);
  view = await configuration.configurationView(appId); assert.equal(view.saved.cpuLimit,0.5); assert.equal(view.saved.memoryLimit,80); assert.equal(view.runtime.cpuLimit,0.5); assert.equal(view.runtime.memoryLimit,80);
  console.log('CONF34 live inspected adoption + CPU/memory/restart/health/logging/loopback ports/network apply/readback passed');
  console.log('CONF34 preserved env/startup/security/bind sentinel/volume/aliases; stopped original retained');
  for (const scenario of ['create','start','metadata']) {
   const prior = inspect(id), saved = view.saved;

   preview = await configuration.previewConfiguration(appId,view.revision,'apply',{...resourceSettings(view.runtime),cpuLimit:0.75,networks:[networks[0]]});
   hit = false; fault = scenario==='create' ? o=>o.path.startsWith('/containers/create') : scenario==='start' ? o=>o.path.endsWith('/start')&&!o.path.includes(id) : null; commitFault=scenario==='metadata';
   await assert.rejects(()=>configuration.applyConfiguration(appId,preview.token,preview.confirmation),/original runtime and profile metadata were restored/);
   if (scenario!=='metadata') assert(hit);
   fault=null;commitFault=false;
   const restored=inspect(id); preserve(prior,restored); assert.deepEqual(helper.createPayload(restored,restored.Config.Env),helper.createPayload(prior,prior.Config.Env)); assert.equal(restored.State.Running,true);
   view=await configuration.configurationView(appId); assert.deepEqual(view.saved,saved); assert.equal(view.pending,false);
   console.log('CONF34 live rollback/readback passed: '+scenario);
  }
  preview = await configuration.previewConfiguration(appId,view.revision,'apply',view.runtime);
  docker('update','--cpus','0.6',id);
  await assert.rejects(()=>configuration.applyConfiguration(appId,preview.token,preview.confirmation),/stale/);
  assert.equal(inspect(id).HostConfig.NanoCpus,600000000);
  console.log('CONF34 real runtime revision drift rejected before replacement');
  docker('update','--cpus','0.5',id);
  let mutations=0;
  await assert.rejects(()=>helper.withEnvTarget(appId,async target=>{
    const call=target.api.call;target.api.call=async(method,...args)=>{if(method!=='GET')mutations++;return call(method,...args);};
    docker('rename',id,name+'-external');
    return helper.replaceTarget(target,target.inspect.Config.Env,await helper.listTargetProfiles(target),target.state.baseline,null,false);
  }),/original runtime and profile metadata were restored/);
  assert.equal(mutations,0,'name drift must reject before first Engine mutation');
  assert.equal(inspect(id).Name,'/'+name+'-external');docker('rename',id,name);
  console.log('CONF34 final native identity/name drift rejected before first Engine mutation');
 } finally {
  // Resolve only exact registered fixture name plus encrypted recovery names.
  const names = [name]; for(const raw of rows.values()){const s=JSON.parse(raw); if(s.current)owned.add(s.current); if(s.recovery){const r=env.decodeEncryptedVars(s.recovery);names.push(r.backupName,r.candidateName);}}
  for(const n of names)try{owned.add(inspect(n).Id);}catch{}
  for(const id of owned){try{assert(inspect(id).Name.startsWith('/'+name));docker('rm','-f',id);}catch(e){if(!String(e.message).includes('No such'))throw e;}}
  for(const id of owned)assert.throws(()=>docker('inspect',id));
  for(const n of networks)docker('network','rm',n);
  try{docker('volume','rm',volume);}catch{}
  fs.rmSync(scratch,{recursive:true});
  console.log('CONF34 exact disposable containers/networks/volume/scratch removed');
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
