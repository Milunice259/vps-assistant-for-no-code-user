// Run: node scripts/check-remote-git-truth.cjs — actual helper + route; offline executor/auth/DB mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, Error, console, require: name => {
    assert(Object.hasOwn(dependencies, name), `Unmocked import: ${name}`);
    return dependencies[name];
  } }, { filename: file });
  return module.exports;
}
const validation = load('src/lib/validation.ts');
const input = { repoUrl: 'https://github.com/example/check.git', branch: 'main', customPath: '/opt/apps/check', serverId: 'remote-a', safeModeOff: true, envVars: 'TOKEN=REMOTE_TRUTH_SECRET' };
// Match executeCommand's stdout.trim(), including silent-success marker-only output.
const marker = '\n__VPS_DEPLOY_OK__';
const healthy = [{ Service: 'web', State: 'running', Health: 'healthy' }];
function fixture(kind) {
  const commands = [];
  const execute = async (_ssh, command) => {
    commands.push(command);
    if (command.includes("__PANEL_DEPLOY_EXIT_")) return require("./check-guided-deploy.cjs").output(command);
    if (command.includes('mkdir -p')) return kind === 'mkdir-failed' ? '' : marker.trim();
    if (command.includes('test -d')) return kind === 'pull-failed' ? 'exists' : 'missing';
    if (command.includes('git clone')) return kind === 'clone-failed' ? '' : marker;
    if (command.includes('git fetch')) return kind === 'pull-failed' ? 'fetch failed' : marker;
    if (command.includes('git rev-parse')) return kind === 'commit-invalid' ? 'not-a-hash' : 'abc123\n';
    if (command.includes('base64 -d')) {
      if (kind === 'env-throws') throw new Error(command + input.envVars);
      return kind === 'env-failed' ? '' : marker;
    }
    if (command.includes('test -f')) return kind === 'no-compose' ? 'none' : kind === 'probe-unavailable' ? '' : 'found';
    if (command.includes('compose up')) return kind === 'compose-failed' ? 'build failed' : marker;
    if (command.includes('config --services')) return kind === 'config-unavailable' ? '' : `web${marker}`;
    if (command.includes('compose ps')) {
      if (kind === 'readback-throws') throw new Error('readback unavailable');
      if (kind === 'readback-unavailable') return '';
      if (kind === 'readback-malformed') return `not-json${marker}`;
      let rows = healthy;
      if (kind === 'state-failed') rows = [{ Service: 'web', State: 'exited', Health: '' }];
      if (kind === 'health-failed') rows = [{ Service: 'web', State: 'running', Health: 'unhealthy' }];
      if (kind === 'health-starting') rows = [{ Service: 'web', State: 'running', Health: 'starting' }];
      if (kind === 'health-absent') rows = [{ Service: 'web', State: 'running', Health: '' }];
      if (kind === 'health-missing') rows = [{ Service: 'web', State: 'running' }];
      if (kind === 'state-failed-health-missing') rows = [{ Service: 'web', State: 'exited' }];
      if (kind === 'state-unknown') rows = [{ Service: 'web', State: '', Health: 'healthy' }];
      if (kind === 'service-mismatch') rows = [{ Service: 'other', State: 'running', Health: 'healthy' }];
      if (kind === 'replica-failed') rows = [...healthy, { Service: 'web', State: 'exited', Health: '' }];
      if (kind === 'empty-state') rows = [];
      const output = kind === 'ndjson' ? rows.map(row => JSON.stringify(row)).join('\n') : JSON.stringify(rows);
      return output + marker;
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const helper = load('src/lib/ssh/actions.ts', { './connection': { executeCommand: execute, executeCommandSafe: execute }, '../validation': validation });
  let row;
  let session = { sub: 'alice', role: 'ADMIN' }, allowed = true;
  const reply = (body, options = {}) => ({ body, status: options.status || 200 });
  const route = load('src/app/api/deploy/route.ts', {
    'next/server': { NextResponse: { json: reply } },
    '@/lib/db': { prisma: { server: { findUnique: async () => ({ id: input.serverId }) }, deploymentLog: {
      create: async ({ data }) => (row = { ...data, id: 'fixture', commitHash: null, createdAt: new Date() }),
      update: async ({ data }) => (row = { ...row, ...data }),
    } } },
    '@/lib/crypto': { encrypt: value => value, decrypt: value => value },
    '@/lib/deployer': { prepareDeployment: () => assert.fail('No local analysis'), cleanupDeployDir: () => assert.fail('No local cleanup'), pruneOldDeployments: () => assert.fail('No local pruning') },
    '@/lib/server-ssh': { connectToServer: async () => ({ ssh: {} }), isDisconnectedError: () => false },
    '@/lib/deploy-preflight': require('./check-guided-deploy.cjs').load('src/lib/deploy-preflight.ts'),
    '@/lib/ssh': { ...helper, executeCommand: execute, closeSSH: async () => {} },
    '@/lib/validation': validation, '@/lib/sanitize': { sanitizeLogs: value => value },
    '@/lib/auth': { getSession: async () => session }, '@/lib/permissions': { can: role => role === 'ADMIN' },
    '@/lib/server-access': { canAccessServer: async () => allowed, scopedServerWhere: async () => ({}) },
    '@/lib/operation-safety': { requireSafeModeOff: (_action, body) => body.safeModeOff === true ? null : reply({ success: false }, { status: 423 }) },
  });
  return { helper, commands, route, row: () => row, deny: mode => { if (mode === 'auth') session = null; if (mode === 'role') session.role = 'VIEWER'; if (mode === 'scope') allowed = false; } };
}
async function main() {
  const cases = {
    'no-compose': ['PREPARED', true], 'probe-unavailable': ['UNVERIFIED', true],
    'mkdir-failed': ['FAILED', false], 'clone-failed': ['FAILED', false], 'pull-failed': ['FAILED', false],
    'commit-invalid': ['FAILED', false], 'env-failed': ['FAILED', false], 'env-throws': ['FAILED', false], 'compose-failed': ['FAILED', false],
    'state-failed': ['FAILED', false], 'health-failed': ['FAILED', false], 'service-mismatch': ['FAILED', false], 'replica-failed': ['FAILED', false], 'empty-state': ['FAILED', false],
    'config-unavailable': ['UNVERIFIED', true], 'readback-unavailable': ['UNVERIFIED', true], 'readback-malformed': ['UNVERIFIED', true], 'readback-throws': ['UNVERIFIED', true],
    'health-starting': ['UNVERIFIED', true], 'health-absent': ['UNVERIFIED', true], 'health-missing': ['UNVERIFIED', true], 'state-unknown': ['UNVERIFIED', true], 'state-failed-health-missing': ['FAILED', false],
    healthy: ['RUNNING', true], ndjson: ['RUNNING', true],
  };
  let failed = 0;
  for (const [kind, [status, success]] of Object.entries(cases)) {
    try {
      const direct = fixture(kind);
      const result = await direct.helper.remoteDeployViaSSH({}, input.repoUrl, input.branch, input.customPath, input.envVars);
      const throughRoute = fixture(kind);
      const response = await throughRoute.route.POST({ json: async () => input });
      assert.equal(response.body.data.status, status, `${kind}: API lifecycle`);
      assert.equal(result.status, status, `${kind}: helper lifecycle`);
      assert.equal(result.success, success, `${kind}: helper execution`);
      assert.equal(throughRoute.row().status, status, `${kind}: persisted lifecycle`);
      assert.equal(response.body.success, success);
      assert.equal(response.status, success ? 201 : 500);
      for (const secret of [input.envVars, 'REMOTE_TRUTH_SECRET', Buffer.from(input.envVars).toString('base64'), 'base64 -d']) {
        assert(!result.logs.includes(secret)); assert(!JSON.stringify(response).includes(secret));
      }
      if (['mkdir-failed', 'clone-failed', 'pull-failed', 'commit-invalid', 'env-failed', 'env-throws'].includes(kind)) assert(!direct.commands.some(cmd => cmd.includes('compose')));
      if (kind === 'no-compose') assert.match(result.logs, /not deployed/i);
      if (kind.startsWith('health-')) assert.match(result.logs, /health|readiness/i);
      console.log(`PASS ${kind}: real helper + route => ${status}`);
    } catch (error) { failed++; console.error(`FAIL ${kind}: ${error.message}`); }
  }
  for (const mode of ['auth', 'role', 'scope', 'ack']) {
    const test = fixture('healthy');
    test.deny(mode);
    const response = await test.route.POST({ json: async () => ({ ...input, ...(mode === 'ack' ? { safeModeOff: 'true' } : {}) }) });
    assert.equal(response.status, mode === 'auth' ? 401 : mode === 'ack' ? 423 : 403);
    assert.equal(test.commands.length, 0); assert.equal(test.row(), undefined);
  }
  const { spawnSync } = require('node:child_process');
  const shell = fixture('healthy');
  await shell.helper.remoteDeployViaSSH({}, input.repoUrl, input.branch, input.customPath, input.envVars);
  for (const command of shell.commands.filter(command => command.includes('__VPS_DEPLOY_OK__'))) {
    // Shell syntax exercised with fake functions; .env redirection goes only to /dev/null.
    const disposable = command.replace('> "/opt/apps/check/.env"', '> /dev/null');
    for (const exit of [0, 1]) {
      const functions = ['mkdir', 'git', 'base64', 'docker'].map(name => `${name}() { return ${exit}; };`).join(' ');
      const output = spawnSync('/bin/sh', ['-c', `cd() { return 0; }; ${functions} ${disposable}`], { encoding: 'utf8' });
      assert.equal(output.stdout.includes('__VPS_DEPLOY_OK__'), exit === 0);
    }
  }
  // Real installed executor rejects any stderr, even normal successful Git progress.
  const { EventEmitter } = require('node:events');
  const SSHConnection = require('ssh2-promise/lib/sshConnection').default;
  for (const exit of [0, 1]) {
    let fetches = 0;
    const native = {
      connect: async () => {},
      sshConnection: { exec(command, _options, callback) {
        const stream = new EventEmitter(); stream.stderr = new EventEmitter();
        callback(null, stream);
        queueMicrotask(() => {
          const disposable = command.replace('> "/opt/apps/check/.env"', '> /dev/null');
          const functions = `cd() { return 0; }; mkdir() { return 0; }; base64() { return 0; }; git() { case "$1" in fetch) echo 'normal fetch progress' >&2; return ${exit};; rev-parse) echo abc123;; *) return 0;; esac; }; docker() { case "$*" in *'config --services'*) echo web;; *'ps --all'*) printf '%s\\n' '${JSON.stringify(healthy)}';; esac; };`;
          const result = spawnSync('/bin/sh', ['-c', `${functions} ${disposable}`], { encoding: 'utf8' });
          if (command.includes('git fetch')) fetches++;
          if (result.stdout) stream.emit('data', result.stdout);
          if (result.stderr) stream.stderr.emit('data', result.stderr);
          stream.emit('close', result.status);
        });
      } },
    };
    const execute = async (_ssh, command) => {
      if (command.includes('test -d')) return 'exists';
      if (command.includes('test -f')) return 'found';
      return (await SSHConnection.prototype.exec.call(native, command)).trim();
    };
    const helper = load('src/lib/ssh/actions.ts', { './connection': { executeCommand: execute, executeCommandSafe: execute }, '../validation': validation });
    const result = await helper.remoteDeployViaSSH({}, input.repoUrl, input.branch, input.customPath, input.envVars);
    assert.equal(fetches, 1);
    assert.equal(result.status, exit === 0 ? 'RUNNING' : 'FAILED', 'Real executor must accept fetch progress but reject nonzero without marker');
  }
  console.log('PASS real ssh2-promise stderr semantics: successful fetch progress accepted, nonzero update rejected.');
  assert.equal(failed, 0, 'Remote Git truth regression failures');
  console.log('PASS auth/role/scope/literal ack deny before executor and DB mutations; generated shell markers reject silent nonzero.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
