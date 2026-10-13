const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../src/lib');
function load(name, mocks) {
  const exports = {};
  let source = fs.readFileSync(path.join(root, name + '.ts'), 'utf8');
  if (name === 'notification-checks' && process.env.MON5_OBSERVATION_NEGATIVE === 'zero') source = source.replaceAll('...(appDown !== undefined ? { app_down: appDown } : {})', 'app_down: appDown ?? 0');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id in mocks ? mocks[id] : require(id), Date, Error, console }, { filename: name + '.ts' });
  return exports;
}
const ids = { backup: 'a'.repeat(64), active: 'b'.repeat(64), similar: 'a'.repeat(63) + 'b' };
let inventory = '', available = true, services = [], domains = [], ssl = '', encrypted = null, remote = false, decryptFails = false;
const observed = [];
const host = { cpu: { usagePercent: 1 }, memory: { usagePercent: 2 }, disk: { usagePercent: 3 } };
const db = {
  server: { findMany: async () => remote ? [{ id: 'remote', name: 'Remote', createdAt: new Date() }] : [] },
  app: { findMany: async () => domains.map(domain => ({ domain })) },
  deploymentLog: { findMany: async ({ where }) => { assert.equal(where.serverId, remote ? 'remote' : null); return encrypted ? [{ id: 'deployment' }] : []; } },
  appSetting: { findUnique: async () => encrypted ? { value: encrypted } : null },
  $queryRawUnsafe: async () => [],
};
const deployment = load('deployment-state', { '@/lib/db': { prisma: db }, '@/lib/crypto': { decrypt: value => { if (decryptFails) throw Error('invalid ciphertext'); return value; } }, '@/lib/container-recreate': {} });
function run(command) {
  if (command.includes('docker ps')) { assert.match(command, /--no-trunc/); if (inventory instanceof Error) throw inventory; return inventory; }
  assert.match(command, /openssl/);
  if (ssl instanceof Error) throw ssl;
  return ssl;
}
const checks = load('notification-checks', {
  '@/lib/db': { prisma: db },
  '@/lib/local-server': { isLocalServer: id => id === 'local', getLocalServerInfo: () => ({ id: 'local', name: 'Local' }), execLocal: run, getLocalServices: () => ({ available, services }) },
  '@/lib/ssh': { closeSSH: async () => {}, executeCommand: async (_, command) => run(command), getRemoteStats: async () => host, getRemoteServices: async () => { if (!available) throw Error('unavailable'); return services; } },
  '@/lib/server-ssh': { connectToServer: async () => ({ ssh: {} }) },
  '@/lib/stats': { getHostStats: () => host },
  '@/lib/notifications': { evaluateAlertRules: async (stats, _, id) => observed.push({ stats, id }) },
  '@/lib/server-access': { canAccessServer: async () => remote ? false : true, scopedServerWhere: async () => ({}), normalizeRole: role => role, roleRank: { ADMIN: 2, MANAGER: 1 }, adminRoles: new Set(['ADMIN']) },
  '@/lib/apps-inventory': load('apps-inventory', {}),
  '@/lib/deployment-state': deployment,
});
const line = (id, state, name = 'app') => `${id}\t${name}\tfixture:latest\t${state}`;
const complete = (...lines) => lines.join('\n') + '\nMON5_DOCKER_OK\n';
async function cycle() {
  observed.length = 0;
  await checks.runNotificationChecks({ sub: 'fixture', role: 'ADMIN' });
  assert.equal(observed.length, 1);
  return observed[0].stats;
}
async function main() {
  for (remote of [false, true]) {
    inventory = complete(line(ids.active, 'exited'));
    available = true; services = [{ name: 'docker', activeState: 'failed' }];
    domains = ['fixture.example']; ssl = 'notAfter=' + new Date(Date.now() - 86400000).toUTCString();
    let stats = await cycle();
    assert.equal(stats.app_down, 1); assert.equal(stats.service_down, 1); assert.equal(stats.ssl_expiring, 1);
    for (const failure of [Error('daemon unavailable'), '', 'malformed\nMON5_DOCKER_OK', complete(line(ids.active.slice(0, 12), 'exited'))]) {
      inventory = failure; available = false; ssl = Error('TLS failed');
      stats = await cycle();
      for (const metric of ['app_down', 'service_down', 'ssl_expiring']) assert.ok(!Object.hasOwn(stats, metric), `${metric}: unavailable must not emit recovery zero`);
      assert.equal(stats.offline, 0, 'optional failed probes do not claim host offline');
    }
    inventory = complete(); available = true; services = []; domains = []; encrypted = null;
    stats = await cycle();
    for (const metric of ['app_down', 'service_down', 'ssl_expiring']) assert.equal(stats[metric], 0, 'successful empty observations permit recovery');
    encrypted = 'enc:v1:' + JSON.stringify({ version: 1, deploymentId: 'deployment', serverId: remote ? 'remote' : 'local', definition: { kind: 'compose' }, runtime: { containerIds: [ids.active] }, retained: [{ inspect: { Id: ids.backup } }] });
    inventory = complete(line(ids.backup, 'exited', 'backup'), line(ids.active, 'running'), line(ids.similar, 'exited', 'backup-lookalike'));
    stats = await cycle(); assert.equal(stats.app_down, 1, 'only exact encrypted retained ID is excluded');
    encrypted = encrypted.replace(remote ? '"serverId":"remote"' : '"serverId":"local"', '"serverId":"foreign"');
    assert.equal((await cycle()).app_down, 2, 'foreign server binding cannot exclude container');
    decryptFails = true; assert.ok(!Object.hasOwn(await cycle(), 'app_down'), 'unreadable retention cannot become recovery'); decryptFails = false; encrypted = null;
    console.log(`PASS ${remote ? 'remote' : 'local'} actual-source observations: missing metrics preserve incidents, empty recovery, exact retained IDs, encrypted binding`);
  }
  assert.equal(await checks.countExpiringSsl([], async () => { throw Error(); }), 0);
  for (const output of ['', 'notAfter=invalid']) assert.equal(await checks.countExpiringSsl(['fixture.example'], async () => output), undefined);
  assert.equal(await checks.countExpiringSsl(['fixture.example'], async () => { throw Error(); }), undefined);
  let calls = 0;
  assert.equal(await checks.countExpiringSsl(['bad;echo'], async () => { calls++; return ''; }), undefined); assert.equal(calls, 0);
  assert.equal(await checks.countExpiringSsl(['good.example', 'bad.example'], async domain => domain === 'good.example' ? 'notAfter=' + new Date(Date.now() - 86400000).toUTCString() : ''), undefined, 'partial inventory cannot manufacture aggregate recovery');
  assert.equal(await checks.countExpiringSsl(Array.from({ length: 21 }, (_, i) => `d${i}.example`), async () => 'notAfter=' + new Date(Date.now() + 30 * 86400000).toUTCString()), undefined);
  console.log('PASS SSL failed/invalid/partial/bounded observations omitted; empty inventory zero; invalid domains never executed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
