// Run: node scripts/check-app-access.cjs (no database or executor connections).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
process.env.ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
let session = { sub: 'selected-user', role: 'MANAGER' };
let allowed = new Set(['server-a']);
let calls = [];
let profiles = [];
let localExecutor = null;
const app = { id: 'app-a', serverId: 'server-a', containerId: 'abc123', server: { name: 'A' } };
const prisma = {
  app: {
    findUnique: async ({ where }) => { calls.push(['app', where]); return where.id === 'missing' ? null : { ...app, serverId: where.id === 'app-b' ? 'server-b' : app.serverId }; },
    findMany: async (query) => { calls.push(['apps', query]); return []; },
    update: async (query) => { calls.push(['app-update', query]); return app; },
  },
  server: { findMany: async (query) => { calls.push(['servers', query]); return []; } },
  appMetric: { findMany: async () => { calls.push(['metrics']); return []; } },
  envProfile: {
    findMany: async () => profiles,
    findUnique: async ({ where }) => profiles.find((p) => p.id === where.id || (where.appId_name && p.appId === where.appId_name.appId && p.name === where.appId_name.name)) || null,
    update: async ({ where, data }) => { calls.push(['update', where, data]); const p = profiles.find((p) => p.id === where.id && (!where.appId || p.appId === where.appId)); assert(p); Object.assign(p, data); return p; },
    create: async ({ data }) => { calls.push(['create', data]); const p = { id: 'new', createdAt: new Date(), ...data }; profiles.push(p); return p; },
    delete: async () => { calls.push(['delete']); throw Error('Unexpected delete'); },
  },
};
const blocked = () => { calls.push(['EXECUTOR']); throw Error('Executor must not run'); };
const mocks = {
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/db': { prisma },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/server-access': {
    canAccessServer: async (_user, _role, id) => allowed.has(id),
    scopedServerWhere: async () => ({ id: { in: [...allowed].filter((id) => id !== 'local') } }),
  },
  '@/lib/local-server': { isLocalAppId: (id) => id.startsWith('local::'), parseLocalContainerId: (id) => id.slice(7), isLocalServer: (id) => id === 'local', execLocal: (...args) => localExecutor ? localExecutor(...args) : blocked(), tryExecOnHost: blocked, getLocalContainerDetail: blocked },
  '@/lib/ssh': new Proxy({ closeSSH: async () => {} }, { get: (target, key) => target[key] || blocked }),
  '@/lib/server-ssh': { connectToServer: blocked, isDisconnectedError: () => false },
  '@/lib/sse-stream': { createSSEResponse: blocked },
  '@/lib/validation': { validateTerminalCommand: () => ({ valid: true }), validateContainerId: () => ({ valid: true }) },
  'ssh2-promise': {},
};
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const req = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return load(path.join(root, 'src', id.slice(2) + '.ts'));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(req, mod, mod.exports);
  return mod.exports;
}
function routes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? routes(path.join(dir, entry.name)) : entry.name === 'route.ts' ? [path.join(dir, entry.name)] : []);
}
const ctx = (id, profileId = 'profile-b') => ({ params: Promise.resolve({ id, profileId }) });
function request(method, body = {}, query = '', acknowledged = true) {
  const req = new Request('http://check.invalid/api/apps' + query, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(acknowledged ? { ...body, safeModeOff: true } : body), headers: { 'Content-Type': 'application/json', ...(method === 'DELETE' && acknowledged ? { 'X-Safe-Mode-Off': 'true' } : {}) } }) });
  req.nextUrl = new URL(req.url);
  return req;
}
async function main() {
  // This entrypoint leaked foreign metrics before the patch: expected 403, got 200.
  const metrics = load(path.join(root, 'src/app/api/apps/[id]/metrics/route.ts'));
  let res = await metrics.GET(request('GET'), ctx('app-b'));
  assert.equal(res.status, 403, 'cross-server metrics must be denied before reading metrics');
  assert(!calls.some(([type]) => type === 'metrics'));
  let checked = 0;
  for (const file of routes(path.join(root, 'src/app/api/apps'))) {
    const route = load(file);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (!route[method]) continue;
      session = null; calls = [];
      res = await route[method](request(method), ctx('app-b'));
      assert.equal(res.status, 401, `${file} ${method} anonymous`);
      assert.equal(calls.length, 0, `${file} ${method} queried without auth`);
      if (file.includes('[id]')) {
        session = { sub: 'selected-user', role: 'MANAGER' }; calls = [];
        for (const id of ['app-b', 'local::abc123', 'local-service::demo.service', 'discovered::server-b::abc123', 'service::server-b::demo.service']) {
          res = await route[method](request(method), ctx(id));
          assert.equal(res.status, 403, `${file} ${method} ${id}`);
          assert(!calls.some(([type]) => type !== 'app'), 'foreign target reached sensitive read/write/executor');
        }
        if (method !== 'GET' || file.includes('/env/')) {
          session = { sub: 'viewer', role: 'VIEWER' }; calls = [];
          res = await route[method](request(method), ctx('app-a'));
          assert.equal(res.status, 403, `${file} ${method} viewer`);
          assert.equal(calls.length, 0);
        }
      }
      checked++;
    }
  }
  session = { sub: 'selected-user', role: 'MANAGER' }; calls = [];
  const mutations = [
    ['route.ts', 'POST', { name: 'Test', serverId: 'server-a' }],
    ['[id]/route.ts', 'PATCH', { name: 'Renamed' }], ['[id]/route.ts', 'DELETE', {}],
    ['[id]/actions/route.ts', 'POST', { action: 'restart' }],
    ['[id]/terminal/route.ts', 'POST', { command: 'pwd' }],
    ['[id]/env/route.ts', 'PUT', { vars: { PORT: '3000' } }],
    ['[id]/env/apply/route.ts', 'POST', { profileId: null }],
    ['[id]/env/profiles/route.ts', 'POST', { name: 'Test', vars: {} }],
    ['[id]/env/profiles/[profileId]/route.ts', 'PUT', { name: 'Test' }],
    ['[id]/env/profiles/[profileId]/route.ts', 'DELETE', {}],
  ];
  const exportedMutations = routes(path.join(root, 'src/app/api/apps')).flatMap(file => Object.keys(load(file)).filter(method => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)).map(method => [path.relative(path.join(root, 'src/app/api/apps'), file), method].join(':'))).sort();
  assert.deepEqual(mutations.map(([file, method]) => `${file}:${method}`).sort(), exportedMutations, 'every app mutation must be exercised');
  assert.equal(new Set(mutations.map(([file]) => file)).size, 8);
  const safety = load(path.join(root, 'src/lib/operation-safety.ts'));
  process.env.JWT_SECRET = 'offline-test-key-not-a-live-credential';
  session = { ...session, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, jti: 'offline-login', forceLogoutVersion: 0 };
  const grant = await safety.createAdvancedToken(session);
  assert.ok(await safety.verifyAdvancedToken(grant, session));
  mocks['@/lib/auth'].verifySessionToken = async () => session;
  mocks['./lib/auth'] = mocks['@/lib/auth'];
  mocks['./lib/server-access'] = mocks['@/lib/server-access'];
  mocks['next/server'].NextResponse.next = () => new Response(null);
  const middleware = load(path.join(root, 'src/middleware.ts')).middleware;
  const { NextRequest } = require('next/server');
  for (const [file, method, body] of mutations) {
    const route = load(path.join(root, 'src/app/api/apps', file));
    for (const acknowledgment of [undefined, false, ...(method === 'DELETE' ? ['TRUE'] : ['true']), 1, null]) {
      const req = new NextRequest('http://check.invalid/api/apps/' + file.replace('route.ts', '').replace('[id]', 'app-a').replace('[profileId]', 'profile-b'), {
        method, headers: { host: 'check.invalid', origin: 'http://check.invalid', 'content-type': 'application/json',
          cookie: `vps-session=offline-login; ${safety.ADVANCED_COOKIE}=${grant}`, 'x-real-ip': file + method,
          ...(method === 'DELETE' && acknowledgment !== undefined ? { 'X-Safe-Mode-Off': String(acknowledgment) } : {}) },
        body: JSON.stringify({ ...body, ...(acknowledgment !== undefined ? { safeModeOff: acknowledgment } : {}) }),
      });
      assert.equal((await middleware(req)).status, 200, `${file} ${method}: valid signed grant reaches route`);
      calls = [];
      res = await route[method](req, ctx('app-a'));
      assert.equal(res.status, 423, `${file} ${method}: strict explicit acknowledgment (${acknowledgment})`);
      assert(calls.every(([type]) => type === 'app'), `${file} ${method}: denial before DB mutations/executors`);
      assert(calls.length <= (file.includes('[id]') ? 1 : 0), 'only ownership metadata may be read before acknowledgment');
    }
    for (const actor of [null, { sub: 'viewer', role: 'VIEWER' }]) {
      const previous = session; session = actor; calls = [];
      res = await route[method](request(method, body, '', false), ctx('app-a'));
      assert.equal(res.status, actor ? 403 : 401, 'auth/role denial precedes omitted acknowledgment');
      assert.equal(calls.length, 0); session = previous;
    }
    calls = [];
    res = await route[method](request(method, { ...body, serverId: 'server-b' }, '', false), ctx('app-b'));
    assert.equal(res.status, 403, 'scope denial precedes omitted acknowledgment');
    assert(calls.every(([type]) => type === 'app'));
  }
  app.createdAt = app.updatedAt = new Date();
  prisma.server.findUnique = async () => ({ id: 'server-a' });
  prisma.app.create = async ({ data }) => { calls.push(['app-create']); return { ...app, ...data }; };
  prisma.app.delete = async () => { calls.push(['app-delete']); };
  const detail = load(path.join(root, 'src/app/api/apps/[id]/route.ts'));
  for (const [file, method, body, effect] of [
    ['route.ts', 'POST', { name: 'Test', serverId: 'server-a' }, 'app-create'],
    ['[id]/route.ts', 'PATCH', { name: 'Renamed' }, 'app-update'],
    ['[id]/route.ts', 'DELETE', {}, 'app-delete'],
  ]) {
    calls = []; res = await load(path.join(root, 'src/app/api/apps', file))[method](request(method, body), ctx('app-a'));
    assert.equal(res.status, method === 'POST' ? 201 : 200, `${file}: acknowledged flow`);
    assert(calls.some(([type]) => type === effect));
  }
  // DELETE must use the agreed header, not a JSON flag or query-string substitute.
  calls = [];
  res = await detail.DELETE(request('DELETE', { safeModeOff: true }, '?safeModeOff=true', false), ctx('app-a'));
  assert.equal(res.status, 423); assert(!calls.some(([type]) => type === 'app-delete'));
  allowed.add('local');
  localExecutor = command => { calls.push(['mock-exec', command]); return 'mock-output'; };
  for (const [file, body, command] of [
    ['[id]/actions/route.ts', { action: 'restart' }, 'docker restart abc123 2>&1'],
    ['[id]/terminal/route.ts', { command: 'pwd' }, 'docker exec abc123 pwd 2>&1'],
  ]) {
    calls = []; res = await load(path.join(root, 'src/app/api/apps', file)).POST(request('POST', body), ctx('local::abc123'));
    assert.equal(res.status, 200); assert(calls.some(([type, value]) => type === 'mock-exec' && value === command));
  }
  localExecutor = null; allowed.delete('local');
  const list = load(path.join(root, 'src/app/api/apps/route.ts'));
  res = await list.GET(request('GET', {}, '?liveRemote=true'));
  assert.equal(res.status, 200);
  assert.deepEqual(calls.find(([type]) => type === 'apps')[1].where, { serverId: { in: ['server-a'] } });
  assert.deepEqual(calls.find(([type]) => type === 'servers')[1].where, { isActive: true, id: { in: ['server-a'] } });
  calls = [];
  res = await list.POST(request('POST', { name: 'Foreign', serverId: 'server-b' }));
  assert.equal(res.status, 403); assert.equal(calls.length, 0);
  session = { sub: 'viewer', role: 'VIEWER' }; calls = [];
  res = await metrics.GET(request('GET'), ctx('app-a'));
  assert.equal(res.status, 200, 'scoped viewer retains ordinary read access');
  session = { sub: 'selected-user', role: 'MANAGER' }; calls = [];
  allowed.clear();
  res = await list.GET(request('GET', {}, '?liveRemote=true'));
  assert.equal(res.status, 200);
  assert.deepEqual(calls.find(([type]) => type === 'apps')[1].where, { serverId: { in: [] } });
  assert.deepEqual(calls.find(([type]) => type === 'servers')[1].where, { isActive: true, id: { in: [] } });
  allowed.add('server-a');
  calls = [];
  const stream = load(path.join(root, 'src/app/api/apps/[id]/stream/route.ts'));
  res = await stream.GET(request('GET'), ctx('app-a'));
  assert.equal(res.status, 400, 'remote app must never dispatch local Docker stats');
  assert(!calls.some(([type]) => type === 'EXECUTOR'));
  const access = load(path.join(root, 'src/lib/app-access.ts'));
  for (const id of ['local::', 'local::abc;id', 'local::abc::extra', 'discovered::server-a::abc::extra', 'service::::demo.service']) {
    res = await access.authorizeApp(id);
    assert.equal(res.status, 400, id);
  }
  assert.equal(await access.authorizeApp('discovered::server-a::abc123'), null);
  const vars = load(path.join(root, 'src/lib/env-profile.ts'));
  const original = { PASSWORD: 'test-secret', PORT: '3000' };
  const encrypted = vars.encodeProfileVars(original);
  assert(!encrypted.includes('test-secret'));
  assert.deepEqual(vars.decodeProfileVars(encrypted), original);
  assert.deepEqual(vars.decodeProfileVars(JSON.stringify(original)), original);
  const masked = vars.redactEnvVars(original);
  assert.deepEqual(masked, { PASSWORD: '[REDACTED]', PORT: '[REDACTED]' });
  assert.deepEqual(vars.mergeEnvVars({ ...masked, PORT: '4000' }, original), { PASSWORD: 'test-secret', PORT: '4000' });
  assert.throws(() => vars.mergeEnvVars({ NEW: '[REDACTED]' }, original));
  assert.throws(() => vars.mergeEnvVars({ 'BAD;KEY': 'x' }));
  assert.throws(() => vars.mergeEnvVars({ PORT: 3000 }));
  assert.throws(() => vars.decodeProfileVars(encrypted.slice(0, -4) + 'AAAA'));
  const profileRoute = load(path.join(root, 'src/app/api/apps/[id]/env/profiles/[profileId]/route.ts'));
  const apply = load(path.join(root, 'src/app/api/apps/[id]/env/apply/route.ts'));
  profiles = [{ id: 'profile-b', appId: 'app-b', vars: JSON.stringify(original), createdAt: new Date() }];
  for (const [route, method] of [[profileRoute, 'PUT'], [profileRoute, 'DELETE'], [apply, 'POST']]) {
    calls = []; res = await route[method](request(method, { vars: masked, profileId: 'profile-b' }), ctx('app-a'));
    assert.equal(res.status, 404, 'profile must belong to path app');
    assert(!calls.some(([type]) => ['update', 'delete', 'EXECUTOR'].includes(type)));
  }
  profiles = [{ id: 'profile-a', appId: 'app-a', name: 'Test', vars: JSON.stringify(original), isActive: false, createdAt: new Date() }];
  calls = []; res = await profileRoute.PUT(request('PUT', { vars: { ...masked, PORT: '4000' } }), ctx('app-a', 'profile-a'));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data.vars, masked);
  assert.deepEqual(vars.decodeProfileVars(profiles[0].vars), { PASSWORD: 'test-secret', PORT: '4000' });
  profiles[0].vars = JSON.stringify(original);
  res = await profileRoute.PUT(request('PUT', { name: 'Renamed' }), ctx('app-a', 'profile-a'));
  assert.equal(res.status, 200);
  assert(profiles[0].vars.startsWith('enc:v1:'), 'all explicit profile saves encrypt even name-only edits');
  const stored = profiles[0].vars;
  const profileList = load(path.join(root, 'src/app/api/apps/[id]/env/profiles/route.ts'));
  calls = []; res = await profileList.GET(request('GET'), ctx('app-a'));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data[0].vars, masked);
  assert.equal(profiles[0].vars, stored, 'read must not migrate storage');
  profiles[0].vars = JSON.stringify(original);
  calls = []; res = await profileList.GET(request('GET'), ctx('app-a'));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data[0].vars, masked);
  assert.equal(profiles[0].vars, JSON.stringify(original), 'legacy read must not migrate storage');
  res = await profileList.POST(request('POST', { name: 'New', vars: original }), ctx('app-a'));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data.vars, masked);
  assert.deepEqual(vars.decodeProfileVars(profiles[1].vars), original);
  // Viewer health reads must only inspect Docker, never execute stored checks or update DB.
  const health = load(path.join(root, 'src/app/api/apps/[id]/health/route.ts'));
  session = { sub: 'viewer', role: 'VIEWER' };
  allowed.add('local');
  app.serverId = 'local';
  app.healthCheck = 'rm -rf /app/data';
  let dockerHealth = 'none';
  let containerState = 'running';
  const inspectOnly = (command) => {
    calls.push(['mock-exec', command]);
    if (command.startsWith('docker inspect ') && command.includes('.State.Status')) return containerState;
    if (command.startsWith('docker inspect ') && command.includes('.State.Health')) return dockerHealth;
    throw Error('Health GET must only inspect Docker');
  };
  localExecutor = inspectOnly;
  mocks['@/lib/ssh'].createSSHConnection = async () => { calls.push(['ssh-connect']); return {}; };
  mocks['@/lib/ssh'].executeCommand = async (_ssh, command) => inspectOnly(command);
  for (const id of ['app-a', 'app-remote', 'local::abc123']) {
    app.serverId = id === 'app-remote' ? 'server-a' : 'local';
    for (const [state, nativeHealth, expected] of [
      ['running', 'none', 'unknown'], ['running', 'starting', 'unknown'],
      ['running', 'healthy', 'healthy'], ['running', 'unhealthy', 'unhealthy'],
      ['exited', 'none', 'unhealthy'],
    ]) {
      containerState = state; dockerHealth = nativeHealth; calls = [];
      res = await health.GET(request('GET'), ctx(id));
      assert.equal(res.status, 200, `${id}: health read succeeds`);
      assert(!calls.some(([type, command]) => type === 'mock-exec' && !command.startsWith('docker inspect ')), `${id}: no custom docker exec`);
      assert(!calls.some(([type]) => type === 'app-update'), `${id}: no DB writes`);
      assert.equal((await res.json()).data.status, expected, `${id}: ${state}/${nativeHealth}`);
    }
  }
  const getSession = mocks['@/lib/auth'].getSession;
  mocks['@/lib/auth'].getSession = async () => { throw Error('MOCK_SECRET_MARKER'); };
  calls = [];
  res = await health.GET(request('GET'), ctx('app-a'));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { success: false, error: 'Health check failed' });
  assert.equal(calls.length, 0);
  mocks['@/lib/auth'].getSession = getSession;
  delete mocks['@/lib/ssh'].createSSHConnection;
  delete mocks['@/lib/ssh'].executeCommand;
  app.serverId = 'server-a'; delete app.healthCheck;
  session = { sub: 'selected-user', role: 'MANAGER' };
  // Runtime/file endpoint: mask all output and recover unchanged values before writing.
  const env = load(path.join(root, 'src/app/api/apps/[id]/env/route.ts'));
  let savedContent;
  let failurePhase;
  let failureOutput;
  let fileContent = 'PASSWORD=test-secret\nPORT=3000\n';
  localExecutor = (command) => {
    calls.push(['mock-exec', command]);
    const phase = command.includes('cat ') ? 'read' : command.includes(' cp ') ? 'backup' : command.includes(' > ') ? 'write' : null;
    if (phase && phase === failurePhase) {
      const output = Array.isArray(failureOutput) ? failureOutput.shift() : failureOutput;
      if (output instanceof Error) throw output;
      return output;
    }
    if (command.includes('cat ')) {
      if (fileContent instanceof Error) throw fileContent;
      if (command.includes('__ENV_READ_OK__')) {
        assert(command.includes('cat /app/.env && printf "\\n__ENV_READ_OK__"'), 'read marker must follow successful cat');
        return fileContent === null ? '__ENV_ABSENT__' : '__ENV_PRESENT__' + fileContent + '\n__ENV_READ_OK__';
      }
      if (fileContent === null) throw Error('No such file');
      return fileContent;
    }
    if (command.endsWith(' env 2>/dev/null')) return 'PASSWORD=test-secret\nPORT=3000\n';
    if (command.includes('WorkingDir')) return '/app';
    if (command.includes('base64 -d')) { savedContent = Buffer.from(command.match(/echo "([^"]+)"/)[1], 'base64').toString(); return command.includes('&& printf __ENV_WRITE_OK__') ? '__ENV_WRITE_OK__' : ''; }
    if (command.includes(' cp ')) return command.includes('&& printf __ENV_BACKUP_OK__') ? '__ENV_BACKUP_OK__' : '';
    if (command.startsWith('docker restart ')) return 'abc123';
    throw Error('Unexpected mocked command');
  };
  res = await env.GET(request('GET'), ctx('local::abc123'));
  assert.equal(res.status, 200);
  const envData = (await res.json()).data;
  assert.deepEqual(envData.vars, masked); assert.deepEqual(envData.runtimeVars, masked);
  res = await env.PUT(request('PUT', { vars: { ...masked, PORT: '4000' }, envPath: '/app/.env', restart: false }), ctx('local::abc123'));
  assert.equal(res.status, 200);
  assert.equal(savedContent, 'PASSWORD=test-secret\nPORT=4000\n');
  res = await env.PUT(request('PUT', { vars: { NEW: '[REDACTED]' }, restart: false }), ctx('local::abc123'));
  assert.equal(res.status, 400);
  // Neither masked roundtrips nor full replacements may rewrite unsupported originals.
  const unsupportedOriginals = [
    'PASSWORD="first\nsecond"\nPORT=3000\n',
    'PASSWORD="escaped\\"quote"\nPORT=3000\n',
    'PASSWORD=path\\to\\secret\nPORT=3000\n',
    'PASSWORD=first\nPASSWORD=second\nPORT=3000\n',
    'export PASSWORD=test-secret\nPORT=3000\n',
    'PASSWORD=test-secret # comment\nPORT=3000\n',
    'PASSWORD=$OTHER_SECRET\nPORT=3000\n',
  ];
  for (const fixture of unsupportedOriginals) {
    fileContent = fixture;
    res = await env.GET(request('GET'), ctx('local::abc123'));
    assert.equal(res.status, 200);
    const data = (await res.json()).data;
    assert(Object.values(data.vars).every((value) => value === '[REDACTED]'));
    savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: data.vars, envPath: data.envPath }), ctx('local::abc123'));
    assert.equal(res.status, 400, 'unsupported original must fail closed');
    assert.equal((await res.json()).error, 'Unsupported .env format; edit the file directly before saving here');
    assert.equal(savedContent, undefined);
    assert(calls.filter(([type]) => type === 'mock-exec').every(([, command]) => command.includes(' cat ')), 'refusal must precede backup/write/restart');
  }
  mocks['@/lib/ssh'].createSSHConnection = async () => { calls.push(['ssh-connect']); return {}; };
  mocks['@/lib/ssh'].executeCommand = async (_ssh, command) => localExecutor(command).toString().trim();
  mocks['@/lib/ssh'].closeSSH = async () => { calls.push(['ssh-close']); };
  for (const id of ['local::abc123', 'app-a', 'app-remote']) {
    app.serverId = id === 'app-remote' ? 'server-a' : 'local';
    for (const fixture of unsupportedOriginals) {
      fileContent = fixture; savedContent = undefined; calls = [];
      res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' } }), ctx(id));
      assert.equal(res.status, 400, `${id}: full replacement must validate unsupported original`);
      assert.equal((await res.json()).error, 'Unsupported .env format; edit the file directly before saving here');
      assert.equal(savedContent, undefined);
      assert(calls.filter(([type]) => type === 'mock-exec').every(([, command]) => command.includes(' cat ')), `${id}: refusal precedes backup/write/restart`);
      if (id === 'app-remote') assert(calls.some(([type]) => type === 'ssh-close'));
    }
    fileContent = 'PASSWORD=old\n'; savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' }, restart: false }), ctx(id));
    assert.equal(res.status, 200, `${id}: supported original permits full replacement`);
    assert.equal(savedContent, 'PASSWORD=replacement\n');
    assert.equal((await res.json()).data.backed_up, true);
    fileContent = ''; savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' } }), ctx(id));
    assert.equal(res.status, 200, `${id}: empty existing file can be backed up and saved`);
    assert.equal((await res.json()).data.restarted, true);
    assert(calls.some(([type, command]) => type === 'mock-exec' && command.includes(' cp ')));
    fileContent = ' \t\n\n'; savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' }, restart: false }), ctx(id));
    assert.equal(res.status, 200, `${id}: whitespace-only original survives executor normalization`);
    assert.equal(savedContent, 'PASSWORD=replacement\n');
    for (const [phase, outputs] of [
      ['backup', ['', '__ENV_BACKUP_OK', Error('MOCK_SECRET_MARKER')]],
      ['read', ['', '0', '1', '1PASSWORD=partial\n', 'PASSWORD=partial\n', '0\n', '__ENV_READ_OK__', '__ENV_PRESENT__', '__ENV_PRESENT__PASSWORD=partial\n', '__ENV_PRESENT__PASSWORD=partial\n__ENV_READ_OK', Error('MOCK_SECRET_MARKER')]],
      ['write', ['', '__ENV_WRITE_OK', Error('MOCK_SECRET_MARKER'), [Error('base64 unavailable'), '']]],
    ]) {
      for (const output of outputs) {
        fileContent = 'PASSWORD=old\n'; failurePhase = phase; failureOutput = output;
        savedContent = undefined; calls = [];
        res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' } }), ctx(id));
        assert.equal(res.status, 500, `${id}: ${phase} failure must fail closed (${String(output)})`);
        assert.deepEqual(await res.json(), { success: false, error: 'Failed to save env' });
        assert.equal(savedContent, undefined);
        const commands = calls.filter(([type]) => type === 'mock-exec').map(([, command]) => command);
        assert(!commands.some((command) => command.startsWith('docker restart ')), `${id}: no restart after ${phase} failure`);
        if (phase === 'read') assert(!commands.some((command) => command.includes(' cp ') || command.includes(' > ')));
        if (phase === 'backup') assert(!commands.some((command) => command.includes(' > ')));
        if (phase === 'write' && !(output instanceof Error) && !Array.isArray(output)) assert.equal(commands.filter((command) => command.includes(' > ')).length, 1, 'unconfirmed write must not trigger another write');
        if (id === 'app-remote') assert(calls.some(([type]) => type === 'ssh-close'));
      }
    }
    failurePhase = 'write'; failureOutput = [Error('base64 unavailable'), '__ENV_WRITE_OK__']; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' } }), ctx(id));
    assert.equal(res.status, 200, `${id}: confirmed fallback write still succeeds`);
    assert.deepEqual((await res.json()).data, { backed_up: true, saved: true, restarted: true, envPath: '/app/.env' });
    assert(calls.some(([type, command]) => type === 'mock-exec' && command.includes('printf ') && command.includes(' > ') && command.includes('&& printf __ENV_WRITE_OK__')));
    failurePhase = undefined;
    fileContent = Error('MOCK_SECRET_MARKER'); savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' } }), ctx(id));
    assert.equal(res.status, 500, `${id}: read failure is not an absent file`);
    assert.deepEqual(await res.json(), { success: false, error: 'Failed to save env' });
    assert.equal(savedContent, undefined);
    assert(calls.filter(([type]) => type === 'mock-exec').every(([, command]) => command.includes(' cat ')));
    fileContent = null; savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: 'replacement' }, restart: false }), ctx(id));
    assert.equal(res.status, 200, `${id}: absent file can be created`);
    assert.deepEqual((await res.json()).data, { backed_up: false, saved: true, restarted: false, envPath: '/app/.env' });
    assert.equal(savedContent, 'PASSWORD=replacement\n');
    assert(!calls.some(([type, command]) => type === 'mock-exec' && command.includes(' cp ')));
    savedContent = undefined; calls = [];
    res = await env.PUT(request('PUT', { vars: masked }), ctx(id));
    assert.equal(res.status, 400, `${id}: missing originals cannot recover masks`);
    assert.equal(savedContent, undefined);
    assert(calls.filter(([type]) => type === 'mock-exec').every(([, command]) => command.includes(' cat ')));
  }
  delete mocks['@/lib/ssh'].createSSHConnection;
  delete mocks['@/lib/ssh'].executeCommand;
  mocks['@/lib/ssh'].closeSSH = async () => {};
  app.serverId = 'server-a';
  fileContent = '# simple supported values\nPASSWORD="test secret"\nPORT=3000\nEMPTY=\nLABEL=\'simple label\'\n';
  res = await env.GET(request('GET'), ctx('local::abc123'));
  const simpleData = (await res.json()).data;
  res = await env.PUT(request('PUT', { vars: simpleData.vars, envPath: simpleData.envPath, restart: false }), ctx('local::abc123'));
  assert.equal(res.status, 200);
  assert.equal(savedContent, 'PASSWORD="test secret"\nPORT=3000\nEMPTY=""\nLABEL="simple label"\n');
  for (const value of ['first\nsecond', 'escaped"quote', 'path\\to\\secret']) {
    calls = [];
    res = await env.PUT(request('PUT', { vars: { PASSWORD: value } }), ctx('local::abc123'));
    assert.equal(res.status, 400, 'unsupported new values must also be rejected before backup');
    assert(!calls.some(([type]) => type === 'mock-exec'));
  }
  localExecutor = null;
  // Successful apply receives server-side decrypted values, not returned masks.
  allowed.delete('local');
  profiles[0].vars = vars.encodeProfileVars(original);
  prisma.envProfile.updateMany = async () => { calls.push(['update-many']); };
  prisma.$transaction = async (operations) => Promise.all(operations);
  let appliedVars;
  profileRoute.recreateContainer = async (_id, input) => { appliedVars = input; return { newContainerId: 'new-container' }; };
  res = await apply.POST(request('POST', { profileId: 'profile-a' }), ctx('app-a'));
  assert.equal(res.status, 200); assert.deepEqual(appliedVars, original);
  appliedVars = undefined; calls = [];
  res = await apply.POST(request('POST', { profileId: null }), ctx('app-a'));
  assert.equal(res.status, 200); assert.deepEqual(appliedVars, {});
  assert(calls.some(([type]) => type === 'update-many'));
  prisma.envProfile.delete = async () => { calls.push(['delete']); };
  allowed.add('local'); app.serverId = 'local';
  localExecutor = command => {
    calls.push(['mock-exec', command]);
    return command.startsWith('docker inspect ') ? JSON.stringify([{ Config: { Image: 'test-image' } }]) : 'new-container';
  };
  for (const active of [false, true]) {
    profiles[0].isActive = active; appliedVars = undefined; calls = [];
    res = await profileRoute.DELETE(request('DELETE'), ctx('app-a', 'profile-a'));
    assert.equal(res.status, 200); assert(calls.some(([type]) => type === 'delete'));
    assert.equal((await res.json()).data.reverted, active);
    assert(calls.some(([type, command]) => type === 'mock-exec' && command.startsWith('docker run ')) === active, 'active DELETE recreates only when acknowledged');
  }
  console.log(`PASS: ${checked} app API entrypoints; all 10 mutations require strict acknowledgment despite a valid signed grant, acknowledged positive flows and auth/scope/role denial, scoped discovery, profile binding, encryption, legacy reads, inspect-only Viewer health, health 500 redaction, and fail-closed masked/full-replacement env saves across local/DB-local/remote, including absent/empty files, confirmed read/backup/write markers, silent/partial failures, and write fallback (mocked only).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
