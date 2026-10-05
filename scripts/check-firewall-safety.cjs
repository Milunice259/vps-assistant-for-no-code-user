// Offline regression: every executor, SSH connection and database read is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let commands, reads, connections, audits, serverPort, session, access, readError;
const json = (body, options = {}) => ({ status: options.status || 200, body });
const mocks = {
  'next/server': { NextResponse: { json } },
  'jose': {}, // JWT grant code is covered by test-advanced-safety.cjs; no grant minting here.
  './permissions': { can: () => false },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/audit': { auditLog: async () => { audits++; }, getClientIp: () => 'test' },
  '@/lib/local-server': {
    isLocalServer: (id) => id === 'local',
    execOnHost: async (command) => { commands.push(command); return '[ 1] 8080/tcp                   DENY IN     Anywhere'; },
  },
  '@/lib/server-access': { canAccessServer: async () => access },
  '@/lib/server-ssh': {
    connectToServer: async () => { connections++; return { ssh: {} }; },
    isDisconnectedError: () => false,
  },
  '@/lib/ssh': {
    executeCommand: async (_ssh, command) => { commands.push(command); return '[ 1] 8080/tcp                   DENY IN     Anywhere'; },
    closeSSH: async () => {},
  },
  '@/lib/db': { prisma: { server: { findUnique: async (query) => {
    reads.push(query);
    if (readError) throw new Error('Mock SSH-port lookup failure');
    return serverPort === null ? null : { port: serverPort };
  } } } },
};
function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
    return mocks[name];
  } }, { filename: relative });
  return module.exports;
}
mocks['@/lib/operation-safety'] = load('src/lib/operation-safety.ts');
mocks['@/lib/operation-result'] = load('src/lib/operation-result.ts');
const route = load('src/app/api/servers/[id]/network/firewall/route.ts');
const valid = { mode: 'dry-run', action: 'block-port', port: 8080, protocol: 'tcp' };
function reset() {
  commands = []; reads = []; connections = 0; audits = 0; serverPort = 2222;
  session = { sub: 'test-user', username: 'test', role: 'OWNER' }; access = true;
  readError = false;
}
const post = (body, id = 'remote', malformed = false) => route.POST({ json: async () => {
  if (malformed) throw new SyntaxError('Invalid JSON');
  return body;
} }, { params: Promise.resolve({ id }) });
let passed = 0;
async function check(name, fn) {
  reset();
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
function noExecutor() {
  assert.equal(commands.length, 0, 'must not execute any command');
  assert.equal(connections, 0, 'must not open SSH');
}
(async () => {
  // Keep this first: it proves the original invalid-mode bypass before the fix.
  await check('invalid mode rejected before executor', async () => {
    const result = await post({ ...valid, mode: 'invalid', port: 22 });
    assert.equal(result.status, 400, 'invalid mode must return 400');
    noExecutor();
  });
  await check('dry-run is an offline read-only preview', async () => {
    const result = await post(valid);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.verified, false);
    assert.match(result.body.data.output, /Would run: ufw deny 8080\/tcp/);
    noExecutor();
    assert.equal(reads.length, 0);
  });
  await check('apply requires explicit acknowledgment', async () => {
    for (const safeModeOff of [undefined, false]) {
      const result = await post({ ...valid, mode: 'apply', safeModeOff });
      assert.equal(result.status, 423);
      noExecutor();
      assert.equal(reads.length, 0);
    }
  });
  await check('port 22 and configured remote SSH port are protected', async () => {
    for (const port of [22, 2222]) {
      for (const protocol of ['tcp', 'udp']) {
        const result = await post({ ...valid, mode: 'apply', safeModeOff: true, port, protocol });
        assert.equal(result.status, 400);
        noExecutor();
      }
    }
    for (const query of reads) {
      assert.equal(JSON.stringify(query.select), JSON.stringify({ port: true }));
      assert.equal(query.where.id, 'remote');
    }
  });
  await check('invalid fields and malformed JSON rejected before executor', async () => {
    const bad = [null, [], 'apply', {},
      ...[undefined, null, '', false, {}, 'APPLY'].map(mode => ({ ...valid, mode })),
      ...[undefined, null, '', false, {}, 'delete', 'block-port; reboot'].map(action => ({ ...valid, action })),
      ...[undefined, null, '', false, {}, 'TCP', 'icmp', 'tcp; reboot'].map(protocol => ({ ...valid, protocol })),
      ...[undefined, null, '', false, {}, [], '8080', 0, -1, 65536, 1.5, NaN, Infinity].map(port => ({ ...valid, port })),
      ...['true', 1, null].map(safeModeOff => ({ ...valid, mode: 'apply', safeModeOff })),
    ];
    for (const body of bad) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
      if (body?.mode === 'dry-run') {
        assert.equal((await post({ ...body, mode: 'apply', safeModeOff: true })).status, 400, JSON.stringify(body));
      }
      noExecutor();
    }
    assert.equal((await post(undefined, 'remote', true)).status, 400);
    assert.equal(reads.length, 0);
    assert.equal(audits, 0);
  });
  await check('unknown remote SSH port fails closed', async () => {
    for (const port of [null, 0, 65536]) {
      serverPort = port;
      const result = await post({ ...valid, mode: 'apply', safeModeOff: true });
      assert.equal(result.status, 409);
      noExecutor();
    }
    readError = true;
    assert.equal((await post({ ...valid, mode: 'apply', safeModeOff: true })).status, 500);
    noExecutor();
  });
  await check('local blocking fails closed without management-port discovery', async () => {
    const result = await post({ ...valid, mode: 'apply', safeModeOff: true }, 'local');
    assert.equal(result.status, 409);
    assert.match(result.body.error, /SSH ports/);
    noExecutor();
  });
  await check('valid apply uses only validated port and protocol', async () => {
    const result = await post({ ...valid, mode: 'apply', safeModeOff: true });
    assert.equal(result.status, 200);
    assert.equal(commands.length, 1);
    assert.match(commands[0], /ufw deny 8080\/tcp/);
    assert.equal(audits, 1);
  });
  await check('allow action and boundary ports remain valid', async () => {
    for (const port of [1, 65535]) {
      const result = await post({ ...valid, port, action: 'allow-port', protocol: 'udp' });
      assert.equal(result.status, 200);
    }
    noExecutor();
    assert.equal((await post({ ...valid, mode: 'apply', action: 'allow-port', port: 22, safeModeOff: true }, 'local')).status, 200);
    assert.equal(commands.length, 1);
    assert.match(commands[0], /ufw allow 22\/tcp/);
  });
  await check('authentication and target scope still deny execution', async () => {
    session = null;
    assert.equal((await post(valid)).status, 401);
    session = { sub: 'test-user', role: 'OWNER' }; access = false;
    assert.equal((await post(valid)).status, 403);
    noExecutor();
  });
  await check('GET rules API remains unchanged', async () => {
    const result = await route.GET({}, { params: Promise.resolve({ id: 'remote' }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.rules.length, 1);
    assert.equal(result.body.data.rules[0].target, '8080/tcp');
    assert.match(commands[0], /ufw status numbered/);
    assert.equal(reads.length, 0);
  });
  console.log(`Firewall safety: ${passed} checks passed (offline mocks only).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
