const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(file, mocks, extras = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { if (name in mocks) return mocks[name]; throw Error(`Unexpected dependency ${name}`); }, console, Buffer, Error, ...extras }, { filename: file });
  return exports;
}
(async () => {
  let row = null, reads = 0, writes = 0, session = { sub: 'fixture', username: 'fixture', role: 'ADMIN' }, audits = 0;
  const db = { appSetting: { findUnique: async () => { reads++; return row; }, upsert: async args => { writes++; row = { value: args.create.value }; } } };
  const settings = load('src/lib/general-settings.ts', { './db': { prisma: db } });
  const defaults = await settings.getGeneralSettings();
  assert.equal(defaults.backupSchedule, 'never');
  assert.equal(settings.SCHEDULE_CAPABILITIES.backup.active, false);
  assert.equal(settings.SCHEDULE_CAPABILITIES.cleanup.active, false);
  const chosen = { ...defaults, applicationName: 'Fixture Panel', dockerMemoryLimitMB: 512, dockerRestartPolicy: 'always', backupSchedule: 'daily', cleanupSchedule: 'weekly' };
  for (const invalid of [null, [], { ...chosen, extra: true }, { ...chosen, dockerMemoryLimitMB: 1 }, { ...chosen, dockerMemoryLimitMB: '512' }, { ...chosen, dockerRestartPolicy: 'always; touch /x' }, { ...chosen, applicationName: '\n' }, { ...chosen, backupRetentionDays: 0 }, { ...chosen, backupSchedule: 'hourly' }]) assert.equal(settings.validateGeneralSettings(invalid), false);
  const route = load('src/app/api/settings/general/route.ts', { 'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }, '@/lib/auth': { getSession: async () => session }, '@/lib/audit': { auditLog: async () => audits++, getClientIp: () => 'fixture' }, '@/lib/general-settings': settings });
  const request = body => ({ json: async () => body });
  for (const role of [null, 'VIEWER', 'MANAGER', 'OPERATOR']) {
    session = role ? { sub: 'fixture', role } : null;
    const before = writes;
    assert.equal((await route.PUT(request(chosen))).status, role ? 403 : 401);
    assert.equal(writes, before);
  }
  session = { sub: 'fixture', role: 'OWNER' };
  assert.equal((await route.PUT(request({ ...chosen, dockerMemoryLimitMB: -1 }))).status, 400);
  assert.equal((await route.PUT({ json: async () => { throw Error('bad JSON'); } })).status, 400);
  assert.equal((await route.PUT(request(chosen))).status, 200);
  assert.equal(audits, 1);
  assert.deepEqual(JSON.parse(JSON.stringify((await route.GET()).body.data)), chosen);
  // Fresh module demonstrates persistence across consumers, not a module-local cache.
  const restarted = load('src/lib/general-settings.ts', { './db': { prisma: db } });
  assert.equal((await restarted.getGeneralSettings()).dockerMemoryLimitMB, 512);
  const validation = load('src/lib/validation.ts', {});
  const preflight = load('src/lib/deploy-preflight.ts', { './compose-deployment': require('./check-guided-deploy.cjs').canonicalCompose(), 'js-yaml': require('js-yaml'), '@/lib/validation': validation, './general-settings': restarted });
  const run = async command => (command.includes('df -P') ? '40' : command.includes('MemTotal') ? '50' : '') + '\n__PANEL_DEPLOY_EXIT_0__';
  const input = { type: 'image', image: 'alpine:3' };
  await preflight.dockerPreflight(run, input);
  assert.equal(input.memoryLimit, 512); assert.equal(input.restartPolicy, 'always');
  const explicit = { type: 'image', image: 'alpine:3', restartPolicy: 'no', memoryLimit: 1024 };
  await preflight.dockerPreflight(run, explicit);
  assert.equal(explicit.memoryLimit, 1024); assert.equal(explicit.restartPolicy, 'no');
  const unlimited = { type: "image", image: "alpine:3", restartPolicy: "no", memoryLimit: 0 };
  assert.equal(preflight.validateDockerDeploy(unlimited), null);
  await preflight.dockerPreflight(run, unlimited);
  assert.equal(unlimited.memoryLimit, 0); assert.equal(unlimited.restartPolicy, "no");
  const metadata = load("src/app/layout.tsx", { "./globals.css": {}, "@/lib/notification-scheduler": {}, "@/lib/general-settings": restarted, "react/jsx-runtime": {} });
  assert.equal((await metadata.generateMetadata()).title, chosen.applicationName);
  let sent;
  const notifications = load('src/lib/notifications.ts', { '@/lib/db': { prisma: { notificationChannel: { findUnique: async () => ({ type: 'discord', enabled: true, webhookUrl: 'https://fixture.invalid' }) } } }, './general-settings': restarted }, { fetch: async (_, args) => { sent = JSON.parse(args.body); return { ok: true }; }, AbortSignal });
  assert.equal(await notifications.sendNotification('fixture', { title: 'Test', message: 'Test', severity: 'info' }), true);
  assert.equal(sent.username, 'Fixture Panel');
  row = { value: '{malformed' };
  await assert.rejects(() => restarted.getGeneralSettings());
  const os = require('node:os');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch'), 'conf-settings-db-'));
  const { PrismaClient } = require('@prisma/client');
  let prisma = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(scratch, 'settings.db') } } });
  try {
    await prisma.$executeRawUnsafe('CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at DATETIME NOT NULL)');
    const persistent = load('src/lib/general-settings.ts', { './db': { prisma } });
    await persistent.saveGeneralSettings(chosen);
    await prisma.$disconnect();
    prisma = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(scratch, 'settings.db') } } });
    const reopened = load('src/lib/general-settings.ts', { './db': { prisma } });
    assert.equal((await reopened.getGeneralSettings()).applicationName, 'Fixture Panel');
    assert.equal((await reopened.getGeneralSettings()).backupSchedule, 'daily');
    console.log('PASS real Prisma/SQLite persistence after disconnect/reopen; exact disposable database only.');
  } finally { await prisma.$disconnect(); fs.rmSync(scratch, { recursive: true, force: true }); }
  console.log('CONF-01 PASS: validation, auth-before-write, save/readback/reload, default and override consumers, Discord branding, inactive schedules, malformed storage. No host commands/network/production DB used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
