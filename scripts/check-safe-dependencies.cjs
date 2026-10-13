// SAFE-06: node scripts/check-safe-dependencies.cjs (no network or production DB).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const fromRoot = createRequire(path.join(root, 'package.json'));

async function checkPrisma() {
  const scratch = process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'safe06-'));
  let db;
  try {
    const { deepmerge } = createRequire(fromRoot.resolve('@prisma/config'))('deepmerge-ts');
    assert.deepEqual(deepmerge({ migrations: { path: 'migrations' } }, { migrations: { seed: 'node seed.js' } }),
      { migrations: { path: 'migrations', seed: 'node seed.js' } });
    const cyclic = {};
    cyclic.self = cyclic;
    const merged = deepmerge(cyclic, { checked: true });
    assert.equal(merged.self, merged);
    assert.equal(merged.checked, true);

    // Copy the current app schema: generation/push can only affect this scratch directory.
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    assert.match(schema, /generator client\s*\{\s*provider\s*=\s*"prisma-client-js"/);
    fs.writeFileSync(path.join(dir, 'schema.prisma'), schema.replace(/(generator client\s*\{)/, '$1\n  output = "./client"'));
    fs.writeFileSync(path.join(dir, 'prisma.config.cjs'), `const { defineConfig } = require(${JSON.stringify(fromRoot.resolve('@prisma/config'))});\nmodule.exports = defineConfig({ schema: './schema.prisma', migrations: { path: './migrations', seed: 'node seed.js' } });\n`);
    const { loadConfigFromFile } = fromRoot('@prisma/config');
    const loaded = await loadConfigFromFile({ configRoot: dir });
    assert.equal(loaded.error, undefined);
    assert.equal(loaded.config.schema, path.join(dir, 'schema.prisma'));
    assert.equal(loaded.config.migrations.path, path.join(dir, 'migrations'));
    assert.equal(loaded.config.migrations.seed, 'node seed.js');
    const env = { ...process.env, DATABASE_URL: `file:${path.join(dir, 'fixture.db')}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' };
    const cli = path.join(path.dirname(fromRoot.resolve('prisma/package.json')), 'build/index.js');
    for (const args of [['generate'], ['db', 'push', '--skip-generate']]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
      assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    }
    const { PrismaClient } = require(path.join(dir, 'client'));
    db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    await db.appSetting.create({ data: { key: 'safe06', value: 'compatibility-readback' } });
    assert.equal((await db.appSetting.findUnique({ where: { key: 'safe06' } })).value, 'compatibility-readback');
    await db.appSetting.delete({ where: { key: 'safe06' } });
    assert.equal(await db.appSetting.findUnique({ where: { key: 'safe06' } }), null);
    console.log('PASS Prisma config/deepmerge cycles, current-schema generate/push, disposable SQLite create/read/delete');
  } finally {
    if (db) await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function checkSSH() {
  const ssh2 = fromRoot('ssh2');
  const socks = fromRoot('@heroku/socksv5');
  const utils = fromRoot('@heroku/socksv5/lib/utils');
  const originalClient = ssh2.Client;
  const saved = [];
  let connections = 0;
  const clients = [];
  let verifierCalls = 0;
  class FakeClient extends EventEmitter {
    connect(config) {
      connections++;
      this.endCalls = 0;
      clients.push(this);
      assert.equal(config.host, '192.0.2.1');
      assert.equal(config.port, 2222);
      assert.equal(config.sock, undefined);
      assert.equal(config.hostVerifier(Buffer.from('fixture-key')), true);
      assert.equal(config.authHandler, undefined);
      if (config.username === 'denied') {
        queueMicrotask(() => {
          this.emit('error', Object.assign(new Error('fixture authentication failed'), { level: 'client-authentication' }));
          this.emit('close');
        });
      } else {
        assert.equal(config.username, 'fixture');
        assert.equal(config.password, 'fixture-password');
        assert.equal(config.privateKey, 'fixture-private-key');
        queueMicrotask(() => this.emit('ready'));
      }
      return this;
    }
    exec(command, options, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      callback(command === 'executor-error' ? new Error('fixture exec error') : null, stream);
      queueMicrotask(() => {
        if (command === 'stderr-error') stream.stderr.emit('data', Buffer.from('fixture stderr'));
        else stream.emit('data', Buffer.from('fixture stdout'));
        stream.emit('close');
      });
    }
    end() { this.endCalls++; }
  }
  try {
    // Keep the installed promise executor; replace only its TCP transport and deny SOCKS use.
    ssh2.Client = FakeClient;
    for (const [object, names] of [[socks, ['createServer', 'createConnection', 'connect']], [utils, ['ipbytes']]]) {
      for (const name of names) {
        saved.push([object, name, object[name]]);
        object[name] = () => { throw new Error('SOCKS/IP path must not be reached'); };
      }
    }
    const SSH2Promise = fromRoot('ssh2-promise');
    const config = { host: '192.0.2.1', port: 2222, username: 'fixture', reconnect: false,
      password: 'fixture-password', privateKey: 'fixture-private-key',
      hostVerifier: (key) => { verifierCalls++; return key.equals(Buffer.from('fixture-key')); } };
    const ssh = new SSH2Promise(config);
    try {
      await ssh.connect();
      assert.equal(await ssh.exec('stdout'), 'fixture stdout');
      await assert.rejects(ssh.exec('executor-error'), /fixture exec error/);
      await assert.rejects(ssh.exec('stderr-error'), (error) => error === 'fixture stderr');
    } finally { await ssh.close(); }
    assert.equal(connections, 1);
    // Cached close ends the same client twice: close() emits disconnect while cached,
    // and the disconnect callback closes it again before deleting the cache entry.
    assert.equal(clients.length, 1);
    assert.equal(clients[0].endCalls, 2);
    assert.equal(Object.keys(SSH2Promise.__cache).length, 0);
    assert.equal(verifierCalls, 1);

    // Config arrays are ordered jump hosts, NOT authentication alternatives.
    // Failure of the first hop must reject without dialing the second entry.
    const hops = new SSH2Promise([{ ...config, username: 'denied' }, config], true);
    try {
      await assert.rejects(hops.connect(), /fixture authentication failed/);
    } finally { await hops.close(); }
    assert.equal(connections, 2);
    assert.equal(clients.length, 2);
    assert.equal(clients[1].endCalls, 1); // disableCache avoids the cached reentrant close
    assert.equal(verifierCalls, 2);
    // ponytail: TCP-only mitigation, not a SOCKS fix; revisit if proxy/tunnel support is added.
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (/\.[cm]?[jt]sx?$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\b(getSocksPort|addTunnel|socksHost|socksPort)\b/, `SOCKS reachability changed: ${file}`);
      }
    }
    scan(path.join(root, 'src'));
    console.log('PASS installed ssh2-promise TCP/verifier/credential passthrough/exec errors; exact cached close/cache eviction; failed first hop does not auth-fallback; SOCKS/IP unreachable in checked src paths');
  } finally {
    ssh2.Client = originalClient;
    for (const [object, name, value] of saved) object[name] = value;
  }
}

(async () => {
  const baseline = fromRoot('baseline-browser-mapping');
  assert.ok(baseline.getCompatibleVersions({ targetYear: 2020, suppressWarnings: true }).length);
  assert.throws(() => baseline.getCompatibleVersions({ targetYear: 2020, widelyAvailableOnDate: '2020-01-01' }), /cannot use/);
  const { SourceMapConsumer } = fromRoot('source-map-js');
  const map = { version: 3, sources: ['input.js'], names: [], mappings: 'AAAA' };
  assert.equal(new SourceMapConsumer(map).originalPositionFor({ line: 1, column: 0 }).source, 'input.js');
  assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 10000001, column: 0 }, map }] }), /must not exceed/);
  console.log('PASS browser mapping valid/invalid input and source-map valid/oversized-section rejection');
  await checkPrisma();
  await checkSSH();
})().catch((error) => { console.error(error); process.exitCode = 1; });
