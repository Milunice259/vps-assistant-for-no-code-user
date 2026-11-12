#!/usr/bin/env node
// Actual exported collector/history; only Prisma, Engine/SSH and deployment boundaries mocked.
// No database connection, real Docker, credentials or filesystem writes; shell probes use a fake docker function.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const prefix = 'monitoring:v1:', rows = new Map();
const hash = s => createHash('sha256').update(s).digest('hex');
const alias = id => prefix + 'alias:' + hash(id);
const runtime = n => hash(String(n));
const container = (id, name, state = 'running', labels = ['', '', '']) => [id, name, state, ...labels].join('|');
let apps = [], active = ['remote'], legacy = [], closes = 0;
let shellChecked = false;
const inventories = { local: '', remote: '' }, failures = {}, definitions = new Map();
function matches(value, query) {
  if (typeof query === 'string') return value === query;
  return Object.entries(query).every(([op, rhs]) => {
    if (op === 'startsWith') return value.startsWith(rhs);
    if (op === 'endsWith') return value.endsWith(rhs);
    if (op === 'in') return rhs.includes(value);
    if (op === 'notIn') return !rhs.includes(value);
    if (op === 'lt') return value < rhs;
    if (op === 'gte') return value >= rhs;
    if (op === 'lte') return value <= rhs;
    throw Error('Unhandled predicate ' + op);
  });
}
const selected = where => [...rows].filter(([key, value]) => Object.entries(where || {}).every(([field, query]) => matches({ key, value }[field], query)));
const prisma = {
  server: { findMany: async () => active.map(id => ({ id })) },
  app: { findMany: async () => apps, findUnique: async ({ where }) => apps.find(a => a.id === where.id) || null },
  deploymentLog: { findMany: async () => [...definitions.keys()].map(id => ({ id })) },
  appSetting: {
    findMany: async ({ where }) => selected(where).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value })),
    findUnique: async ({ where }) => rows.has(where.key) ? { value: rows.get(where.key) } : null,
    upsert: async ({ where, create, update }) => rows.set(where.key, rows.has(where.key) ? update.value ?? rows.get(where.key) : create.value),
    deleteMany: async ({ where }) => { const found = selected(where); for (const [key] of found) rows.delete(key); return { count: found.length }; },
  },
  appMetric: {
    findMany: async () => [],
    deleteMany: async ({ where }) => { legacy = legacy.filter(t => t >= where.timestamp.lt); },
  },
  $transaction: async work => typeof work === 'function' ? work(prisma) : Promise.all(work),
};
async function engine(server, command) {
  if (failures[server] === 'offline') throw Error('PRIVATE SSH/ENGINE ERROR');
  if (command.startsWith('docker ps ')) {
    assert(command.endsWith(" && printf '\\n__MONITORING_INVENTORY_OK__\\n'"));
    if (!shellChecked) {
      // Exercise the generated shell and actual execLocal (which trims stdout), without Docker.
      const localFile = path.join(__dirname, '../src/lib/local-server.ts');
      const localModule = { exports: {} };
      const output = ts.transpileModule(fs.readFileSync(localFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      vm.runInThisContext('(function(require,module,exports){' + output + '\n})')(id => id.startsWith('@/') ? {} : require(id), localModule, localModule.exports);
      const exec = localModule.exports.execLocal;
      assert.equal(exec('docker() { return 0; }; ' + command), '__MONITORING_INVENTORY_OK__');
      assert.throws(() => exec('docker() { return 1; }; ' + command));
      const { spawnSync } = require('node:child_process');
      const failed = spawnSync('/bin/sh', ['-c', 'docker() { return 1; }; ' + command], { encoding: 'utf8' });
      assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
      shellChecked = true;
    }
    if (failures[server] === 'silent-nonzero') return '';
    return inventories[server] + '\n__MONITORING_INVENTORY_OK__\n';
  }
  assert(command.startsWith('docker stats '));
  if (failures[server] === 'stats') throw Error('PRIVATE STATS ERROR');
  if (failures[server] === 'malformed-stats') return 'not json';
  return inventories[server].split('\n').filter(Boolean).map(line => JSON.stringify({ ID: line.split('|')[0], CPUPerc: '12.5%', MemUsage: '64MiB / 128MiB', NetIO: '2kB / 3kB' })).join('\n');
}
function load() {
  const module = { exports: {} };
  const mocks = {
    '@/lib/db': { prisma },
    '@/lib/local-server': { execLocal: command => engine('local', command) },
    '@/lib/server-ssh': { connectToServer: async id => {
      if (failures[id] === 'offline') throw Error('PRIVATE SSH ERROR');
      return { ssh: { id, close: async () => { closes++; } } };
    } },
    '@/lib/ssh': { executeCommand: (ssh, command) => engine(ssh.id, command) },
    '@/lib/deployment-state': { readDeploymentDefinition: async id => { if (definitions.get(id) === 'fail') throw Error('PRIVATE DEFINITION ERROR'); return definitions.get(id); } },
  };
  const file = path.join(__dirname, '../src/lib/monitoring-metrics.ts');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename: file })(id => mocks[id] || require(id), module, module.exports);
  return module.exports;
}
const keys = kind => [...rows.keys()].filter(k => k.startsWith(prefix + kind + ':'));
const targets = () => keys('target').map(k => JSON.parse(rows.get(k)));
let metrics = load(), tick = 0;
const base = Date.parse('2026-11-01T00:00:00Z');
const collect = async () => metrics.collectMonitoringMetrics(new Date(base + tick++ * 60000));
const identity = id => rows.get(alias(id));
const sample = id => JSON.parse(rows.get(keys('sample').filter(k => k.endsWith(':' + id)).sort().at(-1)));
(async () => {
  // Both Local runtime spelling conventions, Remote, stored Apps, Compose and deployment slots.
  apps = [{ id: 'app-local', serverId: 'local', containerId: runtime(1), deploymentId: null }, { id: 'app-remote', serverId: 'remote', containerId: runtime(2), deploymentId: null }];
  definitions.set('deploy', { state: { serverId: 'local', runtime: { containerIds: [runtime(5)] }, retained: [{ inspect: { Id: runtime(6) } }] } });
  inventories.local = [container(runtime(1), 'app'), container(runtime(3), 'web', 'running', ['project', 'web', '1']), container(runtime(5), 'image'), container(runtime(6), 'backup', 'exited')].join('\n');
  inventories.remote = [container(runtime(2), 'app'), container(runtime(4), 'discovered')].join('\n');
  assert.deepEqual(await collect(), { sampled: 5, gaps: 0, servers: 2 });
  const local = identity('local::' + runtime(1)), remote = identity('discovered::remote::' + runtime(2));
  const compose = identity('local::' + runtime(3)), discovered = identity('discovered::remote::' + runtime(4)), deployment = identity('local::' + runtime(5));
  assert(local && remote && compose && discovered && deployment);
  assert.equal(identity('discovered::local::' + runtime(3)), compose);
  assert.equal(identity('local::' + runtime(6)), undefined);
  assert.equal(targets().length, 5);
  assert.equal(keys('alias').length, 16);
  metrics = load(); tick--; await collect(); // process restart and same-minute dedup
  assert.equal(keys('sample').length, 5);
  // Replacement preserves identities and historical runtime handles.
  apps[0].containerId = runtime(11); apps[1].containerId = runtime(12);
  definitions.get('deploy').state.runtime.containerIds = [runtime(15)];
  inventories.local = [container(runtime(11), 'app'), container(runtime(13), 'new-name', 'running', ['project', 'web', '1']), container(runtime(15), 'new-image')].join('\n');
  inventories.remote = [container(runtime(12), 'app'), container(runtime(14), 'discovered')].join('\n');
  await collect();
  for (const [handle, expected] of [['local::' + runtime(11), local], ['local::' + runtime(13), compose], ['local::' + runtime(15), deployment], ['discovered::remote::' + runtime(12), remote], ['discovered::remote::' + runtime(14), discovered]]) assert.equal(identity(handle), expected);
  for (const [n, expected] of [[1, local], [3, compose], [5, deployment]]) assert.equal(identity('local::' + runtime(n)), expected);
  for (const [n, expected] of [[2, remote], [4, discovered]]) assert.equal(identity('discovered::remote::' + runtime(n)), expected);
  assert.equal(keys('sample').length, 10); assert.equal(keys('alias').length, 32);
  assert.equal((await metrics.readMonitoringHistory('local::' + runtime(3), '1h', new Date(base + 60000))).points.filter(p => p.cpu !== null).length, 2);
  // Silent nonzero SSH and a mapping failure after valid inventory cannot retire targets.
  failures.remote = 'silent-nonzero';
  await collect(); assert.equal(targets().length, 5); assert.equal(sample(discovered).gap, 'unavailable');
  delete failures.remote;
  const currentContainer = apps[0].containerId;
  Object.defineProperty(apps[0], 'containerId', { configurable: true, get() { throw Error('PRIVATE MAPPING ERROR'); } });
  await collect(); assert.equal(targets().length, 5); assert.equal(sample(compose).gap, 'unavailable');
  Object.defineProperty(apps[0], 'containerId', { configurable: true, writable: true, value: currentContainer });
  assert.equal((await metrics.readMonitoringHistory('local::' + runtime(13), '1h', new Date(base + 60000))).points.filter(p => p.cpu !== null).length, 2);
  // Removal is independent of stats health, and stopped is not removal.
  inventories.local = container(runtime(11), 'app', 'exited');
  failures.remote = 'stats'; inventories.remote = container(runtime(12), 'app');
  await collect();
  assert.equal(targets().length, 2); assert.equal(sample(local).gap, 'stopped'); assert.equal(sample(remote).gap, 'unavailable');
  assert.equal(keys('alias').length, 32);
  const retiredSamples = keys('sample').filter(k => k.endsWith(':' + compose)).length;
  assert(retiredSamples, 'retirement preserves history');
  // Offline and malformed/partial inventory preserve live registry, never resurrect aliases.
  failures.local = 'offline'; failures.remote = 'offline';
  await collect(); assert.equal(targets().length, 2); assert.equal(keys('alias').length, 32);
  assert.equal(keys('sample').filter(k => k.endsWith(':' + compose)).length, retiredSamples);
  delete failures.local; delete failures.remote;
  inventories.local = container(runtime(11), 'app') + '\ntruncated'; inventories.remote = runtime(12) + '|app|running';
  await collect(); assert.equal(targets().length, 2); assert.equal(keys('alias').length, 32);
  // DB-deleted Apps retire even during an outage or a later mapping failure.
  apps = []; failures.remote = 'offline'; definitions.set('failure', 'fail');
  const deletedSamples = keys('sample').length;
  await collect(); assert.equal(targets().length, 0); assert.equal(keys('sample').length, deletedSamples);
  definitions.delete('failure'); delete failures.remote;
  // Existing stored Apps remain missing on empty inventory; only DB-deleted Apps retire.
  apps = [{ id: 'app-local', serverId: 'local', containerId: runtime(11), deploymentId: null }];
  inventories.local = ''; inventories.remote = '';
  await collect(); assert.equal(targets().length, 1); assert.equal(sample(local).gap, 'missing');
  assert.equal(keys('alias').length, 32);
  apps = [];
  // Successful empty inventories retire stored/deleted and discovered targets, not samples.
  const before = keys('sample').length;
  await collect(); assert.equal(targets().length, 0); assert.equal(keys('alias').length, 32); assert.equal(keys('sample').length, before);
  // Same slot rediscovery restores old history; disabling Remote retires only its registry.
  inventories.local = container(runtime(23), 'web', 'running', ['project', 'web', '1']);
  inventories.remote = container(runtime(24), 'discovered'); failures.local = 'malformed-stats';
  await collect(); assert.equal(identity('local::' + runtime(23)), compose); assert.equal(identity('discovered::remote::' + runtime(24)), discovered);
  assert.equal(sample(compose).gap, 'unavailable');
  active = []; inventories.remote = '';
  const remoteRows = [...rows].filter(([k]) => k === alias('discovered::remote::' + runtime(24)) || k.startsWith(prefix + 'sample:') && k.endsWith(':' + discovered));
  await collect(); for (const [k, v] of remoteRows) assert.equal(rows.get(k), v);
  assert(!targets().some(t => t.serverId === 'remote'));
  assert.equal(identity('discovered::remote::' + runtime(24)), discovered);
  // Repeated replacement has bounded registry, retained aliases, one sample per identity/minute.
  delete failures.local;
  for (let n = 30; n < 70; n++) {
    inventories.local = container(runtime(n), 'web', 'running', ['project', 'web', '1']);
    await collect(); assert.equal(targets().length, 1); assert.equal(keys('alias').length, 38 + (n - 29) * 4);
    assert.equal(identity('local::' + runtime(n)), compose);
  }
  active = ['remote']; await collect(); assert.equal(targets().length, 1); assert.equal(keys('alias').length, 198);
  // Global retention applies even to disabled servers, but preserves the exact 30-day boundary.
  const future = new Date(base + 31 * 86400000), cutoff = new Date(+future - 30 * 86400000).toISOString();
  const boundary = prefix + 'sample:' + cutoff + ':' + discovered;
  rows.set(boundary, JSON.stringify({ time: cutoff, cpu: 1 })); legacy = [new Date(base), new Date(cutoff)];
  active = []; await metrics.collectMonitoringMetrics(future);
  assert(rows.has(boundary)); assert.equal(legacy.length, 1);
  assert(keys('sample').every(k => k >= prefix + 'sample:' + cutoff));
  assert(closes > 0);
  console.log('PASS monitoring lifecycle: exported collector/history; Local/Remote running/stopped/offline/deleted/replaced/rediscovered; completion sentinel (actual execLocal/fake shell), silent nonzero and mapping failure; authoritative empty vs malformed inventory; stats failure; disabled Remote registry retirement; historical aliases without resurrection; restart/minute dedup; stable App/Compose/deployment history; retained rollback exclusion; bounded registry cardinality; 30-day retention. Boundaries mocked, no database/Docker touched.');
})().catch(error => { console.error(error); process.exitCode = 1; });
