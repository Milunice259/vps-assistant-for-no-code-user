const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const load = (file, mocks = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), Date, Error, URL, console }, { filename: file });
  return module.exports;
};
const full = 'a'.repeat(64), other = 'b'.repeat(64), secret = 'projection-private-fixture';
const key = (serverId, name) => 'safe-env:' + crypto.createHash('sha256').update(JSON.stringify([serverId, '/' + name])).digest('hex');
let rows = [], reads = [], denied = null, updates = 0, targetReads = 0, closes = 0, unavailable = false;
const prisma = {
  appSetting: { findMany: async q => { reads.push(q); return rows.filter(r => q.where.key.in.includes(r.key)); } },
  app: {
    findUnique: async () => stored,
    update: async q => { updates++; return { ...stored, ...q.data }; },
    findMany: async () => [stored],
  },
  server: { findMany: async () => [server] },
  appMetric: { findMany: async () => [] },
};
const helper = load('src/lib/app-configuration-projection.ts', {
  '@/lib/apps-inventory': load('src/lib/apps-inventory.ts'),
  '@/lib/db': { prisma }, '@/lib/env-profile': { decodeEncryptedVars: value => { if (value === 'broken') throw Error(secret); return JSON.parse(value); } },
});
const base = { id: 'db-app', name: 'Stored name', containerId: full, containerName: 'app', serverId: 'remote', serverName: 'Remote', image: 'image', domain: 'stale.test', status: 'STOPPED', createdAt: new Date(0), updatedAt: new Date(0), server: { name: 'Remote' }, cpuLimit: 99, memoryLimit: 999, storageLimit: 100, restartPolicy: 'always', healthCheck: secret, ports: secret, volumes: secret };
let stored = { ...base };
const server = { id: 'remote', name: 'Remote', host: 'remote.invalid', port: 22, username: 'fixture', isActive: true, updatedAt: new Date(0) };
const native = { Id: full, Name: '/app', Config: { Image: 'image', Env: ['PASSWORD=' + secret], Healthcheck: { Test: ['CMD-SHELL', 'echo ' + secret] }, Labels: { 'traefik.http.routers.app.rule': 'Host(`native.test`)' } }, HostConfig: { NanoCpus: 1500000000, CpuQuota: 0, CpuPeriod: 0, Memory: 67108864, RestartPolicy: { Name: 'unless-stopped' }, PortBindings: { '80/tcp': [{ HostIp: '', HostPort: '8080' }] } }, State: { Running: true, Status: 'running', Health: { Status: 'starting' } }, Mounts: [], Created: new Date(0).toISOString() };
const saved = (serverId = 'remote', current = full, settings = { name: 'Adopted name', domain: 'adopted.test', healthCheck: secret, password: secret }) => ({ key: key(serverId, 'app'), value: JSON.stringify({ current, configuration: JSON.stringify({ settings: JSON.stringify(settings), runtime: secret }), baseline: secret }) });
const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } };
const common = { 'next/server': next, '@/lib/db': { prisma }, '@/lib/app-configuration-projection': helper,
  '@/lib/app-access': { authorizeApp: async () => denied, authorizeServer: async () => denied },
  '@/lib/crypto': { decrypt: () => { throw Error('Unexpected secret read'); } },
  '@/lib/ssh': { createSSHConnection: async () => ({}), executeCommand: async (_ssh, cmd) => cmd.startsWith('docker') ? `${full}\tapp\timage\trunning\n__APPS_INVENTORY_OK__` : '__APPS_INVENTORY_OK__', closeSSH: async () => {} },
  '@/lib/local-server': { isLocalAppId: id => id.startsWith('local::'), parseLocalContainerId: id => id.split('::')[1], execLocal: () => '', execOnHost: () => '', tryExecOnHost: () => '', getLocalContainerDetail: () => { throw Error('Do not use incomplete inspect projection'); } },
  '@/lib/container-recreate': { envTarget: async id => { targetReads++; if (unavailable) throw Error(secret); return { inspect: native, serverId: id.startsWith('local::') ? 'local' : 'remote', app: id === 'db-app' ? stored : null, api: { close: async () => { closes++; } } }; } },
};
const detailRoute = load('src/app/api/apps/[id]/route.ts', common);
const inventory = load('src/lib/apps-inventory.ts');
const listRoute = load('src/app/api/apps/route.ts', { ...common, '@/lib/apps-inventory': inventory,
  '@/lib/auth': { getSession: async () => ({ sub: 'actor', role: 'VIEWER' }) },
  '@/lib/server-access': { scopedServerWhere: async () => ({ id: { in: ['remote'] } }), canAccessServer: async (_u, _r, id) => id !== 'local' },
});
const get = (id = 'db-app') => detailRoute.GET({ url: 'https://panel.invalid/api/apps/' + id }, { params: Promise.resolve({ id }) });
const patch = body => detailRoute.PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'db-app' }) });
(async () => {
  const app = { id: base.id, name: base.name, serverId: base.serverId, serverName: base.serverName, containerId: full, containerName: 'app', image: base.image, domain: base.domain, status: base.status, createdAt: base.createdAt.toISOString() };
  rows = [saved(), saved('different-server')]; reads = [];
  let projected = await helper.projectAppConfiguration([app, { ...app, id: 'other', serverId: 'different-server' }]);
  assert.equal(reads.length, 1, 'metadata lookup must be batched');
  assert.equal(projected[0].name, 'Adopted name'); assert.equal(projected[0].domain, 'adopted.test');
  assert.ok(!JSON.stringify(projected).includes(secret));
  for (const candidate of [{ ...app, containerId: full.slice(0, 12) }, { ...app, containerId: other }, { ...app, containerName: 'app-safe-old-' + 'c'.repeat(36) }]) {
    projected = await helper.projectAppConfiguration([candidate]); assert.equal(projected[0].name, app.name);
  }
  rows = [saved('remote', full, { name: 'Keep name', domain: null })];
  projected = await helper.projectAppConfiguration([app]); assert.equal(projected[0].domain, null);
  rows = [saved('remote', other)]; assert.equal((await helper.projectAppConfiguration([app]))[0].name, app.name);
  const fleet = Array.from({ length: 501 }, (_, i) => ({ ...app, serverId: 'fleet-' + i }));
  reads = []; await helper.projectAppConfiguration(fleet);
  assert.equal(reads.length, 2); assert.equal(reads[0].where.key.in.length, 500); assert.equal(reads[1].where.key.in.length, 1);
  reads = []; await helper.projectAppConfiguration([{ ...app, containerId: full.slice(0, 12) }]); assert.equal(reads.length, 0);
  rows = [saved()]; rows[0].value = JSON.stringify({ current: full, configuration: 'broken' });
  assert.equal((await helper.projectAppConfiguration([app]))[0].name, app.name);
  rows = [saved()];
  for (const id of ['db-app', 'discovered::remote::' + full, 'local::' + full]) {
    if (id.startsWith('local')) rows = [saved('local')];
    const result = await get(id); assert.equal(result.status, 200);
    const data = result.body.data;
    assert.equal(data.containerId, full); assert.equal(data.cpuLimit, 1.5); assert.equal(data.memoryLimit, 64); assert.equal(data.storageLimit, null);
    assert.equal(data.restartPolicy, 'unless-stopped'); assert.equal(data.healthCheck, 'starting'); assert.equal(data.status, 'RUNNING');
    assert.equal(data.name, 'Adopted name'); assert.equal(data.domain, 'adopted.test'); assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.equal(targetReads, closes);
  rows = []; native.HostConfig.NanoCpus = 0; native.HostConfig.CpuQuota = 25000; native.HostConfig.CpuPeriod = 100000;
  assert.equal((await get()).body.data.cpuLimit, .25);
  native.HostConfig.CpuQuota = -1; native.HostConfig.Memory = 0;
  assert.equal((await get()).body.data.cpuLimit, null); assert.equal((await get()).body.data.memoryLimit, null);
  rows = [saved()]; stored = { ...base, containerId: full.slice(0, 12), containerName: 'old-name' };
  const beforeTargets = targetReads;
  let result = await listRoute.GET({ nextUrl: new URL('https://panel.invalid/api/apps?liveRemote=true') });
  assert.equal(result.status, 200); assert.equal(result.body.data.length, 1); assert.equal(result.body.data[0].containerId, full);
  assert.equal(result.body.data[0].name, 'Adopted name'); assert.equal(result.body.data[0].domain, 'adopted.test'); assert.equal(targetReads, beforeTargets, 'list must not connect per app');
  unavailable = true; result = await get(); assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes(secret)); unavailable = false;
  stored = { ...base, containerId: null };
  result = await get(); assert.equal(result.body.data.cpuLimit, null); assert.equal(result.body.data.healthCheck, null); assert.equal(result.body.data.status, 'UNKNOWN');
  stored = { ...base };
  for (const field of ['domain', 'cpuLimit', 'memoryLimit', 'storageLimit', 'restartPolicy', 'healthCheck', 'ports', 'networks']) {
    result = await patch({ safeModeOff: true, [field]: null }); assert.equal(result.status, 409);
    assert.ok(result.body.error.includes('/configuration with mode=preview') && result.body.error.includes('mode=apply'));
  }
  assert.equal(updates, 0);
  for (const body of [{ safeModeOff: true }, { safeModeOff: true, name: '' }, { safeModeOff: true, name: 12 }, { safeModeOff: true, arbitrary: true }]) assert.equal((await patch(body)).status, 400);
  assert.equal((await patch({ safeModeOff: true, name: 'Renamed' })).status, 409); assert.equal(updates, 0);
  stored = { ...base, containerId: null };
  assert.equal((await patch({ safeModeOff: true, name: 'Renamed' })).status, 200); assert.equal(updates, 1);
  assert.equal((await patch({ name: 'Renamed' })).status, 423);
  denied = { status: 403 }; const previous = targetReads;
  assert.equal((await get()).status, 403); assert.equal((await patch({ safeModeOff: true, name: 'Rename' })).status, 403); assert.equal(targetReads, previous); assert.equal(updates, 1);
  console.log('PASS CONF03 exact full identity/server binding; batched metadata; live Local/Remote/stored limits and health; no secrets or stale metadata; legacy PATCH rejection/auth');
})().catch(error => { console.error(error); process.exitCode = 1; });
