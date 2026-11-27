#!/usr/bin/env node
// ISOLATED-ONLY operator tool. Run with the restored COPY stopped and isolated.
// Dormant in the runner image: never called by entrypoint, scheduler or HTTP.
// The acknowledgement records operator intent; it does not prove OS isolation.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
function reject(message) { console.error(message); process.exit(2); }
const copies = args.filter(arg => arg.startsWith('--restored-copy='));
if (copies.length !== 1 || new Set(args).size !== args.length || args.some(arg => !arg.startsWith('--restored-copy=') && arg !== '--apply' && arg !== '--confirm-isolated-copy')) {
  reject('Usage: node scripts/mobile-revoke-restored.cjs --restored-copy=/absolute/restored-copy.db [--apply --confirm-isolated-copy]');
}
const apply = args.includes('--apply');
if (apply !== args.includes('--confirm-isolated-copy')) reject('Applying requires both --apply and --confirm-isolated-copy; keep the restored copy stopped and isolated.');
const file = copies[0].slice('--restored-copy='.length);
try {
  // Do not let a SQLite query/fragment or linked file redirect the explicit target.
  const stat = fs.lstatSync(file);
  if (!path.isAbsolute(file) || /[?#\0]/.test(file) || !stat.isFile() || stat.nlink !== 1) throw Error();
} catch { reject('An explicit existing regular, unlinked restored database copy is required.'); }
// Deliberately ignore DATABASE_URL; there is no implicit/default database target.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + file } } });
(async () => {
  const count = await prisma.mobileDevice.count({ where: { revokedAt: null } });
  if (!apply) { console.log(JSON.stringify({ dryRun: true, activeDeviceRows: count })); return; }
  const result = await prisma.mobileDevice.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date(), tokenHash: null, pairingHash: null } });
  console.log(JSON.stringify({ revokedDeviceRows: result.count, requiresPairing: true }));
})().catch(() => {
  console.error('Restored mobile credential invalidation failed; keep restored service isolated');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
