// Offline SEC-01 regression: node scripts/test-advanced-safety.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { SignJWT } = require('jose');
const { NextRequest } = require('next/server');
const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'offline-test-key-not-a-live-credential';
const key = new TextEncoder().encode(process.env.JWT_SECRET);
let version = 0;
let user = { id: 'manager', username: 'manager', role: 'MANAGER', isActive: true, serverAccessMode: 'ALL' };
let localAccess = false;
const cookieMap = new Map();
const cookieOptions = new Map();
const cookieStore = { get: name => cookieMap.has(name) ? { value: cookieMap.get(name) } : undefined,
  set: (name, value, options) => { cookieMap.set(name, value); cookieOptions.set(name, options); },
  delete: name => cookieMap.delete(name) };
const mocks = {
  'next/headers': { cookies: async () => cookieStore },
  './db': { prisma: { user: { findUnique: async () => user }, userServerAccess: { findUnique: async () => localAccess ? { serverId: 'local' } : null } } },
  './security-settings': { getSecuritySettings: async () => ({ forceLogoutVersion: version }) },
};
mocks['@/lib/db'] = mocks['./db'];
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, mod);
  mod.require = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), name + '.ts'))) return load(path.resolve(path.dirname(file), name + '.ts'));
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return mod.exports;
}
(async () => {
  const safety = load('src/lib/operation-safety.ts');
  const auth = load('src/lib/auth.ts');
  const { middleware } = load('src/middleware.ts');
  const endpoint = load('src/app/api/auth/safety/route.ts');
  const token = await auth.createSessionToken('manager', 'manager', 'MANAGER');
  const session = await auth.verifySessionToken(token);
  const grant = await safety.createAdvancedToken(session);
  assert.equal(await safety.verifyAdvancedToken(undefined, session), null);
  assert.equal(await safety.verifyAdvancedToken('invalid', session), null);
  assert.ok(await safety.verifyAdvancedToken(grant, session));
  for (const changed of [{ sub: 'other' }, { iat: session.iat + 1 }, { forceLogoutVersion: 1 }, { jti: 'different-login' }, { role: 'VIEWER' }]) {
    assert.equal(await safety.verifyAdvancedToken(grant, { ...session, ...changed }), null);
  }
  const expired = await new SignJWT({ sessionIssuedAt: session.iat, forceLogoutVersion: 0, role: session.role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(session.sub).setAudience('vps-advanced').setIssuedAt(session.iat - 1000).setExpirationTime(session.iat - 1).sign(key);
  assert.equal(await safety.verifyAdvancedToken(expired, session), null);
  assert.equal(await auth.verifySessionToken(grant), null, 'advanced grant must not be accepted as a login');
  user = { ...user, isActive: false };
  assert.equal(await auth.verifySessionToken(token), null);
  user = { ...user, isActive: true, role: 'VIEWER' };
  assert.equal((await auth.verifySessionToken(token)).role, 'VIEWER');
  user = { ...user, role: 'MANAGER' };
  version = 1;
  assert.equal(await auth.verifySessionToken(token), null);
  version = 0;
  function request(route, method = 'POST', body, advanced) {
    return new NextRequest(`http://localhost${route}`, { method,
      headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json',
        cookie: `vps-session=${token}${advanced ? `; ${safety.ADVANCED_COOKIE}=${advanced}` : ''}`, 'x-real-ip': route },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const protectedRequests = [
    ['/api/servers/local/terminal', 'POST', { safeModeOff: true }], ['/api/servers/local/terminal/', 'POST', {}], ['/api/servers/local/cron', 'POST', {}],
    ['/api/servers/local/cron', 'DELETE'], ['/api/deploy', 'POST', { serverId: 'remote' }], ['/api/deploy/docker', 'POST', {}],
    ['/api/deploy/rollback', 'POST', {}], ['/api/deploy/requirements/install', 'POST', {}],
    ['/api/apps/app/actions', 'POST', {}], ['/api/apps/app/terminal', 'POST', {}], ['/api/apps/app/env', 'PUT', {}],
    ['/api/apps/app', 'DELETE'], ['/api/backup', 'POST', { action: 'restore' }], ['/api/backup', 'DELETE'],
    ['/api/servers/local/docker/action', 'POST', {}], ['/api/servers/local/services/action', 'POST', {}],
    ['/api/servers/local/dependencies/install', 'POST', {}], ['/api/servers/local/packages', 'POST', {}],
    ['/api/network/packages', 'POST', {}], ['/api/servers/local/network/firewall', 'POST', { mode: 'apply' }],
    ['/api/servers/local/network/firewall', 'POST', { mode: 'bogus' }],
    ['/api/servers/local/actions', 'POST', { action: 'sync-time' }], ['/api/servers/local/actions', 'POST', { action: 'restart-server' }],
  ];
  for (const [route, method, body] of protectedRequests) {
    const res = await middleware(request(route, method, body));
    assert.equal(res.status, route.startsWith('/api/backup') ? 403 : 423, `${method} ${route} missing grant`);
    if (!route.startsWith('/api/backup')) assert.equal((await middleware(request(route, method, body, grant))).status, 200, route);
  }
  const adminToken = await auth.createSessionToken('manager', 'manager', 'ADMIN');
  user = { ...user, role: 'ADMIN' };
  const adminGrant = await safety.createAdvancedToken(await auth.verifySessionToken(adminToken));
  const createBackup = request('/api/backup', 'POST', {});
  createBackup.cookies.set('vps-session', adminToken);
  assert.equal((await middleware(createBackup)).status, 200, 'Admin can create backup in Safe Mode');
  for (const [route, method, body] of protectedRequests.filter(([p]) => p.startsWith('/api/backup'))) {
    const req = request(route, method, body);
    req.cookies.set('vps-session', adminToken);
    assert.equal((await middleware(req)).status, 423, 'backup needs grant as well as Admin role');
    req.cookies.set(safety.ADVANCED_COOKIE, adminGrant);
    assert.equal((await middleware(req)).status, 200, 'authorized backup mutation reaches route safety checks');
  }
  user = { ...user, role: 'MANAGER' };
  for (const args of [['/api/servers/local/cron', 'GET'], ['/api/servers/local/network/firewall', 'POST', { mode: 'dry-run' }],
    ['/api/deploy', 'POST', {}], ['/api/deploy', 'POST', { serverId: 'local' }], ['/api/deploy/preflight', 'POST', {}], ['/api/deploy/requirements', 'POST', {}],
    ['/api/servers/local/actions', 'POST', { action: 'system-health-check' }], ['/api/servers/local/packages', 'GET'],
    ['/api/servers/local/packages?check=1', 'GET'], ['/api/network/packages?check=1', 'GET'],
    ['/api/auth/passcode/unlock', 'POST', {}], ['/api/users/manager/passcode', 'PUT', {}], ['/api/profile', 'PUT', {}],
    ['/api/notifications/check', 'POST', {}]]) {
    assert.equal((await middleware(request(...args))).status, 200, `read-only ${args[0]}`);
  }
  user = { ...user, serverAccessMode: 'SELECTED' };
  for (const route of ['/api/stats', '/api/stats/stream', '/api/network/ports', '/api/network/packages']) {
    assert.equal((await middleware(request(route, 'GET'))).status, 403, `${route} requires local scope`);
    localAccess = true;
    assert.equal((await middleware(request(route, 'GET'))).status, 200, `${route} local grant`);
    localAccess = false;
  }
  user = { ...user, serverAccessMode: 'ALL' };
  for (const args of [['/api/servers', 'POST', {}], ['/api/servers/local', 'PATCH', {}], ['/api/servers/local', 'DELETE']]) {
    assert.equal((await middleware(request(...args))).status, 403, 'connection configuration requires Admin');
  }
  for (const invalid of ['invalid', expired, await safety.createAdvancedToken({ ...session, jti: 'another-login' })]) {
    assert.equal((await middleware(request('/api/servers/local/terminal', 'POST', { safeModeOff: true }, invalid))).status, 423);
  }
  user = { ...user, role: 'VIEWER' };
  assert.equal((await middleware(request('/api/servers/local/terminal', 'POST', {}, grant))).status, 403);
  for (const route of ['/api/profile', '/api/users/manager/passcode', '/api/auth/passcode/unlock']) {
    assert.equal((await middleware(request(route, route.endsWith('unlock') ? 'POST' : 'PUT', {}))).status, 200, 'Viewer self-service remains available');
  }
  user = { ...user, role: 'MANAGER' };
  const noOrigin = request('/api/servers/local/terminal', 'POST', {}, grant);
  noOrigin.headers.delete('origin');
  assert.equal((await middleware(noOrigin)).status, 403);
  for (const file of ['src/app/api/network/packages/route.ts', 'src/app/api/servers/[id]/packages/route.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const get = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function POST'));
    assert.ok(!/(?:apt(?:-get)?|apk) update/.test(get), 'GET package checks must never refresh host indexes');
  }
  cookieMap.set('vps-session', token);
  assert.equal((await (await endpoint.GET()).json()).data.safeMode, true);
  assert.equal((await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: false }))).status, 400);
  assert.equal((await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: false, acknowledged: true }))).status, 200);
  assert.equal(cookieOptions.get(safety.ADVANCED_COOKIE).httpOnly, true);
  assert.equal(cookieOptions.get(safety.ADVANCED_COOKIE).maxAge, 900);
  assert.equal((await (await endpoint.GET()).json()).data.safeMode, false);
  user = { ...user, role: 'VIEWER' };
  assert.equal((await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: false, acknowledged: true }))).status, 403);
  assert.equal((await (await endpoint.GET()).json()).data.safeMode, true);
  user = { ...user, role: 'MANAGER' };
  const crossOrigin = request('/api/auth/safety', 'POST', { safeMode: false, acknowledged: true });
  crossOrigin.headers.set('origin', 'http://evil.example');
  assert.equal((await endpoint.POST(crossOrigin)).status, 403);
  assert.equal((await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: true }))).status, 200);
  assert.equal(cookieMap.has(safety.ADVANCED_COOKIE), false);
  cookieMap.set(safety.ADVANCED_COOKIE, grant);
  await auth.setSessionCookie(token);
  assert.equal(cookieMap.has(safety.ADVANCED_COOKIE), false, 'new login always clears old advanced grant');
  cookieMap.set(safety.ADVANCED_COOKIE, grant);
  await auth.clearSessionCookie();
  assert.equal(cookieMap.has(safety.ADVANCED_COOKIE), false, 'logout clears advanced grant');
  cookieMap.set('vps-session', token);
  assert.equal((await (await endpoint.GET()).json()).data.safeMode, true);
  const ui = fs.readFileSync(path.join(root, 'src/contexts/SafeModeContext.tsx'), 'utf8');
  assert.ok(ui.includes('/api/auth/safety'));
  assert.ok(!ui.includes('getItem(STORAGE_KEY)'), 'old localStorage false must never enable advanced mode');
  for (const event of ['focus', 'visibilitychange', 'storage']) assert.ok(ui.includes(`"${event}"`), `UI sync ${event}`);
  assert.ok(ui.includes('expiresAt') && ui.includes('setTimeout'), 'UI returns to Safe Mode at server expiry');
  assert.ok(ui.includes('window.confirm') && ui.includes('acknowledged: true'), 'explicit acknowledgment');
  const failures = [];
  const regression = async (name, check) => {
    try { await check(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  // Exercise the provider itself with native hook/event/timer stubs, not a UI testing dependency.
  let hook = 0, effects = [], hooks = [], timerId = 0, safetyReads = 0, posts = 0;
  let serverState = { safeMode: true, expiresAt: null }, networkFailure = false, confirmed = false;
  let postFailure = false, idleMinutes = 0, pendingSecurity = null;
  const listeners = new Map(), timers = new Map();
  const original = { fetch: global.fetch, window: global.window, document: global.document, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const on = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const off = (name, fn) => { listeners.get(name)?.delete(fn); if (!listeners.get(name)?.size) listeners.delete(name); };
  const emit = (name, event) => [...(listeners.get(name) || [])].forEach(fn => fn(event));
  global.window = { addEventListener: on, removeEventListener: off, confirm: () => confirmed,
    localStorage: { getItem: () => { throw new Error('old localStorage false is not authority'); }, setItem: () => {} } };
  global.document = { visibilityState: 'visible', addEventListener: on, removeEventListener: off };
  global.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  global.clearTimeout = id => timers.delete(id);
  global.fetch = async (url, options = {}) => {
    if (url === '/api/auth/safety') {
      if (networkFailure) throw new Error('offline');
      if (options.method === 'POST') {
        posts++;
        if (postFailure === 'http') return Response.json({ success: false, error: 'revoke rejected' }, { status: 503 });
        if (postFailure) throw new Error('revoke failed');
        const body = JSON.parse(options.body);
        serverState = body.safeMode ? { safeMode: true, expiresAt: null } : { safeMode: false, expiresAt: Date.now() + 900000 };
      } else safetyReads++;
      return Response.json({ success: true, data: serverState });
    }
    if (url === '/api/settings/security' && pendingSecurity) return new Promise(resolve => { pendingSecurity.resolve = resolve; });
    return Response.json({ success: true, data: { idleTimeoutMinutes: idleMinutes, passcodeEnabled: false } });
  };
  const react = require('react');
  mocks.react = { ...react,
    useState: init => { const i = hook++; if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef: init => { const i = hook++; return hooks[i] ?? (hooks[i] = { current: init }); },
    useMemo: (fn, deps) => { const i = hook++; if (!hooks[i] || deps.some((d, j) => d !== hooks[i].deps[j])) hooks[i] = { deps, value: fn() }; return hooks[i].value; },
    useCallback: (fn, deps) => mocks.react.useMemo(() => fn, deps),
    useEffect: (fn, deps) => { const i = hook++; if (!hooks[i] || deps.some((d, j) => d !== hooks[i].deps[j])) { hooks[i]?.cleanup?.(); hooks[i] = { deps }; effects.push(() => { hooks[i].cleanup = fn(); }); } },
  };
  try {
    const { SafeModeProvider } = load('src/contexts/SafeModeContext.tsx');
    const render = () => { hook = 0; const value = SafeModeProvider({ children: null }).props.value; const pending = effects; effects = []; pending.forEach(fn => fn()); return value; };
    const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    assert.equal(render().safeMode, true, 'UI defaults safe regardless of storage');
    await settle();
    let state = render();
    assert.equal(state.safetyLoading, false);
    await state.setSafeMode(false);
    assert.equal(posts, 0, 'cancel acknowledgment never enables');
    confirmed = true;
    await state.setSafeMode(false);
    state = render();
    assert.equal(state.safeMode, false, 'UI follows server readback');
    assert.ok(state.expiresAt);
    serverState = { safeMode: true, expiresAt: null };
    emit('storage', { key: 'vps-control-safe-mode' });
    await settle();
    assert.equal(render().safeMode, true, 'other-tab disable resyncs');
    serverState = { safeMode: false, expiresAt: Date.now() + 900000 };
    emit('focus');
    await settle();
    assert.equal(render().safeMode, false, 'refocus reads the cookie state');
    postFailure = true;
    await render().setSafeMode(true);
    await regression('failed revoke + GET old grant', () => {
      state = render();
      assert.equal(state.safeMode, true, 'failed revoke must retain the local lock');
      assert.equal(state.expiresAt, null);
      assert.ok(state.safetyError);
    });
    for (const event of ['focus', 'visibilitychange', 'storage']) {
      emit(event, { key: 'vps-control-safe-mode' });
      await settle();
      await regression(`failed revoke automatic ${event}`, () => {
        state = render();
        assert.equal(state.safeMode, true, 'automatic sync must not restore the old grant');
        assert.ok(state.safetyError, 'failed revoke remains visible');
      });
    }
    serverState = { safeMode: true, expiresAt: null };
    emit('storage', { key: 'vps-control-safe-mode' });
    await settle();
    assert.equal(render().safeMode, true, 'confirmed revoke stays locked');
    assert.equal(render().safetyError, '', 'confirmed revoke clears failure');
    postFailure = false;
    await render().setSafeMode(false);
    postFailure = true;
    await render().setSafeMode(true);
    postFailure = false;
    await render().setSafeMode(true);
    assert.equal(render().safeMode, true, 'explicit revoke retry works');
    await render().setSafeMode(false);
    postFailure = true;
    await render().setSafeMode(true);
    postFailure = false;
    confirmed = false;
    await render().setSafeMode(false);
    await regression('canceled explicit retry', () => assert.equal(render().safeMode, true));
    confirmed = true;
    await render().setSafeMode(false);
    assert.equal(render().safeMode, false, 'acknowledged explicit retry may enable advanced');
    postFailure = 'http';
    await render().setSafeMode(true);
    assert.equal(render().safeMode, true, 'HTTP revoke failure retains lock');
    assert.equal(render().safetyError, 'revoke rejected');
    emit('focus');
    await settle();
    assert.equal(render().safeMode, true, 'HTTP revoke failure survives automatic sync');
    assert.equal(render().safetyError, 'revoke rejected');
    postFailure = false;
    await render().setSafeMode(true);
    postFailure = 'http';
    await render().setSafeMode(false);
    assert.equal(render().safeMode, true, 'failed enable remains locked');
    assert.equal(render().safetyError, 'revoke rejected', 'failed enable error survives safe readback');
    postFailure = false;
    await render().setSafeMode(false);
    render(); // Commit the new expiry effect before advancing its timer.
    serverState = { safeMode: true, expiresAt: null };
    [...timers.values()].forEach(fn => fn());
    await settle();
    assert.equal(render().safeMode, true, 'expiry relocks UI');
    networkFailure = true;
    emit('visibilitychange');
    await settle();
    state = render();
    assert.equal(state.safeMode, true);
    assert.ok(state.safetyError, 'network uncertainty is visible and fails closed');
    networkFailure = false;
    emit('focus');
    await settle();
    assert.equal(render().safetyError, '', 'successful retry clears stale sync error');
    assert.ok(safetyReads > 1);
    const unmount = () => { hooks.forEach(h => h?.cleanup?.()); hooks = []; effects = []; };
    unmount();
    await regression('provider cleanup', () => { assert.equal(listeners.size, 0); assert.equal(timers.size, 0); });
    idleMinutes = 1;
    render();
    await settle();
    for (const event of ['click', 'keydown', 'mousemove', 'scroll']) assert.equal(listeners.get(event)?.size, 1);
    const idleTimer = [...timers.values()][0];
    idleTimer();
    render(); // locked dependency changes: previous idle setup must be removed synchronously.
    await settle();
    await regression('idle dependency cleanup', () => {
      for (const event of ['click', 'keydown', 'mousemove', 'scroll']) assert.equal(listeners.get(event)?.size ?? 0, 0);
      assert.equal(timers.size, 0);
    });
    unmount();
    await regression('idle unmount cleanup', () => { assert.equal(listeners.size, 0); assert.equal(timers.size, 0); });
    listeners.clear(); timers.clear();
    render();
    await settle();
    assert.equal(timers.size, 1, 'idle timer installed while unlocked');
    unmount();
    assert.equal(listeners.size, 0, 'unmount removes installed idle listeners');
    assert.equal(timers.size, 0, 'unmount cancels installed idle timer');
    pendingSecurity = {};
    render();
    await settle();
    const late = pendingSecurity;
    unmount();
    late.resolve(Response.json({ success: true, data: { idleTimeoutMinutes: 1 } }));
    await settle();
    await regression('late idle fetch cancellation', () => { assert.equal(listeners.size, 0); assert.equal(timers.size, 0); });
  } finally {
    hooks.forEach(h => h?.cleanup?.());
    Object.assign(global, original);
  }
  for (const jti of [undefined, '', '   ', null, 42]) {
    const legacySession = { ...session, jti };
    await regression(`legacy mint ${JSON.stringify(jti)}`, () => assert.rejects(safety.createAdvancedToken(legacySession), /Advanced authorization unavailable/));
    const legacyGrant = await new SignJWT({ sessionIssuedAt: session.iat, sessionId: jti ?? '', forceLogoutVersion: 0, role: session.role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(session.sub).setAudience(safety.ADVANCED_COOKIE)
      .setIssuedAt(session.iat).setExpirationTime(session.iat + 900).sign(key);
    await regression(`legacy verify ${JSON.stringify(jti)}`, async () => assert.equal(await safety.verifyAdvancedToken(legacyGrant, legacySession), null));
  }
  const padded = { ...session, jti: ` ${session.jti} ` };
  const paddedGrant = await safety.createAdvancedToken(padded);
  assert.ok(await safety.verifyAdvancedToken(paddedGrant, padded), 'nonempty JTI binding preserves the exact string');
  assert.equal(await safety.verifyAdvancedToken(paddedGrant, session), null, 'binding must not normalize JTI');
  const legacyToken = await new SignJWT({ sub: session.sub, username: 'manager', role: session.role, forceLogoutVersion: 0 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(session.iat).setExpirationTime(session.exp).sign(key);
  assert.ok(await auth.verifySessionToken(legacyToken), 'legacy login stays usable for read-only access');
  const legacyRequest = request('/api/servers/local/cron', 'GET');
  legacyRequest.cookies.set('vps-session', legacyToken);
  assert.equal((await middleware(legacyRequest)).status, 200);
  const legacyGrant = await new SignJWT({ sessionIssuedAt: session.iat, sessionId: '', forceLogoutVersion: 0, role: session.role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(session.sub).setAudience(safety.ADVANCED_COOKIE)
    .setIssuedAt(session.iat).setExpirationTime(session.iat + 900).sign(key);
  const legacyMutation = request('/api/servers/local/terminal', 'POST', { safeModeOff: true }, legacyGrant);
  legacyMutation.cookies.set('vps-session', legacyToken);
  assert.equal((await middleware(legacyMutation)).status, 423, 'legacy login cannot mutate with a forged empty-JTI grant');
  cookieMap.set('vps-session', legacyToken);
  await regression('legacy endpoint error', async () => {
    const response = await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: false, acknowledged: true }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /sign in again/i);
    assert.equal(cookieMap.has(safety.ADVANCED_COOKIE), false);
  });
  await regression('legacy GET stays read-only', async () => assert.equal((await (await endpoint.GET()).json()).data.safeMode, true));
  assert.equal((await endpoint.POST(request('/api/auth/safety', 'POST', { safeMode: true }))).status, 200, 'legacy login may still revoke');
  cookieMap.set('vps-session', token);
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const proxyRequest = (origin, host = 'vps.mywf.in') => {
    const req = new NextRequest('https://0.0.0.0:3000/api/auth/safety', { method: 'POST', headers: { ...(host ? { host } : {}), ...(origin !== undefined ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ safeMode: false, acknowledged: true }) });
    return req;
  };
  try {
    await regression('public HTTPS origin with internal nextUrl', async () => assert.equal((await endpoint.POST(proxyRequest('https://vps.mywf.in'))).status, 200));
    for (const origin of [undefined, 'null', 'https://evil.example', 'http://vps.mywf.in', 'https://user:pass@vps.mywf.in', 'https://vps.mywf.in/path', 'https://vps.mywf.in?x=1', 'https://vps.mywf.in#hash', 'https://vps.mywf.in,https://evil.example', 'ftp://vps.mywf.in']) {
      assert.equal((await endpoint.POST(proxyRequest(origin))).status, 403, `invalid origin ${origin}`);
    }
    assert.equal((await endpoint.POST(proxyRequest('https://vps.mywf.in', ''))).status, 403, 'Host required');
    const forwarded = proxyRequest('https://evil.example');
    forwarded.headers.set('x-forwarded-host', 'evil.example');
    forwarded.headers.set('x-forwarded-proto', 'https');
    assert.equal((await endpoint.POST(forwarded)).status, 403, 'forwarded headers cannot authorize');
    const port = proxyRequest('https://vps.mywf.in:8443', 'vps.mywf.in:8443');
    await regression('explicit host port', async () => assert.equal((await endpoint.POST(port)).status, 200));
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
  }
  assert.deepEqual(failures, [], 'scoped auth safety regressions');
  console.log('SEC-01 advanced safety regression passed (offline JWT, DB stubs, middleware, endpoint origin/JTI, provider revoke/sync/expiry/idle cleanup).');
})().catch(error => { console.error(error); process.exitCode = 1; });
