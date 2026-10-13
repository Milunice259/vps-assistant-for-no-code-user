const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || '/root/.hermes/cache/scratch', 'mon5-scheduler-'));
const scripts = path.join(scratch, 'scripts');
const runtime = path.join(scripts, 'monitoring-runtime');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let prisma, worker;
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await wait(100); }
  throw Error('Timed out waiting for real worker');
}
(async () => {
  fs.mkdirSync(scripts);
  execFileSync(process.execPath, [path.join(root, 'scripts/monitoring-worker.cjs'), '--build', runtime], { cwd: root, stdio: 'inherit' });
  fs.copyFileSync(path.join(root, 'scripts/monitoring-worker.cjs'), path.join(scripts, 'monitoring-worker.cjs'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), 'dir');
  const url = 'file:' + path.join(scratch, 'worker.db');
  process.env.DATABASE_URL = url;
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$executeRawUnsafe('CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at DATETIME NOT NULL)');
  const scheduler = require(path.join(runtime, 'lib/monitoring-scheduler.js'));
  const lease = await scheduler.acquireMonitoringLease(500);
  assert(lease);
  assert.equal(await scheduler.acquireMonitoringLease(500), null);
  await scheduler.finishMonitoringLease('wrong-owner', 'ok', Date.now());
  assert.equal(await scheduler.acquireMonitoringLease(500), null);
  await wait(600);
  const replacement = await scheduler.acquireMonitoringLease(5000);
  assert(replacement);
  await scheduler.finishMonitoringLease(lease, 'ok', Date.now());
  assert.equal(await scheduler.acquireMonitoringLease(500), null);
  await scheduler.finishMonitoringLease(replacement, 'ok', Date.now());
  for (const value of [null, {}, { enabled: true, intervalSeconds: 29 }, { enabled: true, intervalSeconds: 3601 }, { enabled: true, intervalSeconds: 60, extra: true }]) assert.equal(scheduler.validateMonitoringConfig(value), false);
  await scheduler.saveMonitoringConfig({ enabled: true, intervalSeconds: 30 });
  // Offline collector fixtures exercise the ACTUAL production supervisor, SQLite and native child timer.
  // No network, host commands or production DB. These do not claim collector integration coverage.
  const calls = path.join(scratch, 'calls');
  fs.writeFileSync(path.join(runtime, 'lib/monitoring-metrics.js'), `exports.collectMonitoringMetrics=async()=>{require('fs').appendFileSync(${JSON.stringify(calls)},Date.now()+'\\n');if(process.env.MON5_HANG==='true')await new Promise(()=>{});};`);
  fs.writeFileSync(path.join(runtime, 'lib/notification-checks.js'), 'exports.runNotificationChecks=async()=>{};');
  const start = hang => worker = spawn(process.execPath, [path.join(scripts, 'monitoring-worker.cjs')], { cwd: scratch, env: { ...process.env, DATABASE_URL: url, MON5_HANG: String(hang), NODE_ENV: 'production' }, stdio: 'ignore' });
  const stop = async signal => { const current = worker; worker = null; current.kill(signal); await new Promise(resolve => current.once('exit', resolve)); };
  const count = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0;
  await prisma.appSetting.deleteMany({where:{key:'monitoring.status'}});
  start(false);
  await until(() => count() === 1);
  await until(async () => !(await scheduler.getMonitoringStatus()).running);
  const first = (await scheduler.getMonitoringStatus()).lastCompletedAt;
  await until(() => count() === 2, 40000);
  await until(async () => !(await scheduler.getMonitoringStatus()).running);
  assert((await scheduler.getMonitoringStatus()).lastCompletedAt > first);
  await stop('SIGTERM');
  // Restart must respect an unexpired durable lock even when a new process starts.
  await prisma.appSetting.deleteMany({where:{key:'monitoring.status'}});
  const restartLease = await scheduler.acquireMonitoringLease(1500);
  start(false);
  await wait(800);
  assert.equal(count(), 2);
  await until(() => count() === 3);
  await until(async () => !(await scheduler.getMonitoringStatus()).running);
  await stop('SIGTERM');
  // Hard deadline is the real 120 seconds, not fake clocks or Promise.race-only cancellation.
  await prisma.appSetting.deleteMany({where:{key:'monitoring.status'}});
  start(true);
  await until(() => count() === 4);
  const started = Date.now();
  await until(async () => (await scheduler.getMonitoringStatus()).outcome === 'timeout', 130000);
  assert(Date.now() - started >= 118000);
  assert.equal((await scheduler.getMonitoringStatus()).running, false);
  await stop('SIGTERM');
  const status = await scheduler.getMonitoringStatus();
  for (const key of ['owner','expiresAt','results','checked','serverId','serverName','error']) assert.equal(key in status, false);
  // Route boundary checks use real scheduler/SQLite with only HTTP session/response adapters.
  let session = null;
  const output = require('typescript').transpileModule(fs.readFileSync(path.join(root, 'src/app/api/monitoring/status/route.ts'), 'utf8'), { compilerOptions: { module: 1, target: 9 } }).outputText;
  const route = {};
  vm.runInNewContext(output, { exports: route, require: name => ({ 'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }, '@/lib/auth': { getSession: async () => session }, '@/lib/audit': { auditLog: async () => {}, getClientIp: () => 'fixture' }, '@/lib/monitoring-scheduler': scheduler }[name]), console });
  assert.equal((await route.GET()).status,401);
  for (const role of ['VIEWER','MANAGER','OPERATOR']) { session={sub:'fixture',role}; assert.equal((await route.GET()).status,200); assert.equal((await route.PUT({json:async()=>({enabled:false,intervalSeconds:30})})).status,403); }
  session={sub:'fixture',role:'ADMIN'};
  assert.equal((await route.PUT({json:async()=>({enabled:false,intervalSeconds:1})})).status,400);
  assert.equal((await route.PUT({json:async()=>({enabled:false,intervalSeconds:30})})).status,200);
  assert.equal((await scheduler.getMonitoringConfig()).enabled,false);
  await scheduler.finishMonitoringLease(restartLease,'failed',Date.now());
  console.log('PASS MON03: production CJS worker without browser; real 30s repeat timer; restart respects unexpired SQLite lease and reclaims expired lease only; wrong owner cannot release; real 120s hard-kill deadline; auth/config bounds; sanitized status. Offline collectors are explicit fixtures.');
  await require(path.join(runtime, 'lib/db.js')).prisma.$disconnect();
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => { if(worker) { worker.kill('SIGTERM'); await new Promise(resolve=>worker.once('exit',resolve)); } if(prisma) await prisma.$disconnect(); fs.rmSync(scratch,{recursive:true,force:true}); });
