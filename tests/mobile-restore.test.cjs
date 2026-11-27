const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
assert.match(process.env.DATABASE_URL || '', /^file:\/tmp\/vps-mobile-ci-[^/]+\/fixture\.db$/);
const { PrismaClient } = require('@prisma/client');
const { prisma } = require('../scripts/monitoring-runtime/lib/db.js');
const { issueMobilePairing, redeemMobilePairing, authorizeMobileBearer } = require('../scripts/monitoring-runtime/lib/mobile-devices.js');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/mobile-revoke-restored.cjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-mobile-restore-'));
const copy = path.join(scratch, 'restored-copy.db');
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env } });
const target = '--restored-copy=' + copy;
const value = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
let restored;
async function fingerprint(client, includeMobile = false) {
  const tables = await client.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const hash = crypto.createHash('sha256');
  for (const { name } of tables) {
    assert.match(name, /^[a-zA-Z0-9_]+$/);
    if (!includeMobile && ['mobile_devices', 'mobile_server_snapshots'].includes(name)) continue;
    const rows = await client.$queryRawUnsafe('SELECT * FROM "' + name + '" ORDER BY rowid');
    hash.update(name).update(JSON.stringify(rows, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
  }
  return hash.digest('hex');
}
(async () => {
  // This is a COPY of a disposable fixture, not a backup of any user database.
  const user = await prisma.user.create({ data: { username: 'restore-fixture-owner', passwordHash: 'fixture-only', role: 'OWNER' } });
  const setting = await prisma.appSetting.findUnique({ where: { key: 'security' } });
  const version = setting ? JSON.parse(setting.value).forceLogoutVersion || 0 : 0;
  const issued = await issueMobilePairing(user.id, version, 'Restore paired phone', ['local']);
  const paired = await redeemMobilePairing(issued.code);
  const pending = await issueMobilePairing(user.id, version, 'Restore pending phone', ['local']);
  await authorizeMobileBearer('Bearer ' + paired.token);
  const sourceBefore = await fingerprint(prisma, true);
  await prisma.$executeRawUnsafe('VACUUM INTO ?', copy);
  restored = new PrismaClient({ datasources: { db: { url: 'file:' + copy } } });
  const before = await fingerprint(restored);
  const active = await restored.mobileDevice.count({ where: { revokedAt: null } });
  assert.ok(active >= 2);
  await restored.$disconnect();
  // No default target, no accidental mutation from --apply alone or malformed args.
  for (const args of [[], ['--apply'], [target, '--apply'], [target, '--confirm-isolated-copy'], [target, '--unknown'], ['--restored-copy=relative.db'], ['--restored-copy=' + copy + '?mode=rw']]) {
    assert.equal(cli(...args).status, 2, 'Unsafe CLI invocation rejected');
  }
  const symlink = path.join(scratch, 'symlink.db'), hardlink = path.join(scratch, 'hardlink.db');
  fs.symlinkSync(copy, symlink);
  assert.equal(cli('--restored-copy=' + symlink).status, 2);
  fs.linkSync(copy, hardlink);
  assert.equal(cli('--restored-copy=' + hardlink).status, 2);
  fs.unlinkSync(hardlink);
  assert.deepEqual(value(cli(target)), { dryRun: true, activeDeviceRows: active });
  assert.equal(await fingerprint(restored), before);
  assert.equal(await restored.mobileDevice.count({ where: { revokedAt: null } }), active);
  await restored.$disconnect();
  assert.deepEqual(value(cli(target, '--apply', '--confirm-isolated-copy')), { revokedDeviceRows: active, requiresPairing: true });
  assert.equal(await fingerprint(restored), before, 'All non-mobile tables preserved');
  assert.equal(await restored.mobileDevice.count({ where: { revokedAt: null } }), 0);
  assert.equal(await restored.mobileDevice.count({ where: { id: { in: [issued.id, pending.id] }, OR: [{ tokenHash: { not: null } }, { pairingHash: { not: null } }] } }), 0);
  await restored.$disconnect();
  assert.equal(value(cli(target, '--apply', '--confirm-isolated-copy')).revokedDeviceRows, 0);
  // Exercise the actual authorization boundary in a fresh process bound only to the copy.
  const denied = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict');
    const {authorizeMobileBearer,redeemMobilePairing}=require('./scripts/monitoring-runtime/lib/mobile-devices.js');
    const {prisma}=require('./scripts/monitoring-runtime/lib/db.js');
    (async()=>{
      await assert.rejects(()=>authorizeMobileBearer(process.env.FIXTURE_BEARER),e=>e.status===401);
      await assert.rejects(()=>redeemMobilePairing(process.env.FIXTURE_CODE),e=>e.status===401);
      console.log('Restored credentials denied');
    })().catch(()=>{process.exitCode=1}).finally(()=>prisma.$disconnect());
  `], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, DATABASE_URL: 'file:' + copy, FIXTURE_BEARER: 'Bearer ' + paired.token, FIXTURE_CODE: pending.code } });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal((await authorizeMobileBearer('Bearer ' + paired.token)).deviceId, issued.id, 'Explicit copy did not revoke source token');
  assert.equal(await fingerprint(prisma, true), sourceBefore, 'DATABASE_URL source database untouched');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /COPY --from=builder \/app\/scripts\/mobile-revoke-restored\.cjs \.\/scripts\/mobile-revoke-restored\.cjs/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8'), /mobile-revoke-restored/);
  const inventory = JSON.parse(spawnSync(process.execPath, ['scripts/check-conf3-regressions.cjs', '--list'], { cwd: root, encoding: 'utf8' }).stdout);
  assert.match(inventory.excluded['mobile-revoke-restored.cjs'], /ISOLATED-ONLY/);
  assert.equal(inventory.included.includes('mobile-revoke-restored.cjs'), false);
  assert.deepEqual(inventory.unknown, []);
  console.log('Mobile restored-copy CLI guards, dry-run/apply/idempotency, credential denial, source/table preservation and packaging contract: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all([restored?.$disconnect(), prisma.$disconnect()]);
  fs.rmSync(scratch, { recursive: true, force: true });
});
