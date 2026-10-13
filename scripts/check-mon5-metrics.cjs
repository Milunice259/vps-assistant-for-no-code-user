// Real private SQLite + Prisma/auth/crypto; only Engine/SSH and Next cookie context are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || '/root/.hermes/cache/scratch', 'mon5-metrics-'));
process.env.DATABASE_URL = 'file:' + path.join(scratch, 'metrics.db');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const prisma = new PrismaClient();
let token = '', offline = false, stopped = false, malformed = false, calls = 0, closes = 0;
const old = 'a'.repeat(64), newer = 'b'.repeat(64), remote = 'c'.repeat(64), untracked = 'd'.repeat(64), replacement = 'e'.repeat(64), retained = 'f'.repeat(64);
let localId = old, slotId = untracked, remoteId = remote;
function engine(server, command) {
 calls++;
 if (offline) throw Error('PRIVATE ENGINE ERROR');
 if (command.startsWith('docker ps ')) return server === 'local' ? `${localId}|managed|${stopped ? 'exited' : 'running'}|||\n${slotId}|slot|running|project|web|1\n${retained}|backup|exited|||` : `${remoteId}|remote|running|||`;
 if (command.startsWith('docker stats ')) return (server === 'local' ? [localId, slotId] : [remoteId]).map(ID => JSON.stringify({ ID, CPUPerc: malformed ? 'NaN%' : '12.5%', MemUsage: '64MiB / 128MiB', NetIO: '2kB / 3kB' })).join('\n');
 throw Error('Unexpected command');
}
const cache = new Map();
const mocks = {
 '@/lib/db': { prisma }, './db': { prisma },
 '@/lib/local-server': { execLocal: command => engine('local', command) },
 '@/lib/ssh': { createSSHConnection: async config => { assert.equal(config.password, 'private-fixture-password'); return { server: config.serverId, close: async () => { closes++; } }; }, executeCommand: async (ssh, command) => engine(ssh.server, command) },
 'next/headers': { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
};
function load(file) {
 file = path.resolve(file);
 if (cache.has(file)) return cache.get(file).exports;
 const module = { exports: {} }; cache.set(file, module);
 const requireFixture = id => {
  if (Object.hasOwn(mocks, id)) return mocks[id];
  if (id.startsWith('@/')) return load(path.join('src', id.slice(2)) + '.ts');
  if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id) + '.ts');
  return require(id);
 };
 const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
 vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename: file })(requireFixture, module, module.exports);
 return module.exports;
}
async function run() {
 execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: process.env, stdio: 'pipe' });
 await prisma.server.createMany({ data: [{ id: 'local', name: 'Local', host: 'fixture', username: 'fixture' }, { id: 'remote', name: 'Remote', host: 'fixture', username: 'fixture', encryptedPass: load('src/lib/crypto.ts').encrypt('private-fixture-password') }] });
 await prisma.app.createMany({ data: [{ id: 'managed', name: 'managed', serverId: 'local', containerId: old, deploymentId: 'deployment' }, { id: 'remote-app', name: 'remote', serverId: 'remote', containerId: remote }] });
 const deploy = load('src/lib/deployment-state.ts');
 await prisma.appSetting.create({ data: { key: deploy.definitionKey('deployment'), value: deploy.sealDeployment({ version: 1, deploymentId: 'deployment', serverId: 'local', definition: { kind: 'image' }, runtime: { appId: 'managed', containerIds: [old] }, retained: [{ inspect: { Id: retained } }] }) } });
 const metrics = load('src/lib/monitoring-metrics.ts');
 const base = new Date('2026-10-13T00:00:00Z');
 assert.deepEqual(await metrics.collectMonitoringMetrics(base), { sampled: 3, gaps: 0, servers: 2 });
 let count = await prisma.appSetting.count({ where: { key: { startsWith: 'monitoring:v1:sample:' } } }); assert.equal(count, 3);
 await metrics.collectMonitoringMetrics(base);
 assert.equal(await prisma.appSetting.count({ where: { key: { startsWith: 'monitoring:v1:sample:' } } }), count);
 const remoteBefore = await metrics.readMonitoringHistory(`discovered::remote::${remote}`, '1h', base);
 localId = newer; slotId = replacement; remoteId = old;
 await prisma.app.update({ where: { id: 'managed' }, data: { containerId: newer } });
 await prisma.app.update({ where: { id: 'remote-app' }, data: { containerId: remoteId } });
 await metrics.collectMonitoringMetrics(new Date(+base + 60000));
 const history = await metrics.readMonitoringHistory('managed', '1h', new Date(+base + 60000));
 assert.equal(history.points.filter(p => p.cpu === 12.5).length, 2);
 assert.equal(history.points.at(-1).mem, 64); assert.equal(history.points.at(-1).netIn, 2000);
 assert.equal((await metrics.readMonitoringHistory(`local::${old}`, '1h', base)).identity, history.identity);
 assert.equal((await metrics.readMonitoringHistory(`local::${newer}`, '1h', base)).identity, history.identity);
 cache.delete(path.resolve('src/lib/monitoring-metrics.ts'));
 const restarted = load('src/lib/monitoring-metrics.ts');
 assert.equal((await restarted.readMonitoringHistory('managed', '1h', new Date(+base + 60000))).identity, history.identity);
 const slotOld = await metrics.readMonitoringHistory(`local::${untracked}`, '1h', base), slotNew = await restarted.readMonitoringHistory(`local::${replacement}`, '1h', new Date(+base + 60000));
 assert.equal(slotOld.identity, slotNew.identity); assert.equal(slotNew.points.filter(p => p.cpu !== null).length, 2);
 const remoteAfter = await metrics.readMonitoringHistory(`discovered::remote::${remoteId}`, '1h', new Date(+base + 60000));
 assert.equal(remoteBefore.identity, remoteAfter.identity); assert.equal(remoteAfter.points.filter(p => p.cpu !== null).length, 2);
 assert.notEqual(remoteAfter.identity, history.identity);
 assert.equal((await metrics.readMonitoringHistory(`local::${retained}`, '1h', base)).identity, null);
 stopped = true;
 await metrics.collectMonitoringMetrics(new Date(+base + 120000));
 assert.equal((await metrics.readMonitoringHistory('managed', '1h', new Date(+base + 120000))).points.at(-1).gap, 'stopped');
 stopped = false; malformed = true;
 await metrics.collectMonitoringMetrics(new Date(+base + 180000));
 assert.equal((await metrics.readMonitoringHistory('managed', '1h', new Date(+base + 180000))).points.at(-1).gap, 'unavailable');
 malformed = false; offline = true;
 await metrics.collectMonitoringMetrics(new Date(+base + 240000));
 const gaps = await metrics.readMonitoringHistory('managed', '1h', new Date(+base + 240000));
 assert.equal(gaps.points.at(-1).gap, 'unavailable'); assert.equal(gaps.points.at(-1).cpu, null);
 assert.equal(gaps.points[0].gap, 'not_collected');
 const auth = load('src/lib/auth.ts');
 await prisma.user.create({ data: { id: 'viewer', username: 'viewer', passwordHash: 'unused', role: 'VIEWER', serverAccessMode: 'SELECTED' } });
 token = await auth.createSessionToken('viewer', 'viewer', 'VIEWER');
 const route = load('src/app/api/apps/[id]/metrics/route.ts');
 const { NextRequest } = require('next/server');
 const request = new NextRequest('http://fixture/api/apps/managed/metrics?range=1h');
 const context = { params: Promise.resolve({ id: 'managed' }) };
 assert.equal((await route.GET(request, context)).status, 403);
 await prisma.userServerAccess.create({ data: { userId: 'viewer', serverId: 'local' } });
 const beforeCalls = calls, beforeRows = await prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
 assert.equal((await route.GET(request, context)).status, 200);
 assert.equal((await route.GET(new NextRequest('http://fixture/metrics?range=__proto__'), context)).status, 400);
 assert.equal((await route.GET(request, { params: Promise.resolve({ id: 'remote-app' }) })).status, 403);
 assert.equal((await route.GET(request, { params: Promise.resolve({ id: `local::${newer}` }) })).status, 200);
 await prisma.userServerAccess.deleteMany({ where: { userId: 'viewer' } });
 assert.equal((await route.GET(request, context)).status, 403);
 token = ''; assert.equal((await route.GET(request, context)).status, 401);
 assert.equal(calls, beforeCalls); assert.deepEqual(await prisma.appSetting.findMany({ orderBy: { key: 'asc' } }), beforeRows);
 await prisma.appMetric.create({ data: { appId: 'managed', cpuUsage: 1, memUsage: 2, timestamp: base } });
 await metrics.collectMonitoringMetrics(new Date(+base + 31 * 86400000));
 assert.equal(await prisma.appMetric.count(), 0);
 assert.equal(await prisma.appSetting.count({ where: { key: { startsWith: 'monitoring:v1:sample:2026-10-13' } } }), 0);
 const long = await metrics.readMonitoringHistory('managed', '30d', new Date(+base + 31 * 86400000));
 assert(long.points.length <= 360); assert(long.points.every(p => p.cpu === null));
 assert(closes > 0);
 assert(!/appMetric\.(create|deleteMany)|dbAppId|tickCount/.test(fs.readFileSync('src/app/api/apps/[id]/stream/route.ts', 'utf8')), 'Browser stream must not persist metrics');
 console.log('MON04 PASS: real isolated SQLite/Prisma; encrypted deployment retention links; Local/Remote/discovered replacement; minute dedupe; explicit gaps; 30-day retention; bounded history; real signed-session scoped/revoked/anonymous reads; no read/stream writes. Engines/SSH mocked explicitly.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); fs.rmSync(scratch, { recursive: true, force: true }); });
