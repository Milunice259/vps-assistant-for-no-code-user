const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Error, console, require: name => {
    if (name in mocks) return mocks[name];
    throw Error(`Unexpected import ${name}`);
  } }, { filename: file });
  return module.exports;
}
const inventory = load('src/lib/apps-inventory.ts');
let session = { sub: 'actor', role: 'VIEWER' }, local = false, ids = ['r1'], all = false, unavailable = false, empty = false;
let localReads = 0, dbReads = 0, tick;
const queries = [];
const full = 'a'.repeat(64);
const remote = { id: 'r1', name: 'Remote', isActive: true, updatedAt: new Date(0) };
const match = id => all || ids.includes(id) || (id === 'local' && local);
function checkWhere(where, id) {
  if (where.AND) return where.AND.every(w => checkWhere(w, id));
  if (where.OR) return where.OR.some(w => checkWhere(w, id));
  const condition = 'serverId' in where ? where.serverId : where.id;
  if (condition === undefined) return true;
  if (condition === null || typeof condition === 'string') return id === condition;
  if (condition.in) return condition.in.includes(id);
  if (condition.not) return id !== condition.not;
  throw Error('Unexpected scope');
}
const deployments = [{ serverId: 'r1', status: 'RUNNING' }, { serverId: 'r2', status: 'FAILED' }, { serverId: 'local', status: 'FAILED' }, { serverId: null, status: 'RUNNING' }];
const json = (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers });
const auth = { getSession: async () => session, verifySessionToken: async () => session };
const route = load('src/app/api/dashboard/summary/route.ts', {
  'next/server': { NextResponse: { json } },
  '@/lib/auth': auth,
  '@/lib/apps-inventory': inventory,
  '@/lib/server-access': { canAccessServer: async () => local, scopedServerWhere: async () => all ? {} : { id: { in: ids } } },
  '@/lib/local-server': {
    execLocal: command => { localReads++; assert.ok(local); if (unavailable) throw Error('unavailable');
      if (command === inventory.DOCKER_INVENTORY_COMMAND) return empty ? '' : `${full}\tnginx\timage\trunning`;
      if (command.startsWith('docker ps')) return empty ? '' : 'running';
      assert.equal(command, 'docker network ls --format "{{.Name}}"'); return empty ? '' : 'bridge\nhost'; },
    execOnHost: command => { localReads++; assert.ok(local); if (unavailable) throw Error('unavailable'); assert.equal(command, inventory.SERVICE_INVENTORY_COMMAND); return empty ? '' : 'nginx.service loaded active running Web'; },
    getLocalHostPorts: () => { localReads++; assert.ok(local); if (unavailable) throw Error('unavailable'); return empty ? [] : [{ localPort: 443 }]; },
    readHostFile: () => { localReads++; assert.ok(local); return unavailable ? '' : 'PRETTY_NAME="Host OS"'; },
    tryExecOnHost: () => { localReads++; assert.ok(local); return unavailable ? '' : 'host'; },
  },
  '@/lib/db': { prisma: {
    server: {
      findMany: async q => { dbReads++; queries.push(q); return match('r1') ? [remote] : []; },
      groupBy: async q => { dbReads++; queries.push(q); return match('r1') ? [{ isActive: true, _count: 1 }] : []; },
    },
    app: {
      findMany: async q => { dbReads++; queries.push(q); return [
        { id: 'stored', serverId: 'r1', status: 'RUNNING', containerId: 'b'.repeat(64), createdAt: new Date(0), server: { name: 'Fixture' } },
        { id: 'local-stored', serverId: 'local', status: 'STOPPED', containerId: full.slice(0, 12), createdAt: new Date(0), server: { name: 'Fixture' } },
      ].filter(a => checkWhere(q.where, a.serverId)); },
      groupBy: async () => [{ status: 'RUNNING', _count: 1 }],
    },
    deploymentLog: {
      groupBy: async q => { dbReads++; queries.push(q); return ['RUNNING', 'FAILED'].map(status => ({ status, _count: deployments.filter(d => d.status === status && checkWhere(q.where, d.serverId)).length })); },
      count: async q => { dbReads++; queries.push(q); return deployments.filter(d => checkWhere(q.where, d.serverId)).length; },
    },
  } },
});
const stream = load('src/app/api/dashboard/stream/route.ts', {
  '@/app/api/dashboard/summary/route': route,
  '@/lib/sse-stream': { createSSEResponse: callback => { tick = callback; return { headers: new Map() }; } },
  'next/server': { NextResponse: { json } },
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-token' }) }) },
  '@/lib/auth': auth,
  '@/lib/server-access': { canAccessServer: async () => local },
});
(async () => {
  session = null;
  assert.equal((await route.GET()).status, 401);
  assert.equal((await stream.GET()).status, 401);
  assert.equal(dbReads, 0); assert.equal(localReads, 0);
  session = { sub: 'actor', role: 'VIEWER' };
  let result = await route.GET();
  assert.equal(result.status, 200, 'remote-only summary must not require local access');
  let summary = result.body.data;
  assert.equal(summary.servers.total, 1); assert.equal(summary.servers.active, 1);
  assert.equal(summary.apps.total, 1); assert.equal(summary.apps.running, 0, 'stored status is not a live observation');
  assert.equal(summary.deployments.total, 1);
  assert.equal(summary.containers, null); assert.equal(summary.network, null); assert.equal(summary.os, null);
  assert.equal(localReads, 0);
  inventory.cacheInventory('r1', remote.updatedAt.toISOString(), { apps: [{ id: 'observed', serverId: 'r1', containerId: 'b'.repeat(64), status: 'RUNNING' }, { id: 'service::r1::nginx.service', serverId: 'r1', status: 'RUNNING', appSource: 'systemd' }] });
  summary = await route.getDashboardSummary(session);
  assert.equal(summary.apps.total, 2); assert.equal(summary.apps.running, 0);
  remote.isActive = false;
  summary = await route.getDashboardSummary(session); assert.equal(summary.apps.total, 1); assert.equal(summary.servers.active, 0);
  remote.isActive = true;
  assert.equal((await stream.GET()).headers.get('Cache-Control'), 'private, no-store, no-transform');
  ids = [];
  summary = await tick();
  for (const field of ['servers', 'apps', 'deployments']) assert.ok(Object.values(summary[field]).every(n => n === 0), field);
  assert.equal(localReads, 0);
  local = true;
  summary = await tick();
  assert.equal(summary.servers.total, 1); assert.equal(summary.servers.remote, 0);
  assert.equal(summary.apps.total, 2, 'local container identity merges with tracked app; systemd counted');
  assert.equal(summary.apps.running, 2);
  assert.equal(summary.deployments.total, 2, 'local grant includes legacy null-server deployments');
  assert.equal(summary.network.listeningPorts, 1); assert.equal(summary.network.dockerNetworks, 2);
  assert.equal(summary.os.distro, 'Host OS');
  unavailable = true;
  summary = await tick();
  assert.equal(summary.containers, null); assert.equal(summary.network.listeningPorts, null); assert.equal(summary.network.dockerNetworks, null); assert.equal(summary.os, null);
  assert.equal(summary.apps.total, 1); assert.equal(summary.apps.running, 0);
  unavailable = false; empty = true;
  summary = await tick();
  assert.equal(summary.containers.total, 0); assert.equal(summary.network.listeningPorts, 0); assert.equal(summary.network.dockerNetworks, 0);
  all = true; ids = ['r1']; empty = false;
  summary = await tick(); assert.equal(summary.servers.total, 2); assert.equal(summary.deployments.total, 4);
  local = false; all = false; ids = [];
  const before = localReads;
  summary = await tick(); assert.equal(summary.servers.total, 0); assert.equal(localReads, before);
  session = null;
  await assert.rejects(tick, /Unauthorized/);
  console.log('PASS dashboard auth, remote/empty/local/all scopes, grant refresh, canonical stored/live/cached apps, host ports, unavailable vs empty metrics, SSE token revocation');
})().catch(error => { console.error(error); process.exitCode = 1; });
