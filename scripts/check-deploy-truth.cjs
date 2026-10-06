// Run: node scripts/check-deploy-truth.cjs — offline TypeScript VM, no DB/SSH/host mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const reply = (body, options = {}) => ({ status: options.status || 200, body });
let calls, row, session, allowed, failAnalysis, remoteSuccess;
const touch = (name, fn = () => {}) => (...args) => { calls.push([name, ...args]); return fn(...args); };
const mocks = {
  'next/server': { NextResponse: { json: reply } },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/permissions': { can: (role, min) => (min === 'ADMIN' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']).includes(role) },
  '@/lib/server-access': { canAccessServer: touch('scope', () => allowed), scopedServerWhere: async () => ({}) },
  '@/lib/operation-safety': { requireSafeModeOff: touch('safety', (_action, body) => body.safeModeOff === true ? null : reply({ success: false }, { status: 423 })) },
  '@/lib/db': { prisma: {
    server: { findUnique: touch('server', () => ({ id: 'remote-a' })) },
    deploymentLog: {
      findUnique: touch('lookup', () => row),
      create: touch('create', ({ data }) => (row = { domain: null, serverId: null, commitHash: null, customPath: null, ...data, id: 'new', createdAt: new Date() })),
      update: touch('update', ({ data }) => (row = { ...row, ...data })),
    },
  } },
  '@/lib/crypto': { encrypt: touch('encrypt', value => `encrypted:${value}`), decrypt: value => value.replace('encrypted:', '') },
  '@/lib/deployer': {
    prepareDeployment: touch('analyze', () => { if (failAnalysis) throw new Error('Clone failed'); return { projectDir: '/mock/repo', detectedStack: 'node', port: 3000 }; }),
    cleanupDeployDir: touch('cleanup'), pruneOldDeployments: touch('prune'),
  },
  '@/lib/server-ssh': { connectToServer: touch('ssh', async () => ({ ssh: {} })), isDisconnectedError: () => false },
  '@/lib/ssh': { remoteDeployViaSSH: touch('deploy', async () => ({ success: remoteSuccess, status: remoteSuccess ? 'RUNNING' : 'FAILED', commitHash: 'abc123', logs: 'Remote execution result\n' })), executeCommand: touch('command', async (_ssh, command) => require('./check-guided-deploy.cjs').output(command)), closeSSH: touch('close') },
  '@/lib/sanitize': { sanitizeLogs: text => text },
  '@/lib/audit': { auditLog: touch('audit'), getClientIp: () => 'mock' },
  '@/lib/safe-error': { safeErrorMessage: () => 'Operation failed' },
  '@/lib/local-server': { execOnHost: touch('command', () => 'ok') },
  child_process: { execFileSync: touch('command', () => 'ok') },
};
function load(file, overrides = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Error, Date, Buffer, console, require: name => {
    if (name in overrides) return overrides[name];
    if (name === '@/lib/deploy-preflight') return require('./check-guided-deploy.cjs').load('src/lib/deploy-preflight.ts');
    if (name === './useDeployPreflight') return require('./check-guided-deploy.cjs').load('src/components/deploy/useDeployPreflight.ts', { react: overrides.react }, globals);
    if (name === '@/lib/validation') return load('src/lib/validation.ts');
    assert(name in mocks, `Unmocked dependency: ${name}`);
    return mocks[name];
  }, ...globals }, { filename: file });
  return module.exports;
}
function reset() {
  calls = []; row = { id: 'old', status: 'RUNNING', serverId: 'remote-a', repoUrl: 'https://github.com/example/repo', createdAt: new Date() };
  session = { sub: 'alice', username: 'alice', role: 'ADMIN' }; allowed = true; failAnalysis = false; remoteSuccess = true;
}
const request = body => ({ json: async () => body });
const valid = { repoUrl: 'https://github.com/example/repo', branch: 'main' };
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
function text(tree) { return tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join(' '); }
function mount(file, name, extra = {}, globals = {}) {
  const states = []; let cursor = 0;
  const react = { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useRef: initial => { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; }, useEffect: () => {}, useCallback: fn => fn };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const components = new Proxy({}, { get: (_, key) => key });
  const component = load(file, { react, 'react/jsx-runtime': runtime, 'lucide-react': components,
    '@/components/ui/Button': components, '@/components/ui/Input': components, '@/components/ui/Badge': components,
    '@/components/ui/FileBrowser': components, '@/components/deploy/DeployRequirementBanner': components,
    '@/contexts/SafeModeContext': { useSafeMode: () => ({ safeMode: true }) }, ...extra }, globals)[name];
  return () => { cursor = 0; return component(); };
}
async function main() {
  const failures = [];
  async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
  await check('local analysis finishes ANALYZED, clears clone, never deploys or stores unused secrets', async () => {
    for (const serverId of [undefined, 'local']) {
      reset();
      const response = await load('src/app/api/deploy/route.ts').POST(request({ ...valid, serverId, domain: 'unused.test', customPath: '/unused', envVars: 'TOKEN=unused-secret' }));
      assert.equal(response.status, 201); assert.equal(response.body.success, true);
      assert.equal(response.body.data.status, 'ANALYZED'); assert.equal(row.status, 'ANALYZED');
      assert.equal(row.encryptedEnv, null); assert.equal(row.domain, null); assert.equal(row.customPath, null);
      assert.match(row.logs, /analysis complete/i); assert.match(row.logs, /not deployed/i);
      assert(calls.some(([name]) => name === 'cleanup')); assert(calls.some(([name]) => name === 'prune'));
      assert(!calls.some(([name]) => ['encrypt', 'ssh', 'deploy', 'safety', 'audit'].includes(name)));
      assert(!JSON.stringify(row).includes('unused-secret'));
    }
  });
  await check('analysis failure is terminal FAILED, never deployment success', async () => {
    reset(); failAnalysis = true;
    const response = await load('src/app/api/deploy/route.ts').POST(request(valid));
    assert.equal(response.status, 500); assert.equal(response.body.success, false); assert.equal(row.status, 'FAILED');
    assert(!calls.some(([name]) => name === 'deploy'));
  });
  await check('remote Git retains real execution and literal acknowledgment', async () => {
    for (const safeModeOff of [undefined, false, 'true']) {
      reset(); assert.equal((await load('src/app/api/deploy/route.ts').POST(request({ ...valid, serverId: 'remote-a', customPath: '/opt/app', safeModeOff }))).status, 423);
      assert(!calls.some(([name]) => ['server', 'create', 'ssh', 'deploy', 'cleanup'].includes(name)));
    }
    for (const success of [true, false]) {
      reset(); remoteSuccess = success;
      const response = await load('src/app/api/deploy/route.ts').POST(request({ ...valid, serverId: 'remote-a', customPath: '/opt/app', envVars: 'TOKEN=remote-secret', safeModeOff: true }));
      assert.equal(response.status, success ? 201 : 500); assert.equal(row.status, success ? 'RUNNING' : 'FAILED');
      assert(calls.some(([name]) => name === 'deploy')); assert(!calls.some(([name]) => name === 'analyze'));
    }
  });
  await check('remote final preflight stops before deployment log/execution and closes SSH', async () => {
    reset();
    const old = mocks['@/lib/ssh'].executeCommand;
    mocks['@/lib/ssh'].executeCommand = touch('command', async () => '__PANEL_DEPLOY_EXIT_1__');
    try {
      const response = await load('src/app/api/deploy/route.ts').POST(request({ ...valid, serverId: 'remote-a', customPath: '/opt/new', safeModeOff: true }));
      assert.equal(response.status, 500);
      assert(calls.some(([name]) => name === 'ssh')); assert(calls.some(([name]) => name === 'close'));
      assert(!calls.some(([name]) => ['create', 'deploy'].includes(name)));
    } finally { mocks['@/lib/ssh'].executeCommand = old; }
  });
  await check('unsupported rollback preserves auth/scope/ack and never writes or audits success', async () => {
    const post = body => load('src/app/api/deploy/rollback/route.ts').POST(request(body));
    reset(); session = null; assert.equal((await post({ deploymentId: 'old' })).status, 401); assert.equal(calls.length, 0);
    reset(); session.role = 'MANAGER'; assert.equal((await post({ deploymentId: 'old' })).status, 403); assert.equal(calls.length, 0);
    reset(); allowed = false; assert.equal((await post({ deploymentId: 'old', safeModeOff: true })).status, 403);
    assert(!calls.some(([name]) => ['safety', 'create', 'audit', 'deploy'].includes(name)));
    for (const safeModeOff of [undefined, false, 'true']) {
      reset(); assert.equal((await post({ deploymentId: 'old', safeModeOff })).status, 423);
      assert(!calls.some(([name]) => ['create', 'audit', 'deploy'].includes(name)));
    }
    for (const status of ['RUNNING', 'ANALYZED', 'FAILED']) {
      reset(); row.status = status;
      const response = await post({ deploymentId: 'old', safeModeOff: true });
      assert.equal(response.status, 503); assert.equal(response.body.success, false); assert.equal(response.body.code, 'ROLLBACK_UNAVAILABLE');
      assert.match(response.body.error, /not supported|unavailable/i);
      assert(!calls.some(([name]) => ['create', 'update', 'audit', 'ssh', 'deploy'].includes(name)));
    }
  });
  await check('local Git requirements do not require Docker', async () => {
    reset(); const response = await load('src/app/api/deploy/requirements/route.ts').POST(request({ mode: 'git', serverId: 'local' }));
    assert.equal(response.status, 200); assert.deepEqual(Array.from(response.body.data.requirements, item => item.name), ['Git']);
    assert(!calls.some(([name, _bin, args]) => name === 'command' && JSON.stringify(args).includes('docker')));
  });
  await check('form names local analysis, hides unused fields and sends no retained remote secrets', async () => {
    const requests = [];
    const render = mount('src/components/deploy/DeployForm.tsx', 'DeployForm', {}, { fetch: async (url, options) => { requests.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({ success: true, data: { id: 'analysis', status: 'ANALYZED', detectedStack: 'node' } }) }; } });
    let tree = render(); assert.match(text(tree), /Analyze repository/); assert.match(text(tree), /not deploy/i);
    assert(!nodes(tree).some(node => node.type === 'textarea')); assert(!text(tree).includes('Domain (optional)')); assert(!text(tree).includes('Custom Path'));
    nodes(tree).find(node => node.type === 'button' && node.props.onClick?.toString().includes('setDeployTarget("remote")')).props.onClick();
    tree = render(); nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'TOKEN=retained-remote-secret' } });
    nodes(tree).find(node => node.type === 'button' && node.props.onClick?.toString().includes('setDeployTarget("local")')).props.onClick();
    tree = render(); await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert(!JSON.stringify(requests).includes('retained-remote-secret'));
    tree = render(); assert.match(text(tree), /Analysis complete/); assert(!text(tree).includes('Deployment Created'));
    nodes(tree).find(node => node.type === 'button' && node.props.onClick?.toString().includes('setDeployTarget("remote")')).props.onClick();
    assert(!text(render()).includes('Analysis complete'), 'target switch clears the prior operation result');
    assert(!nodes(tree).some(node => node.props.loading === true));
  });
  await check('remote terminal outcomes render without deployment success or perpetual progress', () => {
    const rows = ['PREPARED', 'UNVERIFIED', 'FAILED'].map(status => ({ id: status, status, serverId: 'remote-a', logs: '', repoUrl: status, createdAt: new Date() }));
    const tree = mount('src/components/deploy/DeployLog.tsx', 'DeployLog', { '@/hooks/useSSE': { useSSE: () => ({ data: { deployments: rows } }) } })();
    const cards = nodes(tree).filter(node => node.props.className === 'rounded-xl border border-gray-700 bg-gray-800 p-4');
    assert.match(text(cards[0]), /Repository prepared/); assert.match(text(cards[0]), /not deployed/); assert.match(text(cards[0]), /remain on remote server/);
    assert.match(text(cards[1]), /Readiness unverified/); assert.match(text(cards[2]), /FAILED/);
    assert(!nodes(tree).some(node => node.props.variant === 'success' || node.props.loading === true || node.props.className?.includes('animate-spin')));
    for (const status of ['PREPARED', 'UNVERIFIED', 'FAILED']) {
      let index = 0;
      const react = { useState: initial => { const i = index++; return [i === 10 ? { id: status, status, detectedStack: 'unknown' } : initial, () => {}]; }, useEffect: () => {} };
      const form = mount('src/components/deploy/DeployForm.tsx', 'DeployForm', { react, './useDeployPreflight': { useDeployPreflight: () => ({ preflight: null, checking: false, invalidate: () => {}, runPreflight: () => {}, readyRef: { current: false }, busyRef: { current: false } }) } })();
      assert.match(text(form), status === 'PREPARED' ? /prepared — not deployed/ : status === 'UNVERIFIED' ? /Readiness unverified/ : /Deployment failed/);
      assert(!text(form).includes('Remote services running and healthy')); assert(!nodes(form).some(node => node.props.loading === true));
    }
  });
  await check('history distinguishes analysis and conservatively labels known legacy false BUILDING only', () => {
    const rows = [
      { id: 'analyzed', status: 'ANALYZED', serverId: null, logs: '', repoUrl: valid.repoUrl, createdAt: new Date() },
      { id: 'legacy', status: 'BUILDING', serverId: null, logs: 'Starting deployment of repo\nTarget: Local\nDetected stack: node\n', repoUrl: valid.repoUrl, createdAt: new Date() },
      { id: 'remote', status: 'BUILDING', serverId: 'remote-a', logs: 'Starting deployment of repo\nTarget: Local\nDetected stack: node\n', repoUrl: valid.repoUrl, createdAt: new Date() },
      { id: 'docker', status: 'BUILDING', serverId: null, logs: 'Docker build', repoUrl: 'docker://nginx', createdAt: new Date() },
    ];
    const render = mount('src/components/deploy/DeployLog.tsx', 'DeployLog', { '@/hooks/useSSE': { useSSE: () => ({ data: { deployments: rows } }) } });
    const tree = render();
    // Test per row using distinct URLs rather than React's inaccessible key.
    rows.forEach(row => { row.repoUrl = row.id; });
    const updated = render(); const cards = nodes(updated).filter(node => node.props.className === 'rounded-xl border border-gray-700 bg-gray-800 p-4');
    assert.match(text(cards[0]), /Analysis complete/); assert.match(text(cards[0]), /not deployed/i);
    assert.match(text(cards[1]), /Legacy analysis/); assert(!text(cards[1]).includes('BUILDING'));
    assert.match(text(cards[2]), /BUILDING/); assert.match(text(cards[3]), /BUILDING/);
    assert(!nodes(tree).some(node => node.type === 'button' && /rollback/i.test(text(node)) && !node.props.disabled));
  });
  assert.equal(failures.length, 0, `Deploy truth failures: ${failures.join(', ')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
