// Run: node scripts/check-action-truth.cjs — offline, no VPS/DB calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, Error, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  } }, { filename: file });
  return exports;
}
function fixture(kind, id, action, readback, options = {}) {
  const commands = [], audits = [];
  let closed = 0;
  const execute = command => {
    commands.push(command);
    if (/is-active|is-enabled|docker inspect/.test(command)) {
      if (readback instanceof Error) throw readback;
      return readback;
    }
    if (options.commandError) throw new Error('Command rejected');
    return options.silentFailure ? 'command rejected' : `command output${command.includes('__ACTION_COMPLETED__') ? '\n__ACTION_COMPLETED__' : ''}`;
  };
  const ssh = { connect: async () => {}, exec: async command => execute(command), close: async () => { closed++; } };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '@/lib/auth': { getSession: async () => options.unauthenticated ? null : { sub: 'user', username: 'User', role: 'OWNER' } },
    '@/lib/server-access': { canAccessServer: async () => !options.denied },
    '@/lib/operation-safety': { requireSafeModeOff: (_, body) => body.safeModeOff === true ? null : { body: { success: false }, status: 423 } },
    '@/lib/operation-result': load('src/lib/operation-result.ts', {}),
    '@/lib/local-server': { execOnHost: execute, execLocal: execute, isLocalServer: value => value === 'local' },
    '@/lib/db': { prisma: { server: { findUnique: async () => ({ host: 'fixture', username: 'root' }) } } },
    '@/lib/crypto': { decrypt: value => value },
    '@/lib/safe-error': { safeErrorMessage: (_, fallback) => fallback },
    '@/lib/audit': { auditLog: async entry => audits.push(entry), getClientIp: () => '127.0.0.1' },
    'ssh2-promise': class { constructor() { return ssh; } },
    '@/lib/server-ssh': { connectToServer: async () => ({ ssh }), isDisconnectedError: () => false },
    '@/lib/ssh': {
      executeCommand: async (_, command) => execute(command),
      closeSSH: async connection => { if (connection) await connection.close(); },
    },
    '@/lib/validation': load('src/lib/validation.ts', {}),
  };
  const route = load(`src/app/api/servers/[id]/${kind}/action/route.ts`, mocks);
  const body = { action, safeModeOff: !options.locked, ...(kind === 'services' ? { service: 'fixture.service' } : { containerId: 'fixture' }), ...options.body };
  return { commands, audits, closed: () => closed, run: () => route.POST({ json: async () => body }, { params: Promise.resolve({ id }) }) };
}
function checkAudit(f, data) {
  assert.equal(f.audits.length, 1);
  const evidence = JSON.parse(f.audits[0].details);
  assert.equal(evidence.verified, data.verified);
  assert.equal(evidence.outcome, data.outcome);
  return evidence;
}
for (const id of ['local', 'remote']) {
  test(`${id}: services verify the expected property per action`, async () => {
    for (const [action, expected, property] of [['start', 'active', 'is-active'], ['restart', 'active', 'is-active'], ['stop', 'inactive', 'is-active'], ['enable', 'enabled', 'is-enabled'], ['disable', 'disabled', 'is-enabled']]) {
      const f = fixture('services', id, action, expected);
      const { body } = await f.run();
      assert.equal(body.data.verified, true, action);
      assert.equal(body.data.outcome, 'verified', action);
      assert.match(f.commands[1], new RegExp(property), action);
      assert.match(body.data.output, new RegExp(expected));
      checkAudit(f, body.data);
      assert.equal(f.closed(), id === 'remote' ? 1 : 0);
    }
  });
  test(`${id}: services do not verify mismatches, unknowns, or failed readback`, async () => {
    for (const [action, status, outcome] of [['restart', 'failed', 'failed'], ['stop', 'active', 'failed'], ['enable', 'disabled', 'failed'], ['disable', 'enabled', 'failed'], ['enable', 'static', 'failed'], ['enable', 'enabled-runtime', 'failed'], ['stop', 'failed', 'failed'], ['restart', '', 'unverified'], ['restart', 'unknown', 'unverified'], ['restart', new Error('readback offline'), 'unverified']]) {
      const f = fixture('services', id, action, status);
      const { body, status: httpStatus } = await f.run();
      assert.equal(httpStatus, 200, 'completed command has an operation result');
      assert.equal(body.data.verified, false);
      assert.equal(body.data.outcome, outcome);
      assert.doesNotMatch(body.data.message, /successfully/i);
      assert.match(body.data.message, /command completed/i);
      checkAudit(f, body.data);
    }
  });
  test(`${id}: Docker start/restart requires running, stop requires exited`, async () => {
    for (const action of ['start', 'stop', 'restart']) {
      for (const status of ['running', 'exited', 'restarting', 'dead']) {
        const f = fixture('docker', id, action, JSON.stringify({ Status: status, Health: { Status: 'healthy' } }));
        const { body } = await f.run();
        assert.equal(body.data.verified, status === (action === 'stop' ? 'exited' : 'running'), `${action}: ${status}`);
        assert.equal(body.data.outcome, body.data.verified ? 'verified' : 'failed');
        assert.match(body.data.output, new RegExp(status));
        checkAudit(f, body.data);
      }
    }
  });
  test(`${id}: running is not application readiness; health is explicit`, async () => {
    for (const health of ['absent', 'healthy', 'starting', 'unhealthy', 'unknown']) {
      const state = { Status: 'running', ...(health === 'absent' ? {} : { Health: { Status: health } }) };
      const f = fixture('docker', id, 'restart', JSON.stringify(state));
      const { body } = await f.run();
      assert.equal(body.data.verified, true, 'lifecycle readback verified');
      assert.equal(body.data.health, health);
      assert.match(body.data.message, health === 'absent' ? /no health check|readiness.*unverified/i : new RegExp(health));
      assert.equal(checkAudit(f, body.data).health, health);
    }
  });
  test(`${id}: failed/malformed Docker readback preserves completed command evidence`, async () => {
    for (const readback of ['', 'bad JSON', 'null', '{}', '{"Status":"invented"}', new Error('offline')]) {
      const f = fixture('docker', id, 'restart', readback);
      const { body, status } = await f.run();
      assert.equal(status, 200);
      assert.equal(body.data.verified, false);
      assert.equal(body.data.outcome, 'unverified');
      assert.match(body.data.message, /command completed/i);
      assert.match(body.data.output, /unknown|unavailable|readback/i);
      checkAudit(f, body.data);
    }
  });
  test(`${id}: auth/scope/Safe Mode/input denials never execute; command failure is not verified`, async () => {
    for (const kind of ['services', 'docker']) {
      for (const options of [{ unauthenticated: true }, { denied: true }, { locked: true }, { body: { action: 'inject' } }, { body: kind === 'services' ? { service: 'x; touch bad' } : { containerId: 'x; touch bad' } }, { body: kind === 'services' ? { service: '--help' } : { containerId: '--help' } }, { body: kind === 'services' ? { service: {} } : { containerId: {} } }]) {
        const f = fixture(kind, id, 'restart', '', options);
        const result = await f.run();
        assert.ok(result.status >= 400);
        assert.equal(f.commands.length, 0);
        assert.equal(f.audits.length, 0);
      }
      if (id === 'remote') {
        const f = fixture(kind, id, 'restart', 'active', { silentFailure: true });
        assert.equal((await f.run()).body.success, false, 'silent remote nonzero has no completion marker');
        assert.equal(f.commands.length, 1);
      }
      const f = fixture(kind, id, 'restart', '', { commandError: true });
      assert.equal((await f.run()).body.success, false);
      assert.equal(f.commands.length, 1);
    }
  });
}
test('remote completion markers require zero exit (fake shell functions only)', async () => {
  const { spawnSync } = require('node:child_process');
  for (const kind of ['services', 'docker']) {
    const f = fixture(kind, 'remote', 'restart', kind === 'services' ? 'active' : '{"Status":"running"}');
    await f.run();
    const command = f.commands[0].replace(/^(systemctl|docker)/, 'fixture_command');
    for (const exit of [0, 1]) {
      const result = spawnSync('sh', ['-c', `fixture_command() { return ${exit}; }; ${command}`], { encoding: 'utf8' });
      assert.equal(result.stdout.trim().endsWith('__ACTION_COMPLETED__'), exit === 0);
    }
  }
});
function handler(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let code;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) code = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(code, name);
  return code.startsWith('async function') ? code : `const ${code};`;
}
test('list consumers display evidence and never label unverified/unknown/failed results green', async () => {
  for (const [file, name, args] of [
    ['src/components/servers/ServiceList.tsx', 'handleServiceAction', ['fixture.service', 'restart']],
    ['src/components/servers/DockerContainerList.tsx', 'handleAction', ['fixture', 'restart']],
  ]) {
    for (const data of [undefined, { message: 'Unknown' }, { message: 'Verified flag but unknown outcome', verified: true }, { message: 'Mismatch', verified: false, outcome: 'failed' }, { message: 'Readback unavailable', verified: false, outcome: 'unverified' }, { message: 'Running, no health check', verified: true, outcome: 'verified', health: 'absent' }, { message: 'Running, starting', verified: true, outcome: 'verified', health: 'starting' }, { message: 'Running, unhealthy', verified: true, outcome: 'verified', health: 'unhealthy' }, { message: 'Verified', verified: true, outcome: 'verified', ...(name === 'handleAction' ? { health: 'healthy' } : {}) }]) {
      const results = [], requests = [];
      const code = ts.transpileModule(`${handler(file, name)}\n${name}(...args);`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
      await vm.runInNewContext(code, {
        Error, args, serverId: 'local', safeMode: false, actionLoading: null,
        fetch: async (_, options) => { requests.push(options); return { ok: true, json: async () => ({ success: true, data }) }; },
        setActionLoading() {}, setActionResult: value => { if (value) results.push(value); },
        fetchServices: async () => {}, fetchContainers: async () => {}, alert: message => { throw new Error(`Unexpected alert: ${message}`); },
      });
      assert.equal(JSON.parse(requests[0].body).safeModeOff, true);
      assert.equal(results.length, 1, `${name}: missing result feedback`);
      const green = data?.verified === true && data?.outcome === 'verified' && (name !== 'handleAction' || data.health === 'healthy');
      assert.equal(results[0].tone === 'success', green, `${name}: ${data?.message}`);
      if (data) assert.ok(results[0].message.includes(data.message));
    }
  }
});
