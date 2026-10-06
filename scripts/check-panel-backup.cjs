// Run: node scripts/check-panel-backup.cjs (disposable databases only).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');

const filename = path.resolve(__dirname, '../src/lib/panel-backup.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function loadBackup(filesystem = fs) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => name === 'node:fs' ? filesystem : require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const backup = loadBackup();
const root = fs.mkdtempSync('/root/.hermes/cache/scratch/check-panel-backup-');
const livePath = path.join(root, 'panel.db');
const client = new PrismaClient({ datasourceUrl: `file:${livePath}` });
let writer;
let writerExit;
let writerError = '';

async function inspect(file, sql) {
  const snapshot = new PrismaClient({ datasourceUrl: `file:${file}` });
  try { return await snapshot.$queryRawUnsafe(sql); }
  finally { await snapshot.$disconnect(); }
}

(async () => {
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await client.$executeRawUnsafe('CREATE TABLE counter (value INTEGER NOT NULL)');
    await client.$executeRawUnsafe('INSERT INTO counter VALUES (0)');
    await client.$executeRawUnsafe('CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    // Python sqlite stdlib supplies an independent WAL writer; production needs only Prisma.
    const python = String.raw`
import sqlite3, sys, time
connection = sqlite3.connect(sys.argv[1], timeout=10)
connection.execute('PRAGMA journal_mode=WAL')
print('ready', flush=True)
while True:
    with connection:
        connection.execute('UPDATE counter SET value=value+1')
        value = connection.execute('SELECT value FROM counter').fetchone()[0]
        connection.execute('INSERT INTO events VALUES (?, ?)', (value, 'x'*4096))
    time.sleep(0.001)
`;
    writer = spawn('python3', ['-u', '-c', python, livePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    writerExit = once(writer, 'exit');
    writer.stderr.on('data', data => { writerError += data; });
    await Promise.race([
      once(writer.stdout, 'data').then(([data]) => assert.match(data.toString(), /ready/)),
      writerExit.then(() => { throw new Error(`Writer exited: ${writerError}`); }),
    ]);
    const snapshots = [];
    for (let i = 0; i < 5; i++) {
      const result = await backup.createPanelBackup(client);
      assert.equal(result.integrity, 'ok');
      assert.equal(result.scope, 'panel-database');
      const file = path.join(root, 'backups', result.name);
      const integrity = await inspect(file, 'PRAGMA integrity_check');
      assert.deepEqual(integrity, [{ integrity_check: 'ok' }]);
      const [state] = await inspect(file, 'SELECT value, (SELECT COUNT(*) FROM events) AS count, (SELECT COALESCE(MAX(id),0) FROM events) AS last FROM counter');
      assert.equal(BigInt(state.value), BigInt(state.count));
      assert.equal(BigInt(state.value), BigInt(state.last));
      assert.ok(result.size > 0);
      snapshots.push({ ...result, counter: Number(state.value) });
    }
    assert.ok(snapshots.at(-1).counter > snapshots[0].counter, 'independent writes must advance during snapshots');
    assert.equal(new Set(snapshots.map(item => item.name)).size, 5);
    console.log(`PASS: 5 genuine integrity-checked snapshots during concurrent WAL writes (${snapshots[0].counter} -> ${snapshots.at(-1).counter} committed transactions)`);
    writer.kill('SIGTERM');
    await writerExit;
    writer = null;

    const directory = path.join(root, 'backups');
    const outside = path.join(root, 'outside.db');
    fs.writeFileSync(outside, 'must survive');
    fs.symlinkSync(outside, path.join(directory, 'symlink.db'));
    fs.linkSync(outside, path.join(directory, 'hardlink.db'));
    fs.mkdirSync(path.join(directory, 'directory.db'));
    for (const name of ['../outside.db', '/outside.db', 'a/other.db', 'a\\other.db', '..db', 'quote\'.db', 'bad\0.db', 'a'.repeat(200)+'.db']) {
      assert.equal(backup.isValidBackupName(name), false, JSON.stringify(name));
      await assert.rejects(backup.deletePanelBackup(client, name));
    }
    const listed = await backup.listPanelBackups(client);
    assert.equal(listed.length, 5);
    for (const name of ['symlink.db', 'hardlink.db', 'directory.db']) {
      await assert.rejects(backup.deletePanelBackup(client, name));
    }
    assert.equal(fs.readFileSync(outside, 'utf8'), 'must survive');
    assert.equal(await backup.deletePanelBackup(client, snapshots[0].name), true);
    assert.equal(await backup.deletePanelBackup(client, snapshots[0].name), false);
    assert.equal((await backup.listPanelBackups(client)).length, 4);
    console.log('PASS: filename/traversal validation, symlink/hardlink/non-file rejection, list and deletion readback');

    // Exercise maintenance recovery on a stopped disposable DB, never the live panel.
    const stopped = path.join(root, 'maintenance.db');
    const preRestore = path.join(root, 'pre-restore.db');
    const recovery = snapshots[1];
    fs.copyFileSync(path.join(directory, recovery.name), stopped);
    await inspect(stopped, 'PRAGMA integrity_check');
    const stoppedClient = new PrismaClient({ datasourceUrl: `file:${stopped}` });
    try { await stoppedClient.$executeRawUnsafe('UPDATE counter SET value=value+1000'); }
    finally { await stoppedClient.$disconnect(); }
    fs.copyFileSync(stopped, preRestore);
    const [original] = await inspect(preRestore, 'SELECT value FROM counter');
    assert.equal(Number(original.value), recovery.counter + 1000);
    fs.copyFileSync(path.join(directory, recovery.name), stopped);
    assert.deepEqual(await inspect(stopped, 'PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    assert.equal(Number((await inspect(stopped, 'SELECT value FROM counter'))[0].value), recovery.counter);
    fs.copyFileSync(preRestore, stopped);
    assert.equal(Number((await inspect(stopped, 'SELECT value FROM counter'))[0].value), recovery.counter + 1000);
    console.log('PASS: stopped disposable maintenance restore/reopen and pre-restore recovery preserve exact data');

    const before = fs.readdirSync(directory).sort();
    const corruptClient = {
      $queryRawUnsafe: (...args) => client.$queryRawUnsafe(...args),
      $executeRawUnsafe: async (sql, destination) => {
        await client.$executeRawUnsafe(sql, destination);
        fs.writeFileSync(destination, 'not a SQLite database');
      },
    };
    await assert.rejects(backup.createPanelBackup(corruptClient));
    assert.deepEqual(fs.readdirSync(directory).sort(), before, 'failed integrity check must publish nothing and remove staging');
    const failedClient = {
      $queryRawUnsafe: (...args) => client.$queryRawUnsafe(...args),
      $executeRawUnsafe: async () => { throw new Error('simulated disk failure'); },
    };
    await assert.rejects(backup.createPanelBackup(failedClient));
    assert.deepEqual(fs.readdirSync(directory).sort(), before);
    console.log('PASS: corrupt snapshot and VACUUM failure never publish backups; private staging cleaned');

    // Inject at the filesystem boundary; SQLite and snapshot inspection remain real.
    for (const phase of ['publication', 'snapshot-unlink', 'metadata', 'cleanup']) {
      let injected = 0, linked = false, staged;
      const failure = Object.assign(new Error(`injected ${phase} EIO`), { code: 'EIO' });
      const filesystem = {
        ...fs,
        linkSync(source, destination) {
          staged = path.dirname(source);
          if (phase === 'publication' && !injected++) throw failure;
          fs.linkSync(source, destination);
          linked = true;
        },
        unlinkSync(file) {
          if (phase === 'snapshot-unlink' && path.basename(file) === 'snapshot.db' && !injected++) throw failure;
          return fs.unlinkSync(file);
        },
        lstatSync(file) {
          if (phase === 'metadata' && linked && path.dirname(file) === directory && !injected++) throw failure;
          return fs.lstatSync(file);
        },
        rmSync(file, options) {
          if (phase === 'cleanup' && file === staged && !injected++) throw failure;
          return fs.rmSync(file, options);
        },
      };
      await assert.rejects(loadBackup(filesystem).createPanelBackup(client), error => error === failure);
      assert.ok(injected > 0, `${phase}: injection must execute`);
      assert.deepEqual(fs.readdirSync(directory).sort(), before, `${phase}: rejected create must remove published entry and staging`);
      assert.equal((await backup.listPanelBackups(client)).length, 4);
    }
    console.log('PASS: publication, post-link snapshot unlink EIO, metadata and cleanup failures reject without published/staging leftovers');

    // A persistently unavailable filesystem cannot be cleaned; never claim success.
    const cleanupFailure = Object.assign(new Error('persistent cleanup EIO'), { code: 'EIO' });
    let abandoned;
    const unavailableCleanup = loadBackup({ ...fs, rmSync(file) { abandoned = file; throw cleanupFailure; } });
    try {
      await assert.rejects(unavailableCleanup.createPanelBackup(client), error => error === cleanupFailure);
      assert.deepEqual(fs.readdirSync(directory).filter(backup.isValidBackupName).sort(), before.filter(backup.isValidBackupName));
      assert.equal(fs.existsSync(abandoned), true, 'persistent cleanup failure must be observable, not reported as success');
    } finally { if (abandoned) fs.rmSync(abandoned, { recursive: true, force: true }); }
    assert.deepEqual(fs.readdirSync(directory).sort(), before);
    console.log('PASS: persistent staging cleanup EIO rejects and rolls back publication; inaccessible staging cleaned by fixture');

    fs.renameSync(directory, path.join(root, 'saved-backups'));
    fs.symlinkSync(path.join(root, 'saved-backups'), directory);
    await assert.rejects(backup.listPanelBackups(client));
    await assert.rejects(backup.createPanelBackup(client));
    await assert.rejects(backup.deletePanelBackup(client, snapshots[1].name));
    console.log('PASS: symlink backup directory fails closed for list/create/delete');

    // Restore API must remain unavailable without touching filesystem or database.
    const routeFile = path.resolve(__dirname, '../src/app/api/backup/route.ts');
    const routeCode = ts.transpileModule(fs.readFileSync(routeFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    let restoreOnly = true;
    const route = new Module(routeFile, module);
    route.filename = routeFile;
    route.paths = Module._nodeModulePaths(path.dirname(routeFile));
    route.require = name => {
      if (name === '@/lib/db') return { prisma: new Proxy(client, { get(target, key) {
        assert.equal(restoreOnly, false, 'restore must not access database');
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } }) };
      if (name === '@/lib/panel-backup') return backup;
      if (name === '@/lib/audit') return { auditLog: async () => {}, getClientIp: () => 'fixture' };
      if (name === '@/lib/safe-error') return { safeErrorMessage: () => 'error' };
      if (name === '@/lib/operation-safety') return { requireSafeModeOff: (_, body) => body.safeModeOff === true ? null : new Response('{}', { status: 423 }) };
      return require(name);
    };
    route._compile(routeCode, routeFile);
    for (const [safeModeOff, status] of [[true, 503], [false, 423]]) {
      const response = await route.exports.POST({ json: async () => ({ action: 'restore', safeModeOff }) });
      assert.equal(response.status, status);
    }
    const deniedDelete = await route.exports.DELETE({ headers: new Headers(), url: 'http://fixture/api/backup?name=valid.db' });
    assert.equal(deniedDelete.status, 423);
    console.log('PASS: real route keeps restore 503, denies restore/delete without Safe Mode acknowledgment');

    fs.unlinkSync(directory);
    fs.renameSync(path.join(root, 'saved-backups'), directory);
    restoreOnly = false;
    const created = await route.exports.POST({ json: async () => ({ action: 'create' }) });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.data.integrity, 'ok');
    assert.equal(createdBody.data.scope, 'panel-database');
    assert.match(createdBody.message, /VPS apps and volumes are not included/);
    const readback = await (await route.exports.GET()).json();
    assert.ok(readback.data.some(item => item.name === createdBody.data.name));
    const deleted = await route.exports.DELETE({ headers: new Headers({ 'X-Safe-Mode-Off': 'true' }), url: `http://fixture/api/backup?name=${createdBody.data.name}` });
    assert.equal(deleted.status, 200);
    const afterDelete = await (await route.exports.GET()).json();
    assert.ok(!afterDelete.data.some(item => item.name === createdBody.data.name));
    console.log('PASS: real route create/list/delete roundtrip with actual Prisma snapshot and readback');
    console.log('Panel backup regression checks passed. No production database accessed.');
  } finally {
    if (writer) { writer.kill('SIGTERM'); await writerExit; }
    await client.$disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
