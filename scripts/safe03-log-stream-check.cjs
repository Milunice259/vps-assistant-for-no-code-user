/* Offline actual-source checks: no Docker, SSH, DB, or production tokens. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const secrets = ['fixture-' + 'password-value', 'fixture-' + 'token-value'];
const fixture = `ordinary output\nPASSWORD=${secrets[0]}\nTOKEN="${secrets[1]}"\n`;
function clean(text) {
  assert.ok(!secrets.some(value => text.includes(value)), 'synthetic secret must not reach delivery');
}
function harness(local = false) {
  const timers = new Set();
  const channel = new EventEmitter();
  channel.stderr = new EventEmitter();
  let destroyed = 0, closed = 0, unsubscribed = 0, collected = 0;
  channel.destroy = () => { destroyed++; };
  const state = { valid: true, allowed: true, role: 'VIEWER', target: local ? 'local' : 'remote', cookieReads: 0, tokenChecks: [] };
  const session = () => state.valid ? { sub: 'original-actor', role: state.role } : null;
  const mocks = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    'next/headers': { cookies: async () => { state.cookieReads++; return { get: () => ({ value: 'original-token' }) }; } },
    '@/lib/auth': { getSession: async () => session(), verifySessionToken: async token => { state.tokenChecks.push(token); return session(); } },
    '@/lib/app-access': { authorizeApp: async () => null },
    '@/lib/server-access': { canAccessServer: async (actor, role, target) => {
      assert.equal(actor, 'original-actor'); assert.equal(role, state.role);
      return state.allowed && target === state.target;
    } },
    '@/lib/db': { prisma: { app: { findUnique: async () => ({ serverId: state.target, containerId: 'container', containerName: 'container', server: { host: 'fixture', port: 22, username: 'fixture' } }) } } },
    '@/lib/crypto': { decrypt: () => undefined },
    'ssh2-promise': function () {},
    '@/lib/server-ssh': { connectToServer: async () => ({ ssh: mocks['@/lib/ssh'].connection }), isDisconnectedError: () => false },
    '@/lib/ssh': { connection: { ssh: { connection: { exec: (_, cb) => cb(null, channel) } } }, createSSHConnection: async () => mocks['@/lib/ssh'].connection,
      closeSSH: async () => { closed++; }, getContainerLogs: async () => fixture, executeCommand: async () => fixture },
    '@/lib/local-server': { isLocalServer: id => id === 'local', isLocalAppId: id => id.startsWith('local::'), parseLocalContainerId: id => id.split('::')[1], execLocal: () => fixture, execOnHost: () => fixture },
    'node:child_process': { spawn: () => { channel.stdout = new EventEmitter(); channel.kill = () => { destroyed++; }; return channel; } },
    '@/lib/stats': { subscribeStats: () => () => { unsubscribed++; }, getHostStats: () => { collected++; return { cpu: collected }; } },
    '@/lib/sse-stream': { computeDelta: (_, next) => next },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true } }).outputText;
    const requireMock = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2) + '.ts'));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: requireMock, Response, ReadableStream, TextEncoder, TextDecoder, Buffer, URL, Error, Date,
      setInterval: fn => { const timer = { fn, unref() {} }; timers.add(timer); return timer; }, clearInterval: timer => timers.delete(timer), console }, { filename: file });
    return module.exports;
  }
  const req = new Request('http://fixture/api?lines=200');
  req.cookies = { get: () => ({ value: 'original-token' }) };
  const tick = async () => { for (const t of [...timers]) await t.fn(); await settle(); };
  const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  return { load: name => load(path.join(root, 'src', name)), req, state, channel, tick, settle, timers, mocks,
    counts: () => ({ destroyed, closed, unsubscribed, collected }) };
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function consume(response) {
  const reader = response.body.getReader(); let output = '', done = false;
  const completion = (async () => { while (true) { const item = await reader.read(); if (item.done) { done = true; break; } output += new TextDecoder().decode(item.value); } })();
  return { reader, completion, output: () => output, done: () => done };
}
test('REST local/remote, errors and downloadable payload redacted', async () => {
  for (const local of [true, false]) {
    const h = harness(local), route = h.load('app/api/apps/[id]/logs/route.ts');
    const context = { params: Promise.resolve({ id: local ? 'local::container' : 'app' }) };
    let response = await route.GET(h.req, context); let text = await response.text(); clean(text); assert.ok(text.includes('ordinary output'));
    h.mocks['@/lib/local-server'].execLocal = () => { throw new Error(fixture); };
    h.mocks['@/lib/ssh'].getContainerLogs = async () => { throw new Error(fixture); };
    response = await route.GET(h.req, context); clean(await response.text());
  }
});
test('SSE split key/value, stderr, final fragment and cleanup', async () => {
  const h = harness(); const response = await h.load('app/api/apps/[id]/logs/stream/route.ts').GET(h.req, { params: Promise.resolve({ id: 'app' }) });
  const c = consume(response); await h.settle();
  for (const chunk of ['ordinary output\nPASS', 'WORD=', secrets[0].slice(0, 8), secrets[0].slice(8) + '\nTO', 'KEN="', secrets[1], '"\n']) {
    h.channel.emit('data', Buffer.from(chunk)); await h.tick(); clean(c.output());
  }
  h.channel.stderr.emit('data', Buffer.from(`PASSWORD=${secrets[0]}`)); h.channel.emit('close'); await h.settle(); await c.completion;
  clean(c.output()); assert.ok(c.output().includes('ordinary output')); assert.ok(c.output().includes('[REDACTED]')); assert.equal(h.timers.size, 0); assert.ok(h.counts().closed > 0);
});
test('SSE original actor revocation/expiry and idle cleanup', async () => {
  for (const kind of ['valid', 'allowed', 'target']) {
    const h = harness(); const response = await h.load('app/api/apps/[id]/logs/stream/route.ts').GET(h.req, { params: Promise.resolve({ id: 'app' }) });
    const c = consume(response); await h.settle();
    h.channel.emit('data', Buffer.from('buffered output\n'));
    h.state[kind] = kind === 'target' ? 'other-server' : false;
    await h.tick(); assert.equal(c.output(), ''); assert.ok(c.done(), 'revoked idle stream closes'); assert.equal(h.timers.size, 0); assert.ok(h.counts().closed > 0);
    assert.ok(h.state.tokenChecks.length >= 2); assert.ok(h.state.tokenChecks.every(t => t === 'original-token')); assert.ok(h.state.cookieReads <= 1);
  }
});
test('SSE local/discovered functionality and cancellation', async () => {
  const h = harness(true); const response = await h.load('app/api/apps/[id]/logs/stream/route.ts').GET(h.req, { params: Promise.resolve({ id: 'discovered::local::container' }) });
  assert.equal(response.status, 200); const reader = response.body.getReader(); await h.settle(); await reader.cancel();
  assert.equal(h.timers.size, 0); assert.ok(h.counts().destroyed > 0);
});
test('local stats initial scope denial and active revocation/cancel', async () => {
  for (const mode of ['deny', 'revoke', 'cancel']) {
    const h = harness(true); if (mode === 'deny') h.state.allowed = false;
    const response = await h.load('app/api/stats/stream/route.ts').GET(h.req);
    if (mode === 'deny') { assert.equal(response.status, 403); assert.equal(h.counts().collected, 0); continue; }
    const c = consume(response); await h.settle(); const before = c.output();
    if (mode === 'cancel') await c.reader.cancel(); else { h.state.valid = false; await h.tick(); assert.equal(c.output(), before); assert.ok(c.done()); }
    assert.equal(h.timers.size, 0); assert.equal(h.counts().unsubscribed, 1);
  }
});
test('escaped quoted/JSON secret suffixes stay redacted', async () => {
  const { redactLogs } = harness().load('lib/log-redaction.ts');
  for (const quote of ['"', "'", '`']) {
    const value = `${secrets[0]}\\${quote}${secrets[1]}`;
    const output = redactLogs(`{ "TOKEN": ${quote}${value}${quote}, "message": "ordinary output" }`);
    clean(output); assert.ok(output.includes('ordinary output'));
    clean(redactLogs(`TOKEN=${quote}${value}`));
  }
});
test('Authorization Basic/Bearer redact complete credentials', async () => {
  const { redactLogs } = harness().load('lib/log-redaction.ts');
  for (const scheme of ['Basic', 'Bearer']) {
    for (const value of [`Authorization: ${scheme} ${secrets[0]}`, `{"Authorization":"${scheme} ${secrets[0]}"}`, `authorization=${scheme} ${secrets[0]}`]) {
      clean(redactLogs(value));
    }
  }
});
test('long word redaction is bounded without event-loop blocking', async () => {
  const { redactLogs } = harness().load('lib/log-redaction.ts');
  const input = 'x'.repeat(64 * 1024);
  vm.runInNewContext('redactLogs(input)', { redactLogs, input }, { timeout: 500 });
  clean(redactLogs(`${input}_TOKEN=${secrets[0]}`));
});
test('server logs local host/docker and remote errors are redacted', async () => {
  for (const local of [true, false]) {
    for (const source of ['system', 'docker']) {
      const h = harness(local), route = h.load('app/api/servers/[id]/logs/route.ts');
      h.req.nextUrl = new URL(`http://fixture/api?source=${source}&name=container`);
      const context = { params: Promise.resolve({ id: h.state.target }) };
      const success = await route.GET(h.req, context); assert.equal(success.status, 200); clean(await success.text());
      h.mocks['@/lib/local-server'].execLocal = h.mocks['@/lib/local-server'].execOnHost = () => { throw new Error(fixture); };
      h.mocks['@/lib/ssh'].executeCommand = async () => { throw new Error(fixture); };
      const response = await route.GET(h.req, context); assert.equal(response.status, 500); clean(await response.text());
    }
  }
});
test('ended SSE drains bounded backlog on pull with original authorization', async () => {
  for (const revoke of [false, true]) {
    const h = harness();
    const response = await h.load('app/api/apps/[id]/logs/stream/route.ts').GET(h.req, { params: Promise.resolve({ id: 'app' }) });
    await h.settle();
    // Fill the Web stream without a reader, then fill the separate bounded queue.
    h.channel.emit('data', Buffer.from(('! '.repeat(32750) + '\n').repeat(4))); await h.tick();
    h.channel.emit('data', Buffer.from('! '.repeat(100) + '\n')); await h.tick();
    for (let i = 0; i < 1200; i++) h.channel.emit('data', Buffer.from(`backlog-${i}\n`));
    h.channel.emit('data', Buffer.from('last normal line'));
    h.channel.emit('close'); await h.settle();
    assert.ok(h.timers.size > 0, 'ended backlog must stay available until pull or revocation');
    if (revoke) h.state.valid = false;
    const before = h.state.tokenChecks.length;
    const reader = response.body.getReader();
    let output = '', done = false;
    for (let i = 0; i < 8; i++) {
      const item = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('pull timeout')), 200))]);
      if (item.done) { done = true; break; }
      output += new TextDecoder().decode(item.value);
    }
    assert.ok(done, 'pull must drain then close without a timer tick');
    assert.equal(output.includes('last normal line'), !revoke);
    assert.ok(!output.includes('backlog-0\\n'), 'oldest queued lines are dropped at the existing bound');
    assert.ok(h.state.tokenChecks.length > before, 'pull rechecks authorization');
    assert.ok(h.state.tokenChecks.every(t => t === 'original-token'));
    assert.equal(h.timers.size, 0); assert.ok(h.counts().closed > 0);
  }
});
test('app stats rechecks original token and closes on revoke/expiry/target change', async () => {
  for (const kind of ['valid', 'allowed', 'target']) {
    const h = harness(true);
    h.mocks['@/lib/local-server'].execLocal = () => '1%|1MiB / 2MiB|1kB / 2kB|3';
    const response = await h.load('app/api/apps/[id]/stream/route.ts').GET(h.req, { params: Promise.resolve({ id: 'app' }) });
    assert.equal(response.status, 200);
    const c = consume(response); await h.settle(); assert.ok(c.output().includes('snapshot'));
    const before = c.output();
    h.req.cookies.get = () => ({ value: 'replacement-token' });
    h.state[kind] = kind === 'target' ? 'other-server' : false;
    await h.tick(); await c.completion;
    assert.equal(c.output(), before); assert.equal(h.timers.size, 0);
    assert.ok(h.state.tokenChecks.length >= 3); assert.ok(h.state.tokenChecks.every(t => t === 'original-token'));
    assert.equal(h.state.cookieReads, 0);
  }
});
(async () => {
  let failed = 0;
  for (const { name, fn } of tests) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed++; console.log(`FAIL ${name}: ${error.code || error.name} ${String(error.stack).split('\n').find(line => /^\s+at /.test(line))?.trim() || ''}`); } }
  assert.equal(failed, 0, `${failed} offline checks failed`);
})().catch(() => { process.exitCode = 1; });
