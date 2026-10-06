// Offline regression: node scripts/check-guided-operations.cjs. No host/SSH mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function appHandler(name) {
  const file = 'src/app/(panel)/apps/[id]/page.tsx';
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node.getText(tree); ts.forEachChild(node, visit); }
  visit(tree);
  assert.ok(fn, name);
  return ts.transpileModule(`${fn}\n${name}();`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}
async function appMutation(overrides = {}) {
  const calls = [], feedback = [], lock = [], results = [];
  const context = {
    pendingAction: 'restart', safeMode: false, operationBusy: { current: false }, needsReadback: false,
    app: { serverId: 'remote-fixture', containerId: 'container-fixture' }, appId: 'stored-app', navigator: { onLine: true },
    setPendingAction() {}, setActionLoading(value) { calls.push(value); }, setActionError(value) { feedback.push(value); },
    setActionResult(value) { results.push(value); }, setNeedsReadback(value) { lock.push(value); },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, status: 200, json: async () => ({ success: true, data: { message: 'Running; no health check', verified: true, outcome: 'verified', health: 'absent' } }) }; },
    fetchApp: async () => { calls.push('detail'); return true; }, readContainerState: async () => { calls.push('live'); return true; },
    ...overrides,
  };
  await vm.runInNewContext(appHandler('executeAction'), context);
  return { calls, feedback, lock, results, context };
}
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, Error, Date, console, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  } }, { filename: file });
  return exports;
}
const disk = 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 1000 600 400 60% /\nfixture 1000 600 400 60% /\n20 /var/cache/apt/archives\n/usr/bin/apt-get';
async function executor(remote, mode = 'ok') {
  const commands = [];
  const exec = command => {
    commands.push(command);
    if (command.startsWith('nsenter') && command.includes('echo ok')) return 'ok';
    const cleanup = command.includes('apt-get clean');
    if (mode === 'before-fails' && !cleanup) throw new Error('Offline');
    if (mode === 'empty-disk' && !cleanup) return remote ? '__DISK_CHECK_COMPLETED__' : '';
    if (mode === 'cleanup-fails' && cleanup) {
      if (!remote) throw new Error('Command failed');
      return 'failed';
    }
    if (mode === 'after-fails' && commands.filter(c => !c.includes('echo ok')).length === 3) throw new Error('Offline');
    const marker = command.includes('__CACHE_CLEAN_COMPLETED__') ? '__CACHE_CLEAN_COMPLETED__' : '__DISK_CHECK_COMPLETED__';
    if (cleanup) return remote ? marker : '';
    return `${disk}${remote ? `\n${marker}` : ''}`;
  };
  const local = load('src/lib/local-server.ts', { os: {}, child_process: { execSync: exec }, fs: {} });
  const ssh = load('src/lib/ssh/actions.ts', { './connection': { executeCommand: async (_, command) => exec(command) }, '../validation': {} });
  const result = remote ? await ssh.quickAction({}, 'clear-apt-cache') : local.localQuickAction('clear-apt-cache');
  return { result, commands };
}
async function route(options = {}) {
  const calls = [];
  const result = { success: true, output: 'done', operation: { message: 'Cache command completed', risk: 'danger', verified: false, outcome: 'unverified', evidence: { target: '/var/cache/apt/archives', commandCompleted: true, before: disk } } };
  const api = load('src/app/api/servers/[id]/actions/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '@/lib/auth': { getSession: async () => options.noSession ? null : { sub: 'fixture', role: 'MANAGER' } },
    '@/lib/server-access': { canAccessServer: async () => !options.denied },
    '@/lib/operation-safety': { requireSafeModeOff: (action, body) => action === 'clear-apt-cache' && body.safeModeOff !== true ? { status: 423 } : null },
    '@/lib/operation-result': load('src/lib/operation-result.ts', {}),
    '@/lib/safe-error': { safeErrorMessage: (_, fallback) => fallback },
    '@/lib/local-server': { isLocalServer: id => id === 'local', localQuickAction: () => { calls.push('execute'); return result; } },
    '@/lib/server-ssh': { isDisconnectedError: () => false, connectToServer: async () => { calls.push('connect'); return { ssh: {} }; } },
    '@/lib/ssh': { closeSSH: async () => {}, quickAction: async () => { calls.push('execute'); return result; } },
    '@/lib/audit': { getClientIp: () => 'fixture', auditLog: async () => calls.push('audit') },
  });
  const response = await api.POST({ json: async () => ({ action: options.action || 'clear-apt-cache', safeModeOff: options.ack }) }, { params: Promise.resolve({ id: options.id || 'local' }) });
  return { response, calls };
}
(async () => {
  for (const remote of [false, true]) {
    const { result, commands } = await executor(remote);
    assert.equal(result.operation?.verified, true);
    assert.equal(result.operation?.evidence.commandCompleted, true);
    assert.equal(result.operation?.evidence.before, disk);
    assert.equal(result.operation?.evidence.after, disk);
    assert.equal(commands.filter(c => c.includes('apt-get clean')).length, 1);
    assert.doesNotMatch(commands.join('\n'), /autoclean|autoremove|prune|rm -|vacuum|\/tmp/);
    if (remote) {
      const cleanup = commands.find(c => c.includes('apt-get clean'));
      assert.match(cleanup, /2>&1 && printf/);
      // Run generated shell only with fake commands. Never call host apt/sudo.
      for (const code of [0, 1]) {
        const output = execFileSync('/bin/sh', ['-c', `sudo() { printf 'fixture progress\\n' >&2; return ${code}; }; ${cleanup}; :`], { encoding: 'utf8' }).trim();
        assert.equal(output.endsWith('__CACHE_CLEAN_COMPLETED__'), code === 0);
      }
    }
    const afterFailure = await executor(remote, 'after-fails');
    assert.equal(afterFailure.result.operation?.verified, false);
    assert.equal(afterFailure.result.operation?.outcome, 'unverified');
    assert.equal(afterFailure.result.operation?.evidence.commandCompleted, true);
    const beforeFailure = await executor(remote, 'before-fails');
    assert.equal(beforeFailure.commands.some(c => c.includes('apt-get clean')), false);
    const empty = await executor(remote, 'empty-disk');
    assert.equal(empty.result.success, false);
    assert.equal(empty.commands.some(c => c.includes('apt-get clean')), false);
    const cleanupFailure = await executor(remote, 'cleanup-fails');
    assert.equal(cleanupFailure.result.operation?.verified, false);
    assert.notEqual(cleanupFailure.result.operation?.outcome, 'verified');
  }
  for (const id of ['local', 'remote']) {
    const accepted = await route({ id, ack: true });
    assert.equal(accepted.response.body.data.outcome, 'unverified');
    assert.equal(accepted.response.body.data.verified, false);
    assert.equal(accepted.response.body.data.evidence.before, disk);
    for (const options of [{ ack: false }, {}, { noSession: true, ack: true }, { denied: true, ack: true }, { action: 'not-an-action', ack: true }]) {
      const rejected = await route({ id, ...options });
      assert.ok(rejected.response.status >= 400);
      assert.deepEqual(rejected.calls, []);
    }
  }
  for (const guard of [{ safeMode: true }, { operationBusy: { current: true } }, { needsReadback: true }, { pendingAction: null }]) {
    assert.deepEqual((await appMutation(guard)).calls, []);
  }
  const offline = await appMutation({ navigator: { onLine: false } });
  assert.equal(offline.calls.some(call => call && typeof call === 'object'), false);
  assert.match(offline.feedback.join(' '), /offline.*No command/);
  const acceptedApp = await appMutation();
  assert.equal(acceptedApp.calls[1].url, '/api/servers/remote-fixture/docker/action');
  assert.equal(acceptedApp.calls[1].body.containerId, 'container-fixture');
  assert.equal(acceptedApp.calls[1].body.safeModeOff, true);
  assert.deepEqual(acceptedApp.calls.slice(-3), ['detail', 'live', null]);
  const uncertainApp = await appMutation({ fetch: async () => { throw new Error('Offline after submit'); } });
  assert.match(uncertainApp.feedback.join(' '), /Outcome unknown/);
  assert.deepEqual(uncertainApp.lock, [true]);
  const missingReadback = await appMutation({ readContainerState: async () => false });
  assert.deepEqual(missingReadback.lock, [true]);
  assert.equal(missingReadback.results.at(-1).message, 'Running; no health check');
  const safety = source('src/lib/operation-safety.ts');
  assert.match(safety, /"clear-apt-cache"/);
  assert.match(safety, /body.safeModeOff === true/);
  assert.match(safety, /READ_ONLY_ACTIONS = new Set\(\[.*"check-disk"/);
  const app = source('src/app/(panel)/apps/[id]/page.tsx');
  assert.match(app, /\/docker\/action/);
  assert.match(app, /containerId: app.containerId/);
  assert.match(app, /await fetchApp\(true, false\)/);
  assert.match(app, /await readContainerState\(\)/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => fetchApp/);
  assert.match(app, /Outcome unknown/);
  assert.match(app, /ConfirmDialog/);
  const risk = source('src/components/dashboard/RiskOverview.tsx');
  assert.doesNotMatch(risk, /runServerAction|clear-logs|clear-apt-cache|\/api\/backup/);
  assert.match(risk, /"actions" : "overview"/);
  const quick = source('src/components/servers/QuickActions.tsx');
  assert.match(quick, /Check disk/);
  assert.match(quick, /ConfirmDialog/);
  assert.match(quick, /Outcome unknown/);
  assert.doesNotMatch(quick, /\/api\/backup|database snapshot first/);
  console.log('Guided operations regression passed (mock executors only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
