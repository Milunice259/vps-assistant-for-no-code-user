// Offline only: real TS/helpers/routes with mocked DB, auth, SSH and host runners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, Error, Date, console, require: name => name in mocks ? mocks[name] : name === '@/lib/validation' ? load('src/lib/validation.ts') : name === '@/lib/deploy-preflight' ? load('src/lib/deploy-preflight.ts') : name === './useDeployPreflight' ? load('src/components/deploy/useDeployPreflight.ts', mocks, globals) : require(name), ...globals }, { filename: file });
  return module.exports;
}
const helper = load('src/lib/deploy-preflight.ts');
const id = 'a'.repeat(64);
const fixtureCompose = 'services: {web: {image: nginx, ports: [{target: 80, published: "8080", protocol: udp}], environment: {TOKEN: private-secret}}}';
const config = { services: { web: { image: 'nginx', ports: [{ target: 80, published: '8080', protocol: 'udp' }] } } };
const mark = (text = '', code = 0) => `${text}\n__PANEL_DEPLOY_EXIT_${code}__`;
function output(command) {
  if (command.includes('df -P') || command.includes('/MemTotal/')) return mark('50');
  if (command.includes('config --format json')) return mark(JSON.stringify(config));
  if (command.includes('docker run -d')) return mark(id);
  if (command.includes('ps -a -q')) return mark(id);
  if (command.includes('docker inspect ')) return mark(JSON.stringify([{ Id: id, State: { Status: 'running', Health: { Status: 'healthy' } }, Config: { Labels: { 'com.docker.compose.service': 'web' } } }]));
  return mark();
}
function hooks() {
  const values = []; let cursor = 0;
  return { react: { useState: initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; }, useRef: initial => { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; }, useEffect: () => {}, useCallback: fn => fn }, render: fn => { cursor = 0; return fn(); } };
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join(' ');
async function main() {
  // Exercise the generated shell with fake Docker only; no production command runs.
  const { spawnSync } = require('node:child_process');
  for (const exit of [0, 7]) {
    const run = async command => { const result = spawnSync('/bin/sh', ['-c', `docker() { return ${exit}; }; ${command}`], { encoding: 'utf8' }); assert.equal(result.status, 0); return result.stdout.trim(); };
    if (exit) await assert.rejects(helper.checked(run, 'docker info')); else assert.equal(await helper.checked(run, 'docker info'), '');
  }
  await assert.rejects(helper.checked(async () => '', 'docker info'));
  assert.equal(helper.validateDockerDeploy({ type: 'image', image: 'nginx' }), null);
  assert.equal(helper.validateDockerDeploy({ type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose }), null);
  for (const composeContent of ['services: {web: {build: .}}', 'services: {web: {image: nginx, volumes: ["/opt/data:/data"]}}', 'services: {web: {image: nginx}}\nvolumes: {data: {external: true}}']) assert(helper.validateDockerDeploy({ type: 'compose', composeContent, projectPath: '/opt/new' }));
  await assert.rejects(helper.resourcePreflight(async c => c.includes('df -P') ? mark('') : output(c), true));
  const commands = [];
  await helper.dockerPreflight(async c => { commands.push(c); return output(c); }, { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose });
  assert(commands.some(c => c.includes('ss -lunH')), 'UDP must be checked');
  assert(commands.some(c => c.includes('-f - config')), 'native config runs before writes');
  assert(!commands.some(c => /mkdir|docker-compose.yml|up -d/.test(c)));
  await assert.rejects(helper.dockerPreflight(async c => c.includes('ss -lunH') ? mark('occupied') : output(c), { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose }));
  await assert.rejects(helper.dockerPreflight(async c => c.includes('test ! -e') ? mark('', 1) : output(c), { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose }));
  await assert.rejects(helper.dockerPreflight(async c => c.includes("docker ps -a --format") ? mark('existing') : output(c), { type: 'image', image: 'nginx', name: 'existing' }));
  for (const [state, health, expected] of [['running', 'healthy', 'RUNNING'], ['running', undefined, 'UNVERIFIED'], ['running', 'starting', 'UNVERIFIED'], ['running', 'unhealthy', 'FAILED'], ['exited', 'healthy', 'FAILED'], ['restarting', 'healthy', 'UNVERIFIED']]) assert.equal(helper.readiness([{ Id: id, State: { Status: state, Health: { Status: health } } }], undefined, id), expected);
  for (const malformed of [[null], [42], [{}], [{ State: null }]]) assert.equal(helper.readiness(malformed), 'UNVERIFIED');
  assert.equal(helper.readiness([], ['web']), 'UNVERIFIED');
  await assert.rejects(helper.dockerPreflight(async c => c.includes('docker ps -q') ? mark(id) : c.includes('NetworkSettings.Ports') ? mark(JSON.stringify({ '80/udp': [{ HostPort: '8080' }] })) : output(c), { type: 'image', image: 'nginx', ports: ['8080:80/udp'] }));
  assert.equal(helper.readiness([{ State: { Status: 'running', Health: { Status: 'healthy' } }, Config: { Labels: { 'com.docker.compose.service': 'other' } } }], ['web']), 'UNVERIFIED');
  console.log('PASS native completion marker, resources, UDP, Compose config/fresh assets and conservative health');

  let allowed = true, session = { sub: 'test', role: 'ADMIN' }, calls = [], row, runner = output;
  const mocks = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/auth': { getSession: async () => session }, '@/lib/permissions': { can: () => true },
    '@/lib/server-access': { canAccessServer: async () => allowed },
    '@/lib/operation-safety': { requireSafeModeOff: (_action, body) => body.safeModeOff === true ? null : { status: 423 } },
    '@/lib/server-ssh': { connectToServer: async () => { calls.push('ssh'); return { ssh: {} }; } },
    '@/lib/ssh': { closeSSH: async () => {}, executeCommand: async (_ssh, c) => { calls.push(c); return runner(c); } },
    '@/lib/local-server': { isLocalServer: id => id === 'local', execOnHost: async c => { calls.push(c); return runner(c); }, execLocal: async c => { calls.push(c); return runner(c); } },
    '@/lib/db': { prisma: { deploymentLog: { create: async ({ data }) => { calls.push('write'); return row = { domain: null, commitHash: null, ...data, id: 'deploy-id', createdAt: new Date() }; }, update: async ({ data }) => row = { ...row, ...data } }, app: { create: async () => {} } } },
  };
  const post = body => load('src/app/api/deploy/docker/route.ts', mocks).POST({ json: async () => body });
  const image = { type: 'image', image: 'nginx', serverId: 'remote', safeModeOff: true };
  allowed = false; assert.equal((await post(image)).status, 403); assert.equal(calls.length, 0);
  allowed = true; assert.equal((await post({ ...image, image: 'bad;image' })).status, 400); assert.equal(calls.length, 0);
  assert.equal((await post({ ...image, safeModeOff: false })).status, 423); assert.equal(calls.length, 0);
  for (const serverId of ['local', 'remote']) {
    calls = []; runner = output;
    const response = await post({ ...image, serverId, env: { TOKEN: 'private-secret' } });
    assert.equal(response.body.data.status, 'RUNNING');
    assert(!JSON.stringify(response.body).includes('private-secret')); assert(!JSON.stringify(row).includes('private-secret'));
    assert(calls.indexOf('write') > calls.findIndex(c => c.includes?.('/MemTotal/')), 'final preflight precedes deployment log');
    for (const [health, result] of [[undefined, 'UNVERIFIED'], ['starting', 'UNVERIFIED'], ['unhealthy', 'FAILED']]) {
      runner = c => c.includes('docker inspect ') ? mark(JSON.stringify([{ Id: id, State: { Status: 'running', Health: { Status: health } } }])) : output(c);
      const response = await post({ ...image, serverId }); assert.equal(response.body.data.status, result); assert.equal(response.body.success, false);
    }
    runner = c => { if (c.includes('docker run -d')) throw new Error(c); return output(c); };
    const failure = await post({ ...image, serverId, env: { TOKEN: 'private-secret' } }); assert.equal(failure.body.data.status, 'FAILED'); assert(!JSON.stringify(failure.body).includes('private-secret'));
    runner = output; calls = [];
    const compose = { type: 'compose', serverId, safeModeOff: true, projectPath: '/opt/new', composeContent: fixtureCompose };
    assert.equal((await post(compose)).body.data.status, 'RUNNING');
    assert(calls.findIndex(c => c.includes?.('config --format json')) < calls.findIndex(c => c.includes?.('mkdir ')));
    assert(!JSON.stringify(row).includes(Buffer.from(fixtureCompose).toString('base64')));
    runner = c => { if (c.includes('> ') && c.includes('docker-compose.yml')) throw new Error(c); return output(c); };
    const failed = await post(compose); assert.equal(failed.body.data.status, 'FAILED'); assert.match(row.logs, /Partial files/); assert(!JSON.stringify(failed.body).includes('private-secret'));
    runner = c => c.includes('test ! -e') ? mark('', 1) : output(c); calls = [];
    assert.equal((await post(compose)).status, 400); assert(!calls.includes('write')); assert(!calls.some(c => c.includes?.('mkdir ')));
  }
  console.log('PASS local/remote authorization, validation, final gating, truthful results and secret-safe partial failures');

  const h = hooks(), pending = [];
  const usePreflight = load('src/components/deploy/useDeployPreflight.ts', { react: h.react }, { fetch: () => new Promise(resolve => pending.push(resolve)) }).useDeployPreflight;
  let view = h.render(usePreflight);
  const old = view.runPreflight({ composeContent: 'private' }); view.invalidate();
  pending.shift()({ ok: true, json: async () => ({ success: true, data: { ready: true } }) }); await old;
  view = h.render(usePreflight); assert.equal(view.preflight, null); assert.equal(view.readyRef.current, false);
  const first = view.runPreflight({}); const second = view.runPreflight({});
  pending.shift()({ ok: true, json: async () => ({ success: true, data: { ready: true } }) }); await first;
  view = h.render(usePreflight); assert.equal(view.readyRef.current, false);
  pending.shift()({ ok: true, json: async () => ({ success: true, data: { ready: true } }) }); await second;
  view = h.render(usePreflight); assert.equal(view.readyRef.current, true); view.invalidate(); assert.equal(view.readyRef.current, false);
  console.log('PASS input invalidation and late/out-of-order preflight rejection without secret snapshots');

  for (const component of ['DockerImageDeploy', 'DockerComposeDeploy', 'DeployForm']) {
    const hook = hooks(), requests = [], pending = []; let confirms = true;
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    const proxy = new Proxy({}, { get: (_, key) => key });
    const componentMocks = { react: hook.react, 'react/jsx-runtime': runtime, 'lucide-react': proxy,
      '@/components/ui/Button': proxy, '@/components/ui/Input': proxy, '@/components/ui/Badge': proxy, '@/components/ui/FileBrowser': proxy,
      '@/components/deploy/DeployRequirementBanner': proxy, '@/contexts/SafeModeContext': { useSafeMode: () => ({ safeMode: false }) } };
    const fn = load(`src/components/deploy/${component}.tsx`, componentMocks, { window: { confirm: () => confirms }, fetch: async (url, options) => { requests.push([url, JSON.parse(options.body)]); if (url.endsWith('preflight')) return { ok: true, json: async () => ({ success: true, data: { ready: true, checks: [], nextSteps: [] } }) }; return new Promise(resolve => pending.push(resolve)); } })[component];
    const render = () => nodes(hook.render(fn));
    let tree = render();
    if (component === 'DeployForm') { tree.find(n => n.type === 'button' && n.props.onClick?.toString().includes('setDeployTarget("remote")')).props.onClick(); tree = render(); tree.find(n => n.type === 'select').props.onChange({ target: { value: 'remote' } }); tree = render(); }
    for (const node of tree) if (['Input', 'input', 'textarea'].includes(node.type) && node.props.onChange) node.props.onChange({ target: { value: node.props.placeholder?.startsWith('https') ? 'https://github.com/example/repo' : node.type === 'textarea' ? fixtureCompose : node.props.placeholder?.startsWith('/') ? '/opt/new' : node.props.placeholder === 'nginx:latest' ? 'nginx' : node.props.value } });
    tree = render();
    const deployNode = () => render().find(n => n.type === 'Button' && (n.props.type === 'submit' || text(n).includes('Deploy Image') || text(n).includes('Deploy Compose')));
    const execute = () => component === 'DeployForm' ? render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }) : deployNode().props.onClick();
    assert(deployNode().props.disabled); await execute(); assert.equal(requests.length, 0);
    await tree.find(n => n.type === 'Button' && text(n).includes('Run pre-flight')).props.onClick(); assert(!deployNode().props.disabled);
    const editable = render().find(n => ['Input', 'input', 'textarea'].includes(n.type) && n.props.onChange); editable.props.onChange({ target: { value: editable.props.value } }); assert(deployNode().props.disabled); await execute(); assert.equal(requests.length, 1);
    await render().find(n => n.type === 'Button' && text(n).includes('Run pre-flight')).props.onClick();
    confirms = false; await execute(); assert.equal(requests.length, 2); confirms = true;
    const flight = execute(); await execute(); assert.equal(requests.length, 3, 'single-flight prevents second execution'); assert(render().find(n => n.type === 'fieldset').props.disabled);
    pending.shift()({ ok: true, json: async () => ({ success: false, data: { id: 'real-log', status: 'UNVERIFIED', detectedStack: 'docker' }, error: 'Readiness unverified' }) }); await flight;
    assert(deployNode().props.disabled); assert(text(hook.render(fn)).includes('UNVERIFIED') || text(hook.render(fn)).includes('Readiness unverified'));
    assert(render().some(n => n.type === 'a' && n.props.href === '/deploy#deployment-real-log'));
  }
  console.log('PASS all guided forms: gated handler/button, cancel, exact-input invalidation, busy lock, single-flight and actual log/result');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { load, output, mark, hooks };
