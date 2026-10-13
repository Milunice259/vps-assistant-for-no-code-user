const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    if (name in mocks) return mocks[name];
    throw Error(`Unexpected import ${name}`);
  }, Date, console, Error }, { filename: file });
  return module.exports;
}
const helper = load('src/lib/apps-inventory.ts');
const full = 'a'.repeat(64);
const observed = helper.parseInventory(`${full}\tnginx\timage\trunning`, 'docker', 'r1', 'Remote', '2026-01-01T00:00:00Z');
assert.equal(observed[0].status, 'RUNNING');
assert.throws(() => helper.parseInventory('malformed', 'docker', 'r1', 'Remote', 'now'));
assert.throws(() => helper.parseInventory('nginx.service', 'systemd', 'r1', 'Remote', 'now'));
const stored = { ...observed[0], id: 'db-id', containerId: full.slice(0, 12), domain: 'kept.test' };
assert.equal(helper.mergeInventory([stored], observed).length, 1);
assert.equal(helper.mergeInventory([stored], observed)[0].id, 'db-id');
assert.equal(helper.mergeInventory([{ ...stored, serverId: 'r2' }], observed).length, 2);
assert.equal(helper.mergeInventory([{ ...stored, containerId: null }], observed).length, 2);
assert.equal(helper.mergeInventory([stored, { ...stored, id: 'ambiguous' }], observed).length, 3);
assert.equal(helper.parseInventory('nginx.service loaded active running Web\nssh.service loaded active running SSH', 'systemd', 'r1', 'Remote', 'now').length, 1);
let session = { sub: 'actor', role: 'VIEWER' }, allowed = true, localAllowed = false;
let connections = 0, commands = 0, reads = 0, closes = 0, mode = 'success';
const server = { id: 'r1', name: 'Remote', host: 'test.invalid', port: 22, username: 'test', isActive: true, updatedAt: new Date(0) };
const dbApp = { ...stored, server: { name: 'Remote' }, status: 'RUNNING', createdAt: new Date(0) };
const queries = [];
const route = load('src/app/api/apps/route.ts', {
  '@/lib/apps-inventory': helper,
  // ponytail: no adopted settings here; real encrypted projection has check-conf3-projection.cjs.
  '@/lib/app-configuration-projection': { projectAppConfiguration: async apps => apps },
  '@/lib/app-access': { authorizeServer: async () => null },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/server-access': { scopedServerWhere: async () => ({ id: { in: allowed ? ['r1'] : [] } }), canAccessServer: async (_u, _r, id) => id === 'local' ? localAllowed : allowed },
  'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers }) } },
  '@/lib/db': { prisma: {
    app: { findMany: async (q) => { reads++; queries.push(q); return allowed ? [dbApp] : []; } },
    server: { findMany: async () => { reads++; return allowed ? [server] : []; } },
  } },
  '@/lib/crypto': { decrypt: () => { throw Error('Unexpected credential decryption'); } },
  '@/lib/local-server': {
    execLocal: (command) => {
      assert.ok(localAllowed, 'No unauthorized local probe');
      return command.startsWith('docker inspect') ? 'traefik.http.routers.app.rule=Host(`live.test`)' : `${full}\tnginx\timage\trunning`;
    },
    execOnHost: (command) => {
      assert.ok(localAllowed, 'No unauthorized host probe');
      assert.equal(command, helper.SERVICE_INVENTORY_COMMAND);
      return 'nginx.service loaded active running Web';
    },
  },
  '@/lib/ssh': {
    createSSHConnection: async () => { connections++; if (mode === 'offline') throw Error('offline'); return {}; },
    executeCommand: async (_ssh, command) => {
      commands++; assert.ok(command.includes("&& printf '\\n__APPS_INVENTORY_OK__\\n'"));
      if (mode === 'silent-failure') return '';
      if (command.startsWith('docker')) return mode === 'empty' ? '__APPS_INVENTORY_OK__' : `${full}\tnginx\timage\trunning\n__APPS_INVENTORY_OK__`;
      return mode === 'partial' ? '' : 'nginx.service loaded active running Web\n__APPS_INVENTORY_OK__';
    },
    closeSSH: async () => { closes++; if (mode === 'cleanup') throw Error('cleanup'); },
  },
});
const get = (query = '') => route.GET({ nextUrl: new URL(`https://panel.invalid/api/apps${query}`) });
(async () => {
  session = null; assert.equal((await get()).status, 401); assert.equal(reads, 0);
  session = { sub: 'actor', role: 'VIEWER' };
  let result = await get(); assert.equal(connections, 0); assert.equal(result.body.data[0].status, 'UNKNOWN'); assert.equal(result.body.inventory[0].reachable, null);
  result = await get('?liveRemote=true&serverId=r1');
  assert.equal(connections, 1); assert.equal(commands, 2); assert.equal(closes, 1);
  assert.equal(result.body.data.length, 2); assert.equal(result.body.data[0].id, 'db-id'); assert.equal(result.body.data[0].status, 'RUNNING');
  assert.equal(result.body.inventory[0].enabled, true); assert.equal(result.body.inventory[0].reachable, true);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  result = await get(); assert.equal(connections, 1); assert.equal(result.body.data.length, 2); assert.equal(result.body.data[0].inventorySource, 'cached'); assert.equal(result.body.data[0].status, 'UNKNOWN'); assert.equal(result.body.inventory[0].reachable, null);
  mode = 'partial'; result = await get('?liveRemote=true'); assert.equal(result.body.inventory[0].systemd, 'unavailable'); assert.equal(result.body.data.find(a => a.appSource === 'systemd').status, 'UNKNOWN'); assert.equal(result.body.data[0].status, 'RUNNING');
  mode = 'offline'; result = await get('?liveRemote=true'); assert.equal(result.body.inventory[0].reachable, false); assert.ok(result.body.data.every(a => a.status === 'UNKNOWN'));
  mode = 'silent-failure'; result = await get('?liveRemote=true'); assert.equal(result.body.inventory[0].docker, 'unavailable');
  mode = 'empty'; result = await get('?liveRemote=true'); assert.equal(result.body.inventory[0].docker, 'available'); assert.equal(result.body.data.length, 2); // stored Docker plus observed service
  mode = 'cleanup'; result = await get('?liveRemote=true'); assert.equal(result.status, 200); assert.equal(result.body.data[0].status, 'RUNNING');
  server.isActive = false; const previous = connections; result = await get('?liveRemote=true'); assert.equal(connections, previous); assert.equal(result.body.inventory[0].enabled, false); assert.equal(result.body.data.length, 1);
  server.isActive = true; server.updatedAt = new Date(1); result = await get(); assert.equal(result.body.inventory[0].source, 'stored');
  allowed = false; const before = reads; result = await get('?serverId=r1&liveRemote=true'); assert.equal(result.status, 403); assert.equal(reads, before);
  result = await get(); assert.equal(result.body.data.length, 0); assert.equal(result.body.inventory.length, 0);
  assert.ok(queries.some(q => q.where.OR?.[0]?.serverId?.in?.[0] === 'r1'));
  localAllowed = true;
  result = await get();
  assert.equal(result.body.data.length, 2);
  assert.equal(result.body.data[0].serverId, 'local');
  assert.equal(result.body.data[0].domain, 'live.test');
  assert.equal(queries.at(-1).where.OR[1].serverId, 'local');
  result = await get('?serverId=local'); assert.equal(connections, previous);
  console.log('PASS canonical identities, strict parsers, scoped cached/live inventory, partial/offline/empty/cleanup, disabled/revision/revoked access');
})().catch(error => { console.error(error); process.exitCode = 1; });
