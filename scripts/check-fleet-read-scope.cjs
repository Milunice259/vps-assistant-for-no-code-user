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
const servers = ['server-a', 'server-b'].map((id) => ({ id, name: id, host: id, port: 22, username: 'test', authMethod: 'KEY', isActive: true, createdAt: new Date(0), updatedAt: new Date(0) }));
const apps = [{ serverId: 'server-a', status: 'RUNNING' }, { serverId: 'server-b', status: 'STOPPED' }].map((app) => ({ ...app, id: app.serverId + '-app', createdAt: new Date(0), server: { name: app.serverId } }));
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
  },
  app: { findMany: async (query) => { calls.push(['apps', query]); return apps.filter((row) => matches(row, query.where)); } },
  deploymentLog: {
    groupBy: async (query) => group('deployment-counts', deployments, query),
    count: async (query) => { calls.push(['recent', query]); return deployments.filter((row) => matches(row, query.where)).length; },
  },
  auditLog: {
    findMany: async (query) => { calls.push(['audit', query]); return events.filter((row) => matches(row, query.where)); },
    count: async (query) => { calls.push(['audit-total', query]); return events.filter((row) => matches(row, query.where)).length; },
  },
};
const mutations = [];
for (const model of Object.values(prisma)) for (const method of ['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany']) {
  model[method] = async () => { mutations.push(method); throw Error('Unexpected target mutation'); };
}
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
    isLocalServer: (id) => id === 'local', execLocal: localRead, execOnHost: localRead, tryExecOnHost: localRead, readHostFile: localRead,
    getLocalHostPorts: () => { calls.push(['local-ports']); return []; },
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
  const localStats = load('src/app/api/stats/stream/route.ts');
  const localRequest = { cookies: { get: () => ({ value: 'original-login' }) } };
  function scopedSummary(data, ids, local) {
    assert.deepEqual(data.servers, { total: ids.length + Number(local), active: ids.length + Number(local), remote: ids.length, inactive: 0 });
    assert.deepEqual(data.apps, { total: ids.length, running: 0, stopped: 0 }, 'stored status is not a live observation');
    assert.deepEqual(data.deployments, { total: ids.length + Number(local), running: Number(local), failed: ids.length, recent: ids.length + Number(local) });
    assert.deepEqual(calls.find(([kind]) => kind === 'servers')[1].where, { id: { in: ids } });
    assert.deepEqual(calls.find(([kind]) => kind === 'apps')[1].where, { OR: [{ serverId: { in: ids } }, ...(local ? [{ serverId: 'local' }] : [])] });
    for (const kind of ['deployment-counts', 'recent']) assert.deepEqual(calls.find(([name]) => name === kind)[1].where.OR, [{ serverId: { in: ids } }, ...(local ? [{ serverId: 'local' }, { serverId: null }] : [])]);
    assert(!calls.some(([kind]) => kind === 'ssh'), 'summary must not connect or mutate remote targets');
    if (!local) {
      for (const field of ['containers', 'network', 'os']) assert.equal(data[field], null);
      assert(!calls.some(([kind]) => kind.startsWith('local-')), 'remote/empty scope must not read local data');
    }
  }
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
  calls = [];
  response = await summary.GET();
  assert.equal(response.status, 200, 'authorized remote-only summary does not require local access');
  scopedSummary((await response.json()).data, ['server-a'], false);
  calls = [];
  assert.equal((await stream.GET()).status, 200);
  scopedSummary(await fetchStream(), ['server-a'], false);
  calls = [];
  assert.equal((await localStats.GET(localRequest)).status, 403, 'local-only endpoint still denies remote-only scope');
  assert.deepEqual(calls, [], 'local denial precedes host reads and queries');
  allowed = ['local', 'server-a']; calls = [];
  response = await risk.GET();
  assert.deepEqual((await response.json()).data.servers.map((row) => row.serverId), ['local', 'server-a']);
  response = await summary.GET();
  assert.equal(response.status, 200);
  let data = (await response.json()).data;
  assert.deepEqual(data.servers, { total: 2, active: 2, remote: 1, inactive: 0 });
  assert.deepEqual(data.apps, { total: 1, running: 0, stopped: 0 });
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
    scopedSummary(await fetchStream(), [], false);
    calls = [];
    assert.equal((await localStats.GET(localRequest)).status, 403);
    assert.deepEqual(calls, [], `${role} demotion without local grant denies local reads`);
    allowed = ['local', 'server-a']; calls = [];
    data = await fetchStream();
    assert.deepEqual(data.servers, { total: 2, active: 2, remote: 1, inactive: 0 }, `${role} demotion applies selected scope`);
    assert.deepEqual(data.apps, { total: 1, running: 0, stopped: 0 });
    assert.deepEqual(data.deployments, { total: 2, running: 1, failed: 1, recent: 2 });
    assert.deepEqual(calls.find(([kind]) => kind === 'servers')[1].where, { id: { in: ['server-a'] } });
    allowed = ['server-a']; calls = [];
    scopedSummary(await fetchStream(), ['server-a'], false);
    calls = [];
    assert.equal((await localStats.GET(localRequest)).status, 403);
    assert.deepEqual(calls, [], 'revoked local grant prevents local-only reads');
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
  calls = [];
  response = await summary.GET();
  assert.equal(response.status, 200, 'empty authorized dashboard scope returns zero counts, not local data');
  scopedSummary((await response.json()).data, [], false);
  calls = [];
  assert.equal((await localStats.GET(localRequest)).status, 403);
  assert.deepEqual(calls, []);
  allowed = ['local']; calls = [];
  data = (await (await summary.GET()).json()).data;
  assert.equal(data.servers.remote, 0);
  assert.equal(data.apps.total, 0);
  assert.equal(data.deployments.total, 1);
  // Real SSE: invalid sessions emit no data; grant changes emit only fresh scoped deltas.
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
    if (reason === 'demotion') allowed = ['server-a'];
    if (reason === 'grant removal') allowed = [];
    const next = reader.read();
    await poll();
    if (['demotion', 'grant removal'].includes(reason)) {
      assert(!calls.some(([kind]) => kind.startsWith('local-') || kind === 'ssh'), `${reason} prevents revoked target reads`);
      const ids = reason === 'demotion' ? ['server-a'] : [];
      assert.deepEqual(calls.find(([kind]) => kind === 'servers')[1].where, { id: { in: ids } });
      const event = new TextDecoder().decode((await next).value);
      assert(event.startsWith('event: delta\n'), 'scope changes emit only the newly authorized summary');
      const delta = JSON.parse(event.split('\ndata: ')[1]);
      assert.equal(delta.servers.total, ids.length);
      assert.equal(delta.deployments.total, ids.length);
      if (reason === 'grant removal') assert.equal(delta.apps.total, 0, 'revoked remote apps are cleared');
      assert.equal(delta.containers, null, 'revoked local container counts are cleared');
      assert.equal(delta.network, null, 'revoked local network counts are cleared');
      await reader.cancel();
    } else {
      assert.deepEqual(calls, [], `${reason} prevents sensitive reads in real SSE polling`);
      await reader.cancel();
      assert.equal((await next).done, true, `${reason} must not enqueue sensitive SSE data`);
    }
    assert.equal(timers.size, 0, 'cancel cleans up polling and heartbeat timers');
    active = true; logoutVersion = 0; expired = false; requestContext = true;
  }
  assert.deepEqual(mutations, [], 'read routes never mutate targets');
  console.log('fleet read scope: anonymous/selected/ALL roles, remote-only/empty summaries, local-only pre-read denial, scoped counts, original-token polling, session rejection, demotion/grant refresh without revoked target data, no target mutations, actor-only audit passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
