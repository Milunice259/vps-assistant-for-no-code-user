const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const env = {};
let role = 'ADMIN', trustWrites = 0;
let pin = null, knownHosts = '', connections = 0, closes = 0, commands = [];
const publicKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const type = Buffer.from('ssh-ed25519');
const raw = Buffer.concat([Buffer.from([0, 0, 0, type.length]), type, Buffer.from([0, 0, 0, 32]), publicKey]);
const changed = Buffer.from(raw); changed[changed.length - 1] ^= 1;
let presented = raw;
const fingerprint = key => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
class SSH {
  constructor(config, disableCache) { this.config = config; assert.equal(disableCache, true); assert.equal(config.hostHash, undefined); }
  async connect() { connections++; assert.equal(typeof this.config.hostVerifier, 'function'); if (!this.config.hostVerifier(presented)) throw new Error('Host denied'); }
  async close() { closes++; }
  async exec(command) { commands.push(command); return command.includes('__ACTION_COMPLETED__') ? '__ACTION_COMPLETED__' : command.includes('is-active') ? 'active' : ''; }
}
class Client extends EventEmitter {
  connect(config) { assert.equal(config.password, undefined); assert.equal(config.privateKey, undefined); assert.equal(config.hostVerifier(presented), false); queueMicrotask(() => this.emit('error', new Error('Host denied'))); }
  end() {}
}
const prisma = { appSetting: { async findUnique() { return pin ? { value: JSON.stringify(pin) } : null; } } };
function load(file, extra = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require(id) { if (id in extra) return extra[id]; if (id === 'ssh2-promise') return SSH; if (id === 'ssh2') return { Client }; if (id === '@/lib/db') return { prisma }; if (id === 'fs') return { readFileSync() { return knownHosts; } }; return require(id); }, Buffer, URL, process: { env }, Error, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }) });
  return exports;
}
(async () => {
  const helper = load('src/lib/ssh/connection.ts');
  const config = { host: 'vps.example', port: 22, username: 'operator', serverId: 's1' };
  await assert.rejects(helper.createSSHConnection(config), /unverified/i);
  assert.equal(connections, 0);
  pin = { host: config.host, port: 22, fingerprint: fingerprint(raw) };
  await helper.createSSHConnection(config);
  presented = changed;
  await assert.rejects(helper.createSSHConnection(config), /changed|verification/i);
  assert.equal(closes, 1);
  presented = raw;
  await assert.rejects(helper.createSSHConnection({ ...config, host: 'prefix.vps.example' }), /unverified/i);
  await assert.rejects(helper.createSSHConnection({ ...config, port: 2222 }), /unverified/i);
  assert.equal(helper.verifyKnownHost(`vps.example ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 22, raw), true);
  assert.equal(helper.verifyKnownHost(`prefix.vps.example ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 22, raw), false);
  assert.equal(helper.verifyKnownHost(`vps.example ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 2222, raw), false);
  assert.equal(helper.verifyKnownHost(`[vps.example]:2222 ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 2222, raw), true);
  assert.equal(helper.verifyKnownHost(`[vps.example]:2222 ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 22, raw), false);
  assert.equal(helper.verifyKnownHost(`vps.example ssh-ed25519 ${changed.toString('base64')}`, 'vps.example', 22, raw), false);
  assert.equal(helper.verifyKnownHost(`@revoked vps.example ssh-ed25519 ${raw.toString('base64')}`, 'vps.example', 22, raw), false);
  assert.equal(await helper.probeSSHIdentity(config), fingerprint(raw));
  assert.equal(commands.length, 0);
  const server = { id: 's1', host: config.host, port: 22, username: 'operator', encryptedPass: 'fixture' };
  prisma.server = { async findUnique() { return server; }, async update() {} };
  const serverSSH = load('src/lib/server-ssh.ts', { '@/lib/ssh': helper, '@/lib/crypto': { decrypt: () => 'offline credential' } });
  const common = {
    '@/lib/ssh': helper, '@/lib/server-ssh': serverSSH, '@/lib/crypto': { decrypt: () => 'offline credential' },
    '@/lib/operation-result': { operationResult: x => x },
    '@/lib/server-health': { detectRemoteServer: async ssh => { await ssh.exec('detect'); return { ok: true, message: 'offline' }; }, friendlyConnectionError: e => e.message }, '@/lib/auth': { getSession: async () => ({ sub: 'u1', role }) },
    '@/lib/server-access': { canAccessServer: async () => true, normalizeRole: x => x },
    '@/lib/local-server': { isLocalServer: id => id === 'local', execOnHost: () => { throw new Error('Unexpected local command'); }, canAccessHost: () => false },
    '@/lib/safe-error': { safeErrorMessage: e => e.message }, '@/lib/audit': { auditLog: async () => {}, getClientIp: () => '' },
    '@/lib/operation-safety': { requireSafeModeOff: () => null }, '@/lib/validation': { validatePath: () => ({ valid: true }), validateTerminalCommand: () => ({ valid: true }) },
    'next/server': { NextResponse: { json: (data, options) => ({ ...data, status: options?.status ?? 200 }) } },
  };
  const files = load('src/app/api/servers/[id]/files/route.ts', common);
  const cron = load('src/app/api/servers/[id]/cron/route.ts', common);
  const context = { params: Promise.resolve({ id: 's1' }) };
  const req = { url: 'http://offline.test/?path=/&line=1', json: async () => ({ schedule: '* * * * *', command: 'true' }), headers: { get: () => 'true' } };
  for (const [route, method] of [[files, 'GET'], [cron, 'GET'], [cron, 'POST'], [cron, 'DELETE']]) {
    pin = null; commands = []; const before = connections;
    const denied = await route[method](req, context);
    assert.equal(denied.success, false); assert.match(denied.error, /unverified/i);
    assert.equal(connections, before); assert.equal(commands.length, 0);
    pin = { host: config.host, port: 22, fingerprint: fingerprint(raw) };
    const accepted = await route[method](req, context);
    assert.equal(accepted.success, true); assert.equal(commands.length, 1);
    presented = changed; commands = [];
    const mismatch = await route[method](req, context);
    assert.equal(mismatch.success, false); assert.match(mismatch.error, /changed|verification/i); assert.equal(commands.length, 0);
    presented = raw;
  }
  assert.equal(helper.verifyKnownHost(`vps.example ssh-rsa ${raw.toString('base64')}`, config.host, 22, raw), false);
  env.SSH_KNOWN_HOSTS_PATH = '/offline/known_hosts';
  pin = null; knownHosts = `vps.example ssh-ed25519 ${raw.toString('base64')}`;
  await helper.createSSHConnection(config);
  knownHosts = `prefix.vps.example ssh-ed25519 ${raw.toString('base64')}`;
  await assert.rejects(helper.createSSHConnection(config), /verification/i);
  knownHosts = `[vps.example]:2222 ssh-ed25519 ${raw.toString('base64')}`;
  await helper.createSSHConnection({ ...config, port: 2222 });
  pin = { host: config.host, port: 2222, fingerprint: fingerprint(changed) };
  await assert.rejects(helper.createSSHConnection({ ...config, port: 2222 }), /verification/i);
  delete env.SSH_KNOWN_HOSTS_PATH;
  await assert.rejects(helper.createSSHConnection({ ...config, port: 0 }), /Invalid/);
  await assert.rejects(helper.createSSHConnection({ ...config, trustedFingerprint: 'bad' }), /Invalid/);
  for (const file of ['terminal', 'services/action']) {
    const route = load(`src/app/api/servers/[id]/${file}/route.ts`, common);
    const request = { ...req, json: async () => ({ command: 'true', service: 'fixture', action: 'start' }) };
    for (const [identity, key, allowed] of [[null, raw, false], [{ host: config.host, port: 22, fingerprint: fingerprint(raw) }, raw, true], [{ host: config.host, port: 22, fingerprint: fingerprint(raw) }, changed, false]]) {
      pin = identity; presented = key; commands = [];
      const result = await route.POST(request, context);
      assert.equal(commands.length > 0, allowed);
      if (file === 'terminal') { assert.equal(result.data.exitCode, allowed ? 0 : 1); if (!allowed) assert.match(result.data.output, /unverified|changed|verification/i); }
      else { assert.equal(result.success, allowed); if (!allowed) assert.match(result.error, /unverified|changed|verification/i); }
    }
  }
  presented = raw;
  prisma.appSetting.upsert = async ({ create }) => { pin = JSON.parse(create.value); trustWrites++; };
  prisma.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(prisma); };
  const test = load('src/app/api/servers/[id]/test/route.ts', common);
  const testReq = body => ({ ...req, json: async () => body });
  pin = null; commands = [];
  let result = await test.POST(testReq({}), context);
  assert.equal(result.data.identityStatus, 'unverified'); assert.equal(result.data.ok, false); assert.equal(commands.length, 0); assert.equal(trustWrites, 0);
  result = await test.POST(testReq({ trust: true, fingerprint: fingerprint(changed), previousFingerprint: null }), context);
  assert.equal(result.status, 409); assert.equal(trustWrites, 0);
  role = 'VIEWER'; result = await test.POST(testReq({ trust: true, fingerprint: fingerprint(raw), previousFingerprint: null }), context);
  assert.equal(result.status, 403); assert.equal(trustWrites, 0); role = 'ADMIN';
  result = await test.POST(testReq({ trust: true, fingerprint: fingerprint(raw), previousFingerprint: null }), context);
  assert.equal(result.data.identityStatus, 'verified'); assert.equal(result.data.ok, true); assert.equal(trustWrites, 1);
  presented = changed; commands = [];
  result = await test.POST(testReq({}), context);
  assert.equal(result.data.identityStatus, 'changed'); assert.equal(result.data.previousFingerprint, fingerprint(raw)); assert.equal(commands.length, 0); assert.equal(trustWrites, 1);
  result = await test.POST(testReq({ trust: true, fingerprint: fingerprint(changed), previousFingerprint: null }), context);
  assert.equal(result.data.ok, false); assert.equal(trustWrites, 1);
  result = await test.POST(testReq({ trust: true, fingerprint: fingerprint(changed), previousFingerprint: fingerprint(raw) }), context);
  assert.equal(result.data.ok, true); assert.equal(trustWrites, 2);
  // Exercise the real installed ssh2 client and exported probe over loopback only.
  const { Server, Client: RealClient } = require('ssh2');
  const loopbackKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  let authAttempts = 0;
  const listener = new Server({ hostKeys: [loopbackKey] }, client => {
    client.on('authentication', () => { authAttempts++; client.end(); });
    client.on('error', () => {});
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try {
    const actual = load('src/lib/ssh/connection.ts', { ssh2: { Client: RealClient } });
    const observed = await actual.probeSSHIdentity({ host: '127.0.0.1', port: listener.address().port });
    assert.match(observed, /^SHA256:[A-Za-z0-9+/]{43}$/);
    assert.equal(authAttempts, 0);
  } finally { await new Promise(resolve => listener.close(resolve)); }
  console.log('SSH identity helper + files GET + cron GET/POST/DELETE + terminal + services/action + trust test passed (offline raw key, changed key, exact host/port, unauthenticated probe)');
})().catch(error => { console.error(error); process.exitCode = 1; });
