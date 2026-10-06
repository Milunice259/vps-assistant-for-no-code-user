// Run: node scripts/sec01-cron-terminal-backup-check.cjs
// Route executors, filesystem, auth and audit are mocked: no host commands or DB writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const effects = [];
let session = { sub: 'test-user', role: 'ADMIN' };
let access = true;
let crontab = '\n# task\n* * * * * date\n';
const response = { json: (body, options = {}) => ({ ...body, status: options.status || 200 }) };
let safety;
safety = load('src/lib/operation-safety.ts');
for (const key of ['terminal_execute', 'cron_add', 'cron_delete', 'backup_restore', 'backup_delete']) assert.ok(safety.DANGEROUS_ACTIONS.has(key), `Missing safety registry key ${key}`);
function load(file) {
  const exports = {};
  const mocks = {
    'next/server': { NextResponse: response },
    jose: {},
    './permissions': {},
    '@/lib/auth': { getSession: async () => session },
    '@/lib/server-access': { canAccessServer: async () => access },
    '@/lib/operation-safety': safety,
    '@/lib/db': { prisma: { server: { findUnique: async () => { throw Error('Unexpected DB lookup'); } } } },
    '@/lib/panel-backup': {
      isValidBackupName: name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.db$/.test(name) && !name.includes('..'),
      listPanelBackups: async () => [],
      createPanelBackup: async () => { effects.push(['snapshot']); return { name: 'backup.db', size: 1, integrity: 'ok' }; },
      deletePanelBackup: async (_, name) => { effects.push(['unlink', name]); return true; },
    },
    '@/lib/crypto': { decrypt: () => { throw Error('Unexpected credentials'); } },
    '@/lib/local-server': { isLocalServer: id => id === 'local', execOnHost: async command => { effects.push(command); return command.startsWith('crontab -l 2>') ? crontab : 'mock output'; } },
    '@/lib/validation': { validateTerminalCommand: () => ({ valid: true }) },
    '@/lib/audit': { auditLog: async () => {}, getClientIp: () => 'test-ip' },
    '@/lib/safe-error': { safeErrorMessage: (_, fallback) => fallback },
    'ssh2-promise': class { constructor() { throw Error('Unexpected SSH'); } },
    fs: { existsSync: () => true, mkdirSync: () => effects.push('mkdir'), copyFileSync: (...args) => effects.push(['copy', ...args]), readdirSync: () => [], statSync: () => ({ size: 1, birthtime: new Date(0) }), unlinkSync: name => effects.push(['unlink', name]) },
    path,
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in mocks, `Unexpected import ${name}`); return mocks[name]; }, process: { env: {} }, URL, setInterval: () => 0, Date, Map }, { filename: file });
  return exports;
}
function request(body = {}, query = '', ack = false) {
  return { json: async () => body, url: `http://test.invalid/api${query}`, headers: new Headers(ack ? { 'X-Safe-Mode-Off': 'true' } : {}) };
}
const context = { params: Promise.resolve({ id: 'local' }) };
async function blocked(route, method, req, status) {
  const before = effects.length;
  const result = await route[method](req, context);
  assert.equal(result.status, status, `${method} expected ${status}, got ${JSON.stringify(result)}`);
  assert.equal(effects.length, before, 'Rejected request reached executor/filesystem');
}
(async () => {
  const cron = load('src/app/api/servers/[id]/cron/route.ts');
  const terminal = load('src/app/api/servers/[id]/terminal/route.ts');
  const backup = load('src/app/api/backup/route.ts');
  await blocked(cron, 'POST', request({ schedule: '* * * * *', command: 'date' }), 423);
  await blocked(cron, 'DELETE', request({}, '?line=3&safeModeOff=true'), 423);
  await blocked(terminal, 'POST', request({ command: 'date', safeModeOff: 'true' }), 423);
  await blocked(backup, 'DELETE', request({}, '?name=backup.db&safeModeOff=true'), 423);
  await blocked(backup, 'POST', request({ action: 'restore', name: 'backup.db' }), 423);
  await blocked(backup, 'POST', request({ action: 'restore', name: 'backup.db', safeModeOff: true }), 503);
  for (const body of [null, [], {}, { schedule: 1, command: 'date' }, { schedule: '* * * * *', command: 1 }, { schedule: '* * * * *', command: 'date', description: 1 }, ...['\n', '\r', '\0'].flatMap(char => ['schedule', 'command', 'description'].map(field => ({ schedule: '* * * * *', command: 'date', [field]: field === 'schedule' ? `* * * * *${char}` : `date${char}* * * * * touch /tmp/no`, safeModeOff: true })))]) {
    await blocked(cron, 'POST', request(body && { ...body, safeModeOff: true }), 400);
  }
  for (const line of ['', 'NaN', '1x', '1.5', '-1', '0', '10000', 'Infinity']) await blocked(cron, 'DELETE', request({}, `?line=${line}`, true), 400);
  for (const command of [null, 1, {}, '', 'date\0']) await blocked(terminal, 'POST', request({ command, safeModeOff: true }), 400);
  session = null;
  await blocked(cron, 'POST', request({ safeModeOff: true }), 401);
  await blocked(terminal, 'POST', request({ command: 'date', safeModeOff: true }), 401);
  session = { sub: 'test-user', role: 'ADMIN' };
  access = false;
  await blocked(cron, 'DELETE', request({}, '?line=3', true), 403);
  await blocked(terminal, 'POST', request({ command: 'date', safeModeOff: true }), 403);
  access = true;
  assert.equal((await cron.GET(request(), context)).data[0].line, 3, 'Physical blank lines must count for deletion');
  assert.equal((await cron.POST(request({ schedule: '*/5 * * * *', command: "printf 'hello\\n'", description: 'Nightly task', safeModeOff: true }), context)).status, 200);
  assert.match(effects.at(-1), /printf '%s\\n'/, 'Do not let echo interpret backslash escapes as new cron entries');
  assert.equal((await cron.DELETE(request({}, '?line=3', true), context)).status, 200);
  assert.match(effects.at(-1), /sed '3d'/);
  assert.equal((await terminal.POST(request({ command: 'date', safeModeOff: true }), context)).status, 200);
  assert.equal((await backup.POST(request({ action: 'create' }))).status, 200, 'Creating a panel checkpoint remains available in Safe Mode');
  assert.ok(effects.some(effect => Array.isArray(effect) && effect[0] === 'snapshot'));
  await blocked(backup, 'DELETE', request({}, '?name=..%2Fbackup.db', true), 400);
  assert.equal((await backup.DELETE(request({}, '?name=backup.db', true))).status, 200);
  assert.equal(effects.at(-1)[0], 'unlink');
  console.log('PASS SEC-01 cron/terminal/backup mocked route regression; no real execution or DB writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
