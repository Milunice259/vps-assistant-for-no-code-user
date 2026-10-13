// Run: node scripts/check-safe04-permissions.cjs — mocked auth/executors + disposable real SQLite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let session, calls, audits, allowed, mode, target, otherOwners, remoteOffline;
const servers = ['server-a', 'server-b'].map(id => ({ id, name: id, createdAt: new Date(0) }));
const stats = { cpu: { usagePercent: 1 }, memory: { usagePercent: 2 }, disk: { usagePercent: 3 } };
const record = (kind, data) => calls.push([kind, data]);
const prisma = {
  $executeRaw: async () => record('sqlite-write-lock'),
  $queryRawUnsafe: async query => { assert.equal(query, 'PRAGMA database_list'); record('backup-db-read'); return [{ name: 'main', file: '/fixture/panel.db' }]; },
  deploymentLog: { findMany: async q => { record('deployment-read', q); return []; } },
  user: {
    findUnique: async q => { if (q.select?.serverAccessMode && !q.include) return { serverAccessMode: mode }; record('user-read', q); return structuredClone(target); },
    findFirst: async () => null,
    count: async () => otherOwners,
    update: async q => { record('user-write', q); const updated = { ...target, ...q.data, serverAccess: target.serverAccess }; target = updated; return updated; },
    delete: async () => { record('user-delete'); target = null; },
  },
  userServerAccess: {
    findUnique: async q => allowed.includes(q.where.userId_serverId.serverId) ? {} : null,
    findMany: async q => q.where.userId === 'target' ? target.serverAccess : allowed.filter(id => id !== 'local').map(serverId => ({ serverId })),
    deleteMany: async () => { record('grant-delete'); target.serverAccess = []; },
    createMany: async q => { record('grant-create', q); target.serverAccess = q.data.map(({ serverId }) => ({ serverId })); },
  },
  server: { findMany: async q => { record('server-read', q); return servers.filter(s => !q.where?.id || q.where.id.in.includes(s.id)); } },
  app: { findMany: async q => { record('app-read', q); return []; } },
  auditLog: { create: async q => { if (auditFailure) throw Error('synthetic audit unavailable'); audits.push(q.data); return q.data; }, deleteMany: async () => record('audit-cleanup') },
};
for (const name of ['notificationChannel', 'alertRule']) prisma[name] = Object.fromEntries(['findMany', 'create', 'update', 'delete'].map(method => [method, async q => {
  record(name + '-' + method, q); return method === 'findMany' ? [{ id: 'channel', webhookUrl: 'synthetic-secret', alertRules: [{ serverId: 'server-b' }] }] : { id: 'created', ...(name === 'notificationChannel' ? { webhookUrl: 'synthetic-secret' } : {}), ...q.data };
}]));
let auditFailure = false;
prisma.$transaction = async fn => {
  const before = structuredClone(target), beforeAudits = [...audits];
  try { return await fn(prisma); } catch (error) { target = before; audits = beforeAudits; throw error; }
};
const NextResponse = class extends Response {
  static json(body, init) { return Response.json(body, init); }
  static next() { return new Response(null, { headers: { 'x-middleware-next': '1' } }); }
};
const auth = { getSession: async () => session, verifySessionToken: async () => session, hashPassword: async () => 'synthetic-hash' };
const mocks = {
  'next/server': { NextResponse }, '@/lib/auth': auth, './lib/auth': auth,
  '@/lib/db': { prisma },
  '@/lib/audit': { auditLog: async entry => audits.push(entry), getClientIp: () => '192.0.2.1' },
  '@/lib/security-settings': { getSecuritySettings: async () => { record('security-read'); return {}; }, saveSecuritySettings: async body => { record('security-save', body); return body; } },
  '@/lib/password-policy': { passwordPolicyError: () => null },
  '@/lib/safe-error': { safeErrorMessage: (_e, fallback) => fallback },
  './lib/operation-safety': { requiresAdvancedAuthorization: () => false },
  '@/lib/notifications': { sendNotification: async () => { record('delivery'); return true; }, evaluateAlertRules: async (...args) => record('evaluate', args) },
  '@/lib/deployment-state': { readDeploymentDefinition: async () => { throw Error('No deployment fixture expected'); } },
  '@/lib/local-server': { execLocal: command => { record('local-exec', command); assert(command.includes('MON5_DOCKER_OK')); return 'MON5_DOCKER_OK'; }, getLocalServerInfo: () => { record('local-info'); return { id: 'local', name: 'Local' }; }, isLocalServer: id => id === 'local', getLocalContainers: () => { record('local-exec'); return []; }, getLocalServices: () => ({ services: [] }) },
  '@/lib/stats': { getHostStats: () => stats },
  '@/lib/server-ssh': { connectToServer: async id => { record('ssh', id); if (remoteOffline) throw Error('synthetic offline'); return { ssh: id }; } },
  '@/lib/ssh': { executeCommand: async (id, command) => { record('remote-exec', id); assert(command.includes('MON5_DOCKER_OK')); return 'MON5_DOCKER_OK'; }, getRemoteStats: async () => stats, getRemoteContainers: async () => [], getRemoteServices: async () => [], closeSSH: async () => {}, executeCommandSafe: async () => { throw Error('SSL execution not expected'); } },
  'node:fs': { lstatSync: () => { record('backup-read'); throw Error('No fixture backup'); }, readdirSync: () => { throw Error('Unexpected backup listing'); }, realpathSync: () => { throw Error('Unexpected backup resolution'); } },
  'node:path': require('node:path'),
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const req = id => {
    if (id in mocks) return mocks[id];
    if (id === './lib/server-access') return load('src/lib/server-access.ts');
    if (id.startsWith('@/')) return load('src/' + id.slice(2) + '.ts');
    throw Error('Unexpected import: ' + id);
  };
  vm.runInThisContext(`(function(require,module,exports,setInterval){${code}\n})`, { filename: file })(req, mod, mod.exports, () => 0);
  cache.set(file, mod.exports); return mod.exports;
}
function reset(role = 'OWNER') {
  session = role ? { sub: 'actor', username: 'synthetic-actor', role } : null;
  calls = []; audits = []; auditFailure = false; allowed = ['server-a']; mode = 'SELECTED'; otherOwners = 0; remoteOffline = false;
  target = { id: 'target', username: 'synthetic-target', role: 'MANAGER', isActive: true, serverAccessMode: 'SELECTED', serverAccess: [{ serverId: 'server-b' }] };
}
function request(url, method = 'POST', body) {
  const req = new Request('http://fixture.invalid' + url, { method, headers: { origin: 'http://fixture.invalid', host: 'fixture.invalid', 'x-forwarded-for': '192.0.2.' + ++request.ip, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  req.nextUrl = new URL(req.url); req.cookies = { get: () => ({ value: 'synthetic-token' }) }; return req;
}
request.ip = 0;
const ctx = { params: Promise.resolve({ id: 'target' }) };
async function sqliteOwnerConcurrency() {
  const { PrismaClient } = require('@prisma/client');
  const { AsyncLocalStorage } = require('node:async_hooks');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'safe04-owners-'));
  const url = 'file:' + path.join(dir, 'owners.db');
  const clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url } } }));
  const scope = new AsyncLocalStorage();
  const db = new Proxy({}, { get: (_target, key) => {
    const client = scope.getStore() || clients[0];
    if (key === '$transaction') return client.$transaction.bind(client);
    if (key === 'user') return new Proxy(client.user, { get: (model, method) => {
      if (method !== 'count') return model[method].bind(model);
      // Force both legacy OUTSIDE-transaction counts to observe the same two Owners.
      return async q => { const result = await model.count(q); await countBarrier(); return result; };
    } });
    return client[key];
  } });
  let countBarrier = async () => {};
  const oldDb = mocks['@/lib/db']; mocks['@/lib/db'] = { prisma: db };
  cache.delete('src/app/api/users/[id]/route.ts'); cache.delete('src/lib/server-access.ts');
  const users = load('src/app/api/users/[id]/route.ts');
  try {
    await clients[0].$executeRawUnsafe(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT, display_name TEXT, password_hash TEXT NOT NULL, role TEXT NOT NULL, server_access_mode TEXT NOT NULL DEFAULT 'ALL', passcode_enabled BOOLEAN NOT NULL DEFAULT 0, passcode_hash TEXT, passcode_updated_at DATETIME, is_active BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await clients[0].$executeRawUnsafe(`CREATE TABLE user_server_access (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, server_id TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, server_id))`);
    await clients[0].$executeRawUnsafe(`CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, user_id TEXT, username TEXT NOT NULL DEFAULT 'system', target TEXT, details TEXT, ip TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const operation of ['demote', 'disable', 'delete', 'mixed']) {
      reset();
      await clients[0].auditLog.deleteMany(); await clients[0].user.deleteMany();
      for (const id of ['owner-a', 'owner-b']) await clients[0].user.create({ data: { id, username: id, passwordHash: 'fixture-only', role: 'OWNER', isActive: true } });
      let reads = 0, release;
      const bothRead = new Promise(resolve => { release = resolve; });
      countBarrier = async () => { if (++reads === 2) release(); await bothRead; };
      const results = await Promise.all(clients.map((client, i) => scope.run(client, () => {
        const id = ['owner-a', 'owner-b'][i];
        const del = operation === 'delete' || (operation === 'mixed' && i === 1);
        return users[del ? 'DELETE' : 'PUT'](request('/api/users/' + id, del ? 'DELETE' : 'PUT', del ? undefined : operation === 'disable' ? { isActive: false } : { role: 'ADMIN' }), { params: Promise.resolve({ id }) });
      })));
      countBarrier = async () => {};
      const remaining = await clients[0].user.count({ where: { role: 'OWNER', isActive: true } });
      assert.equal(remaining, 1, `${operation}: simultaneous removals must leave one active Owner (statuses ${results.map(r => r.status)})`);
      assert.equal(results.filter(r => r.status === 200).length, 1, `${operation}: only one mutation may commit`);
      assert.equal(await clients[0].auditLog.count(), 1, `${operation}: only committed mutation audited`);
      assert(!JSON.stringify(await clients[0].auditLog.findMany()).includes('fixture-only'));
      console.log(`SAFE-04 SQLite ${operation}: statuses ${results.map(r => r.status)}, active Owners ${remaining}, committed audits 1`);
    }
  } finally {
    mocks['@/lib/db'] = oldDb;
    await Promise.all(clients.map(client => client.$disconnect()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function main() {
  const security = load('src/app/api/settings/security/route.ts');
  const users = load('src/app/api/users/[id]/route.ts');
  const channels = load('src/app/api/notifications/route.ts');
  const checks = load('src/app/api/notifications/check/route.ts');
  const service = load('src/lib/notification-checks.ts');
  const middleware = load('src/middleware.ts').middleware;
  // Real middleware and each real handler must deny before sensitive reads/execution, even when called directly.
  assert.deepEqual(Object.keys(channels).filter(k => ['GET', 'POST', 'PATCH', 'DELETE'].includes(k)).sort(), ['DELETE', 'GET', 'PATCH', 'POST']);
  const adminCases = [
    ['/api/notifications', 'GET', undefined, channels.GET],
    ['/api/notifications', 'POST', { type: 'channel', name: 'Synthetic', channelType: 'discord', webhookUrl: 'https://fixture.invalid' }, channels.POST],
    ['/api/notifications', 'POST', { type: 'alert', metric: 'cpu', threshold: 80, channelId: 'channel', serverId: 'server-b' }, channels.POST],
    ['/api/notifications', 'POST', { type: 'test', channelId: 'channel' }, channels.POST],
    ['/api/notifications', 'PATCH', { type: 'channel', id: 'channel', enabled: false }, channels.PATCH],
    ['/api/notifications', 'PATCH', { type: 'alert', id: 'rule', threshold: 90, cooldownMin: 20, enabled: false }, channels.PATCH],
    ['/api/notifications?id=channel&type=channel', 'DELETE', undefined, channels.DELETE],
    ['/api/notifications?id=rule&type=alert', 'DELETE', undefined, channels.DELETE],
    ['/api/settings/security', 'PUT', { idleTimeoutMinutes: 10 }, security.PUT],
    ['/api/users/target', 'PUT', { displayName: 'Synthetic' }, req => users.PUT(req, ctx)],
    ['/api/users/target', 'DELETE', undefined, req => users.DELETE(req, ctx)],
  ];
  for (const role of [null, 'VIEWER', 'MANAGER', 'OPERATOR']) for (const [url, method, body, handler] of adminCases) {
    reset(role); const status = role ? 403 : 401;
    assert.equal((await middleware(request(url, method, body))).status, status, `${role} middleware ${method} ${url}`);
    assert.deepEqual(calls, []);
    assert.equal((await handler(request(url, method, body))).status, status, `${role} handler ${method} ${url}`);
    assert.deepEqual(calls, [], 'denial must precede sensitive reads, writes and delivery');
  }
  reset(null); assert.equal((await security.GET()).status, 401); assert.deepEqual(calls, []);
  for (const role of ['OWNER', 'ADMIN']) for (const [url, method, body, handler] of adminCases) {
    reset(role);
    assert.equal((await middleware(request(url, method, body))).headers.get('x-middleware-next'), '1');
    const response = await handler(request(url, method, body)); assert.equal(response.status, 200, `${role} handler ${method} ${url}`);
    assert(!JSON.stringify(await response.json()).includes('synthetic-secret'), 'webhook must stay hidden');
    assert(calls.length > 0);
  }
  for (const [actorRole, targetRole] of [['OWNER', 'OWNER'], ['OWNER', 'ADMIN'], ['ADMIN', 'ADMIN'], ['ADMIN', 'OPERATOR']]) {
    reset(actorRole); target.role = targetRole; if (actorRole === 'ADMIN' && targetRole === 'ADMIN') session.sub = 'target';
    assert.equal((await users.PUT(request('/api/users/target', 'PUT', { role: targetRole, displayName: 'Updated' }), ctx)).status, 200, 'unchanged role is not a grant');
    assert.equal(target.role, targetRole);
  }
  for (const role of ['OWNER', 'ADMIN']) {
    reset(role);
    assert.equal((await users.PUT(request('/api/users/target', 'PUT', { role: 'OWNER' }), ctx)).status, 400, 'no Owner grant');
    assert(!calls.some(([kind]) => kind === 'user-write'));
  }
  reset('ADMIN'); target.role = 'OWNER';
  assert.equal((await users.PUT(request('/api/users/target', 'PUT', { displayName: 'Denied' }), ctx)).status, 403);
  reset(); target.role = 'OWNER';
  for (const body of [{ role: 'ADMIN' }, { isActive: false }]) {
    assert.equal((await users.PUT(request('/api/users/target', 'PUT', body), ctx)).status, 400);
    assert(!calls.some(([kind]) => kind === 'user-write'));
  }
  assert.equal((await users.DELETE(request('/api/users/target', 'DELETE'), ctx)).status, 400);
  for (const method of ['PUT', 'DELETE']) {
    reset(); auditFailure = true;
    const before = structuredClone(target);
    assert.equal((await users[method](request('/api/users/target', method, method === 'PUT' ? { role: 'VIEWER', serverIds: ['local'] } : undefined), ctx)).status, 500);
    assert.deepEqual(target, before, `${method}: audit failure rolls mutation back`);
    assert.deepEqual(audits, []);
  }
  const acquireLock = prisma.$executeRaw;
  try {
    reset(); target.role = 'OWNER'; otherOwners = 1;
    prisma.$executeRaw = async () => { throw Object.assign(Error('synthetic SQLite busy'), { code: 'P2034' }); };
    assert.equal((await users.PUT(request('/api/users/target', 'PUT', { role: 'ADMIN' }), ctx)).status, 500);
    assert(!calls.some(([kind]) => kind === 'user-read' || kind === 'user-write'), 'lock conflict fails before reads/writes');
    prisma.$executeRaw = acquireLock; otherOwners = 0;
    assert.equal((await users.PUT(request('/api/users/target', 'PUT', { role: 'ADMIN' }), ctx)).status, 400, 'retry reads fresh last-Owner count');
    assert.equal(target.role, 'OWNER'); assert.deepEqual(audits, []);
  } finally { prisma.$executeRaw = acquireLock; }
  reset();
  const body = { role: 'VIEWER', isActive: false, serverAccessMode: 'SELECTED', serverIds: ['local', 'server-a', 'server-a'], password: 'synthetic-password' };
  assert.equal((await users.PUT(request('/api/users/target', 'PUT', body), ctx)).status, 200);
  const accessAudit = audits.find(a => a.target === 'target' && a.details?.includes('grantedServerIds'));
  assert(accessAudit, 'grant/revoke changes must have actor and target audit');
  assert.equal(accessAudit.userId, 'actor'); assert.equal(accessAudit.username, 'synthetic-actor'); assert.equal(accessAudit.ip, '192.0.2.1');
  const diff = JSON.parse(accessAudit.details);
  assert.deepEqual(diff.grantedServerIds, ['local', 'server-a']); assert.deepEqual(diff.revokedServerIds, ['server-b']);
  assert.equal(diff.before.role, 'MANAGER'); assert.equal(diff.after.role, 'VIEWER'); assert.equal(diff.after.isActive, false);
  assert(!JSON.stringify(audits).includes('synthetic-password')); assert(!JSON.stringify(audits).includes('synthetic-hash'));
  for (const [before, after] of [['SELECTED', 'ALL'], ['ALL', 'SELECTED']]) {
    reset(); target.serverAccessMode = before;
    await users.PUT(request('/api/users/target', 'PUT', { serverAccessMode: after, serverIds: ['local'] }), ctx);
    const event = audits.find(a => a.target === 'target' && a.details?.includes('grantedServerIds'));
    assert(event); const change = JSON.parse(event.details);
    assert.equal(change.before.serverAccessMode, before); assert.equal(change.after.serverAccessMode, after);
  }
  for (const role of [null, 'VIEWER']) {
    reset(role); const status = role ? 403 : 401;
    assert.equal((await middleware(request('/api/notifications/check'))).status, status);
    assert.equal((await checks.POST()).status, status); assert.deepEqual(calls, []);
    await assert.rejects(() => service.runNotificationChecks(session)); assert.deepEqual(calls, [], 'direct service cannot bypass actor role');
  }
  for (const role of ['MANAGER', 'OPERATOR']) for (const scope of [[], ['server-a'], ['local'], ['local', 'server-a']]) for (const offline of [false, true]) {
    reset(role); allowed = scope; remoteOffline = offline;
    assert.equal((await middleware(request('/api/notifications/check'))).headers.get('x-middleware-next'), '1');
    const data = (await (await checks.POST()).json()).data;
    assert.deepEqual(data.results.map(r => r.serverId).sort(), [...scope].sort());
    assert.deepEqual(calls.filter(([kind]) => kind === 'ssh').map(([, id]) => id), scope.includes('server-a') ? ['server-a'] : []);
    assert.equal(calls.filter(([kind]) => kind === 'local-exec').length, scope.includes('local') ? 1 : 0, 'authorized Local uses canonical inventory executor');
    assert.equal(calls.filter(([kind]) => kind === 'remote-exec').length, scope.includes('server-a') && !offline ? 1 : 0, 'authorized online Remote uses canonical inventory executor');
    assert(calls.filter(([kind]) => kind === 'deployment-read').every(([, q]) => q.where.serverId === null ? scope.includes('local') : scope.includes(q.where.serverId)), 'retention reads remain scoped');
    assert(!calls.some(([kind]) => kind === 'evaluate' || kind === 'delivery'), 'Manager checks must never run global rules or cooldown/delivery mutations');
    assert(!calls.some(([kind]) => kind.startsWith('local-')) || scope.includes('local'));
    assert.deepEqual(calls.find(([kind]) => kind === 'server-read')[1].where, { id: { in: scope.filter(id => id !== 'local') } });
    assert(!calls.some(([kind, q]) => kind === 'app-read' && !scope.includes(q.where.serverId)));
  }
  reset('MANAGER'); mode = 'ALL';
  assert.equal((await (await checks.POST()).json()).data.checked, 3);
  assert(!calls.some(([kind]) => kind === 'evaluate'), 'ALL Manager is still not channel admin');
  for (const role of ['ADMIN', 'OWNER']) {
    reset(role); assert.equal((await (await checks.POST()).json()).data.checked, 3);
    assert.equal(calls.filter(([kind]) => kind === 'evaluate').length, 3, 'Admin/Owner retain global checks and rule delivery');
  }
  reset(); await service.runNotificationChecks();
  assert.equal(calls.filter(([kind]) => kind === 'evaluate').length, 3, 'actorless scheduler remains global');
  await sqliteOwnerConcurrency(users);
  console.log('SAFE-04: real middleware/handlers, channel CRUD/test positives, unchanged roles/hierarchy/last Owner, secret-free grant/revoke audit, scoped Local/Remote/offline/ALL Manager checks and global scheduler passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
