/* eslint-disable @typescript-eslint/no-require-imports -- Runnable Node regression uses the installed TS compiler. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Error, Date, console: { warn() {} }, require: name => name in mocks ? mocks[name] : require(name) });
  return exports;
}
const inventory = load('src/lib/service-inventory.ts');
const shell = (units, files, unitsExit = 0, filesExit = 0) => execFileSync('sh', ['-c', `systemctl() { case "$1" in list-units) printf '%s\\n' '${units}'; return ${unitsExit};; list-unit-files) printf '%s\\n' '${files}'; return ${filesExit};; esac; }; ${inventory.serviceInventoryCommand}; :`], { encoding: 'utf8' }).trim();
const local = (raw, accessible = true) => load('src/lib/local-server.ts', {
  '@/lib/service-inventory': inventory, '@/lib/host-ports': {},
  child_process: { execSync: command => { if (command.includes('-- echo ok')) { if (!accessible) throw new Error('denied'); return 'ok'; } return raw; } },
}).getLocalServices();
async function main() {
  assert.equal(local('').available, false, 'silent inventory failure is unavailable despite host access');
  assert.equal(local('').hostAccess, true);
  assert.equal(local('', false).available, false);
  const empty = shell('', '');
  assert.equal(local(empty).available, true);
  assert.equal(local(empty).services.length, 0);
  const good = shell('nginx.service loaded active running Web', 'nginx.service disabled enabled');
  assert.equal(local(good).services[0].activeState, 'active');
  assert.equal(local(good).services[0].unitFileState, 'disabled');
  let calls = 0, output = good;
  const remote = load('src/lib/ssh/containers.ts', {
    '@/lib/service-inventory': inventory,
    './connection': { executeCommand: async (_ssh, command) => { calls++; assert.equal(command, inventory.serviceInventoryCommand); return output; } },
  });
  assert.equal((await remote.getRemoteServices({}))[0].unitFileState, 'disabled');
  assert.equal(calls, 1, 'inventory uses a single batch, not per-service calls');
  output = empty;
  assert.equal((await remote.getRemoteServices({})).length, 0);
  for (output of ['', shell('', '', 1), shell('nginx.service loaded active running Web', '', 0, 1)]) {
    await assert.rejects(remote.getRemoteServices({}), /Service inventory unavailable/);
    assert.equal(local(output).available, false);
  }
  let localResult = local(''), remoteFailure = false, closed = 0;
  const route = load('src/app/api/servers/[id]/services/route.ts', {
    '@/lib/auth': { getSession: async () => ({ sub: 'owner', role: 'ADMIN' }) },
    '@/lib/server-access': { canAccessServer: async () => true },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@/lib/server-ssh': { connectToServer: async () => ({ ssh: {} }), isDisconnectedError: () => false },
    '@/lib/local-server': { isLocalServer: id => id === 'local', getLocalServices: () => localResult },
    '@/lib/ssh': { getRemoteServices: async ssh => { if (remoteFailure) throw new Error('Service inventory unavailable'); return remote.getRemoteServices(ssh); }, closeSSH: async () => { closed++; } },
  });
  const get = id => route.GET({}, { params: Promise.resolve({ id }) });
  assert.equal((await get('local')).status, 503);
  assert.equal((await get('local')).body.success, false);
  localResult = local('', false);
  assert.equal((await get('local')).status, 503);
  localResult = local(empty);
  assert.equal((await get('local')).status, 200);
  assert.equal((await get('local')).body.data.length, 0);
  output = empty;
  assert.equal((await get('remote')).body.data.length, 0);
  output = '';
  assert.equal((await get('remote')).status, 503);
  assert.equal((await get('remote')).body.success, false);
  remoteFailure = true;
  assert.equal((await get('remote')).body.success, false);
  assert.ok(closed > 0);
  console.log('PASS DATA services: host-access vs inventory availability, marked empty success, silent/partial failures, active vs enabled, single SSH batch, API unavailable/empty and cleanup');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
