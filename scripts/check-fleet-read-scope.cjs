// Run: node scripts/check-fleet-read-scope.cjs — mocked DB/SSH only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let session;
let allowed = [];
let mode = 'SELECTED';
let calls = [];
let fetchStream;
const timers = new Map();
let requestContext = true;
let cookieReads = 0;
let cookieToken = 'original-login';
let verifiedTokens = [];
let active = true;
let logoutVersion = 0;
let expired = false;
const verifySessionToken = async (token) => {
  verifiedTokens.push(token);
  assert.equal(token, 'original-login', 'polling must verify the original login token');
  if (!requestContext) assert.deepEqual(calls, [], 'verification must precede local reads and aggregate queries');
  return active && logoutVersion === 0 && !expired ? session : null;
};
const servers = ['server-a', 'server-b'].map((id) => ({ id, name: id, host: id, port: 22, username: 'test', authMethod: 'KEY', isActive: true, createdAt: new Date(0) }));
const apps = [{ serverId: 'server-a', status: 'RUNNING' }, { serverId: 'server-b', status: 'STOPPED' }];
const deployments = [{ serverId: null, status: 'RUNNING' }, { serverId: 'server-a', status: 'FAILED' }, { serverId: 'server-b', status: 'FAILED' }];
const events = [{ userId: 'me', action: 'test', target: 'same-server' }, { userId: 'other', action: 'test', target: 'same-server' }, { userId: null, action: 'test', target: 'me' }];
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((clause) => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] != null && row[key] !== value.not;
      if ('contains' in value) return row[key]?.includes(value.contains);
      if ('gte' in value) return true;
    }
    return row[key] === value;
  });
}
function group(name, rows, query) {
  calls.push([name, query]);
  const key = query.by[0];
  const counts = new Map();
  rows.filter((row) => matches(row, query.where)).forEach((row) => counts.set(row[key], (counts.get(row[key]) || 0) + 1));
  return [...counts].map(([value, count]) => ({ [key]: value, _count: count }));
}
const prisma = {
  user: { findUnique: async () => ({ serverAccessMode: mode }) },
  userServerAccess: {
    findUnique: async ({ where }) => allowed.includes(where.userId_serverId.serverId) ? {} : null,
    findMany: async () => allowed.filter((id) => id !== 'local').map((serverId) => ({ serverId })),
  },
  server: {
    findMany: async (query) => { calls.push(['servers', query]); return servers.filter((row) => matches(row, query.where)); },
    groupBy: async (query) => group('server-counts', servers, query),
  },
  app: { groupBy: async (query) => group('app-counts', apps, query) },
  deploymentLog: {
    groupBy: async (query) => group('deployment-counts', deployments, query),
    count: async (query) => { calls.push(['recent', query]); return deployments.filter((row) => matches(row, query.where)).length; },
  },
  auditLog: {
    findMany: async (query) => { calls.push(['audit', query]); return events.filter((row) => matches(row, query.where)); },
    count: async (query) => { calls.push(['audit-total', query]); return events.filter((row) => matches(row, query.where)).length; },
  },
};
const stats = { cpu: { usagePercent: 1 }, memory: { usagePercent: 2 }, disk: { usagePercent: 3 }, uptime: 4 };
const localRead = () => { calls.push(['local-read']); return ''; };
const mocks = {
  'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
  '@/lib/db': { prisma },
  'next/headers': { cookies: async () => {
    assert(requestContext, 'cookies must never be read from the polling timer');
    cookieReads++;
    return { get: (name) => { assert.equal(name, 'vps-session'); return cookieToken ? { value: cookieToken } : undefined; } };
  } },
  '@/lib/auth': { getSession: async () => { assert(requestContext, 'getSession must not run from the polling timer'); return session; }, verifySessionToken },
  '@/lib/local-server': {
    getLocalServerInfo: () => { calls.push(['local-info']); return { id: 'local', name: 'Local', host: 'local' }; },
    isLocalServer: (id) => id === 'local', execLocal: localRead, tryExecOnHost: localRead, readHostFile: localRead,
  },
  '@/lib/stats': { getHostStats: () => { calls.push(['local-stats']); return stats; } },
  '@/lib/server-ssh': { connectToServer: async (id) => { calls.push(['ssh', id]); return { ssh: id }; }, isDisconnectedError: () => false },
  '@/lib/ssh': { getRemoteStats: async () => stats, closeSSH: async () => {} },
  '@/lib/safe-error': { safeErrorMessage: (_err, fallback) => fallback },
  '@/lib/sse-stream': { createSSEResponse: (fetch) => { calls.push(['stream']); fetchStream = fetch; return Response.json({}); } },
};
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const req = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return load('src/' + id.slice(2) + '.ts');
    throw Error('Unexpected import: ' + id);
  };
  vm.runInThisContext(`(function(require,module,exports,setTimeout,setInterval,clearInterval){${code}\n})`, { filename: relative })(
    req, mod, mod.exports, (fn) => { fn(); return 0; },
    (fn, ms) => { timers.set(ms, fn); return ms; }, (id) => timers.delete(id)
  );
  cache.set(relative, mod.exports);
  return mod.exports;
}
async function main() {
  const risk = load('src/app/api/risk/route.ts');
  const summary = load('src/app/api/dashboard/summary/route.ts');
  const stream = load('src/app/api/dashboard/stream/route.ts');
  const audit = load('src/app/api/audit/route.ts');
  const request = new Request('http://check.invalid/api/audit?action=test&target=same-server');
  for (const route of [risk, summary, stream, audit]) {
    session = null; calls = [];
    assert.equal((await route.GET(request)).status, 401, 'anonymous must fail before reads');
    assert.deepEqual(calls, []);
  }
  session = { sub: 'me', role: 'VIEWER' }; allowed = ['server-a']; calls = [];
  let response = await risk.GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.servers.map((row) => row.serverId), ['server-a']);
  assert.deepEqual(calls.filter(([kind]) => kind === 'ssh'), [['ssh', 'server-a']]);
  assert(!calls.some(([kind]) => kind.startsWith('local-')), 'no local metadata/stats without grant');
  for (const route of [summary, stream]) {
    calls = [];
    assert.equal((await route.GET()).status, 403, 'mixed local summary fails closed');
    assert.deepEqual(calls, [], 'denied summary must not run local commands or aggregate queries');
  }
  allowed = ['local', 'server-a']; calls = [];
  response = await risk.GET();
  assert.deepEqual((await response.json()).data.servers.map((row) => row.serverId), ['local', 'server-a']);
  response = await summary.GET();
  assert.equal(response.status, 200);
  let data = (await response.json()).data;
  assert.deepEqual(data.servers, { total: 2, active: 2, remote: 1, inactive: 0 });
  assert.deepEqual(data.apps, { total: 1, running: 1, stopped: 0 });
  assert.deepEqual(data.deployments, { total: 2, running: 1, failed: 1, recent: 2 });
  assert(calls.some(([kind]) => kind === 'local-read'));
  cookieReads = 0; verifiedTokens = [];
  response = await stream.GET();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, no-transform');
  assert.equal(response.headers.get('Vary'), 'Cookie');
  requestContext = false; cookieToken = 'replacement-login'; calls = [];
  data = await fetchStream();
  assert.equal(data.servers.remote, 1, 'valid polling uses original token without request cookies');
  session = null; calls = [];
  await assert.rejects(() => fetchStream(), /Unauthorized/);
  assert.deepEqual(calls, [], 'invalid session must not fall back to captured role');
  assert.equal(cookieReads, 1, 'capture cookies once during the request');
  assert.equal(verifiedTokens.length, 3, 'verify on request and before each snapshot');
  requestContext = true; cookieToken = 'original-login';
  for (const role of ['OWNER', 'ADMIN']) {
    for (const reason of ['disablement', 'logoutVersion', 'expiry']) {
      session = { sub: 'me', role }; calls = []; verifiedTokens = [];
      await stream.GET();
      requestContext = false;
      active = reason !== 'disablement'; logoutVersion = reason === 'logoutVersion' ? 1 : 0; expired = reason === 'expiry';
      for (let poll = 0; poll < 2; poll++) {
        calls = [];
        await assert.rejects(() => fetchStream(), /Unauthorized/, `${role} ${reason} rejects every poll`);
        assert.deepEqual(calls, [], `${role} ${reason} must stop local reads and aggregate queries`);
      }
      assert.equal(verifiedTokens.length, 3, `${role} ${reason} verifies each poll`);
      active = true; logoutVersion = 0; expired = false; requestContext = true;
    }
    session = { sub: 'me', role }; allowed = []; mode = 'SELECTED'; calls = [];
    await stream.GET();
    requestContext = false; session = { sub: 'me', role: 'VIEWER' }; calls = [];
    await assert.rejects(() => fetchStream(), /Local server access/);
    assert.deepEqual(calls, [], `${role} demotion without local grant rejects before reads`);
    allowed = ['local', 'server-a']; calls = [];
    data = await fetchStream();
    assert.deepEqual(data.servers, { total: 2, active: 2, remote: 1, inactive: 0 }, `${role} demotion applies selected scope`);
    assert.deepEqual(data.apps, { total: 1, running: 1, stopped: 0 });
    assert.deepEqual(data.deployments, { total: 2, running: 1, failed: 1, recent: 2 });
    assert.deepEqual(calls.find(([kind]) => kind === 'server-counts')[1].where, { id: { in: ['server-a'] } });
    allowed = ['server-a']; calls = [];
    await assert.rejects(() => fetchStream(), /Local server access/);
    assert.deepEqual(calls, [], 'revoked local grant prevents polling reads');
    requestContext = true;
  }
  session = { sub: 'me', role: 'MANAGER' }; calls = [];
  response = await audit.GET(request);
  data = await response.json();
  assert.equal(data.total, 1);
  assert.deepEqual(data.data, [events[0]]);
  assert.equal(calls[0][1].where.userId, 'me');
  assert.deepEqual(calls[0][1].where, calls[1][1].where, 'pagination total uses same actor scope');
  for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']) {
    session = { sub: 'me', role }; mode = 'ALL'; allowed = []; calls = [];
    data = (await (await summary.GET()).json()).data;
    assert.equal(data.servers.remote, 2, `${role} ALL sees all servers`);
    assert.equal(data.apps.total, 2);
    assert.equal(data.deployments.total, 3);
    assert.equal(data.deployments.recent, 3);
    data = await (await audit.GET(new Request('http://check.invalid/api/audit'))).json();
    assert.equal(data.total, ['OWNER', 'ADMIN'].includes(role) ? 3 : 1, `${role} audit scope`);
  }
  session = { sub: 'me', role: 'VIEWER' }; mode = 'SELECTED'; allowed = []; calls = [];
  response = await risk.GET();
  assert.equal(response.status, 403, 'no scope must not fabricate a healthy fleet');
  assert(!calls.some(([kind]) => ['ssh', 'local-info', 'local-stats'].includes(kind)));
  allowed = ['local']; calls = [];
  data = (await (await summary.GET()).json()).data;
  assert.equal(data.servers.remote, 0);
  assert.equal(data.apps.total, 0);
  assert.equal(data.deployments.total, 1);
  // Exercise the real SSE helper: rejected polls must emit neither snapshots nor deltas.
  mocks['@/lib/sse-stream'] = load('src/lib/sse-stream.ts');
  cache.delete('src/app/api/dashboard/stream/route.ts');
  const realStream = load('src/app/api/dashboard/stream/route.ts');
  for (const reason of ['disablement', 'logoutVersion', 'expiry', 'demotion', 'grant removal']) {
    session = { sub: 'me', role: reason === 'grant removal' ? 'VIEWER' : 'ADMIN' };
    allowed = ['local', 'server-a']; calls = []; requestContext = true;
    response = await realStream.GET();
    const reader = response.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert(initial.startsWith('event: snapshot\n'));
    await Promise.resolve();
    const poll = timers.get(10_000);
    assert.equal(typeof poll, 'function', 'real SSE polling timer is installed');
    requestContext = false; calls = [];
    active = reason !== 'disablement'; logoutVersion = reason === 'logoutVersion' ? 1 : 0; expired = reason === 'expiry';
    if (reason === 'demotion') session = { sub: 'me', role: 'VIEWER' };
    if (['demotion', 'grant removal'].includes(reason)) allowed = ['server-a'];
    const next = reader.read();
    await poll();
    assert.deepEqual(calls, [], `${reason} prevents sensitive reads in real SSE polling`);
    await reader.cancel();
    assert.equal((await next).done, true, `${reason} must not enqueue sensitive SSE data`);
    assert.equal(timers.size, 0, 'cancel cleans up polling and heartbeat timers');
    active = true; logoutVersion = 0; expired = false; requestContext = true;
  }
  console.log('fleet read scope: anonymous/selected/ALL roles, pre-read denial, scoped counts, original-token polling, disablement/logoutVersion/expiry rejection, demotion/grant revocation, no revoked SSE data emissions, actor-only audit passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
