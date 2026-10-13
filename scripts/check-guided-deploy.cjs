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
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, Error, Date, console, require: name => name in mocks ? mocks[name] : name === './general-settings' ? { getGeneralSettings: async () => ({ dockerRestartPolicy: 'unless-stopped', dockerMemoryLimitMB: 0 }) } : name === '@/lib/validation' ? load('src/lib/validation.ts') : name === '@/lib/deploy-preflight' ? load('src/lib/deploy-preflight.ts') : name === './useDeployPreflight' ? load('src/components/deploy/useDeployPreflight.ts', mocks, globals) : name === './compose-deployment' || name === '@/lib/compose-deployment' ? canonicalCompose() : name === '@/lib/i18n' ? { useTranslation: () => ({ t: (_key, fallback) => fallback }) } : require(name), ...globals }, { filename: file });
  return module.exports;
}
// Canonical native service boundary; route checks do not claim Engine/CAS coverage.
function nativeMocks() {
  const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
  const compose = load('src/lib/compose-deployment.ts', {
    './db': {}, './deploy-preflight': { ...load('src/lib/deploy-preflight.ts', { './compose-deployment': { validateComposeAssets: (...args) => compose.validateComposeAssets(...args) } }) },
    './container-recreate': { configurationHash: value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex') },
    './deployment-state': { deploymentFail: fail }, './validation': load('src/lib/validation.ts'),
  });
  const image = load('src/lib/image-deployment.ts', {
    '@/lib/container-recreate': {}, '@/lib/db': {}, '@/lib/app-routing': { validateDomain: () => {}, validateRouting: () => {} },
    '@/lib/deployment-state': { deploymentFail: fail }, '@/lib/deploy-preflight': load('src/lib/deploy-preflight.ts', { './compose-deployment': compose }), '@/lib/local-server': {},
  });
  return { compose, image };
}
let canonical;
function canonicalCompose() { return (canonical ||= nativeMocks()).compose; }
function serviceMocks(onInput = () => {}) {
  const native = nativeMocks();
  let target;
  return {
    '@/lib/image-deployment': { validateImageInput: native.image.validateImageInput, deployImage: async (body, server, deployment, run) => {
      target = server; onInput(body, server, deployment);
      await helper.checked(run, 'native-image-create');
      const rows = JSON.parse(await helper.checked(run, 'docker inspect fixture'));
      const status = helper.readiness(rows);
      return { containerId: id, status, readiness: status.toLowerCase(), routing: null };
    } },
    '@/lib/compose-deployment': { ...native.compose, composePreflight: async (run, body, server) => { await helper.resourcePreflight(run, true); return native.compose.composePreflight(run, body, server); }, deployCompose: async (run, body, server, deployment) => {
      target = server; onInput(body, server, deployment);
      const doc = require('js-yaml').load(body.composeContent);
      const binds = Object.values(doc.services).flatMap(s => s.volumes || []).filter(v => typeof v === 'string' ? v.startsWith('/') : v.type === 'bind').map(v => typeof v === 'string' ? v.split(':')[0] : v.source);
      assert.deepEqual(body.composeConsent?.foreignBinds || [], binds, 'native boundary requires exact bind consent');
      await helper.checked(run, 'native-compose-create');
      const rows = JSON.parse(await helper.checked(run, 'docker inspect fixture'));
      return { containerIds: [id], status: helper.readiness(rows, ['web']) };
    } },
    '@/lib/deployment-state': { readDeploymentDefinition: async () => ({ state: { serverId: target, pending: false } }) },
  };
}
const helper = load('src/lib/deploy-preflight.ts');
const id = 'a'.repeat(64);
const fixtureCompose = 'services: {web: {image: nginx, ports: [{target: 80, published: "8080", protocol: udp}], environment: {TOKEN: private-secret}}}';
const config = { services: { web: { image: 'nginx', ports: [{ target: 80, published: '8080', protocol: 'udp' }] } } };
const mark = (text = '', code = 0) => `${text}\n__PANEL_DEPLOY_EXIT_${code}__`;
function output(command) {
  if (command.includes('if test -e')) return mark('no');
  if (command.includes('df -P') || command.includes('/MemTotal/')) return mark('50');
  if (command.includes('config --format json')) return mark(JSON.stringify(config));
  if (command.includes('native-image-create')) return mark(id);
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
  for (const composeContent of ['services: {web: {build: .}}']) assert(helper.validateDockerDeploy({ type: 'compose', composeContent, projectPath: '/opt/new' }));
  await assert.rejects(helper.resourcePreflight(async c => c.includes('df -P') ? mark('') : output(c), true));
  const commands = [];
  await helper.dockerPreflight(async c => { commands.push(c); return output(c); }, { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose });
  assert(commands.some(c => c.includes('ss -lunH')), 'UDP must be checked');
  assert(commands.some(c => c.includes('-f - config')), 'native config runs before writes');
  assert(!commands.some(c => /mkdir|docker-compose.yml|up -d/.test(c)));
  await assert.rejects(helper.dockerPreflight(async c => c.includes('ss -lunH') ? mark('occupied') : output(c), { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose }));
  await assert.rejects(helper.dockerPreflight(async c => c.includes('test ! -L') ? mark('', 1) : output(c), { type: 'compose', projectPath: '/opt/new', composeContent: fixtureCompose }));
  await assert.rejects(helper.dockerPreflight(async c => c.includes("docker ps -a --format") ? mark('existing') : output(c), { type: 'image', image: 'nginx', name: 'existing' }));
  for (const [state, health, expected] of [['running', 'healthy', 'RUNNING'], ['running', undefined, 'UNVERIFIED'], ['running', 'starting', 'UNVERIFIED'], ['running', 'unhealthy', 'FAILED'], ['exited', 'healthy', 'FAILED'], ['restarting', 'healthy', 'UNVERIFIED']]) assert.equal(helper.readiness([{ Id: id, State: { Status: state, Health: { Status: health } } }], undefined, id), expected);
  for (const malformed of [[null], [42], [{}], [{ State: null }]]) assert.equal(helper.readiness(malformed), 'UNVERIFIED');
  assert.equal(helper.readiness([], ['web']), 'UNVERIFIED');
  await assert.rejects(helper.dockerPreflight(async c => c.includes('docker ps -q') ? mark(id) : c.includes('NetworkSettings.Ports') ? mark(JSON.stringify({ '80/udp': [{ HostPort: '8080' }] })) : output(c), { type: 'image', image: 'nginx', ports: ['8080:80/udp'] }));
  assert.equal(helper.readiness([{ State: { Status: 'running', Health: { Status: 'healthy' } }, Config: { Labels: { 'com.docker.compose.service': 'other' } } }], ['web']), 'UNVERIFIED');
  console.log('PASS native completion marker, resources, UDP, Compose config/fresh assets and conservative health');

  let allowed = true, signed = true, session = { sub: 'test', role: 'ADMIN' }, calls = [], row, runner = output;
  const mocks = {
    ...serviceMocks(),
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/auth': { getSession: async () => session }, '@/lib/permissions': { can: () => true },
    '@/lib/server-access': { canAccessServer: async () => allowed },
    '@/lib/operation-safety': { ADVANCED_COOKIE: 'advanced', verifyAdvancedToken: async () => signed, requireSafeModeOff: (_action, body) => body.safeModeOff === true ? null : { status: 423 } },
    '@/lib/server-ssh': { connectToServer: async () => { calls.push('ssh'); return { ssh: {} }; } },
    '@/lib/ssh': { closeSSH: async () => {}, executeCommand: async (_ssh, c) => { calls.push(c); return runner(c); } },
    '@/lib/local-server': { isLocalServer: id => id === 'local', execOnHost: async c => { calls.push(c); return runner(c); }, execLocal: async c => { calls.push(c); return runner(c); } },
    '@/lib/db': { prisma: { deploymentLog: { create: async ({ data }) => { calls.push('write'); return row = { domain: null, commitHash: null, ...data, id: 'deploy-id', createdAt: new Date() }; }, update: async ({ data }) => row = { ...row, ...data } }, app: { create: async () => {} } } },
  };
  const post = body => load('src/app/api/deploy/docker/route.ts', mocks).POST({ json: async () => JSON.parse(JSON.stringify(body)), cookies: { get: () => ({ value: 'signed-fixture' }) } });
  const image = { type: 'image', image: 'nginx', serverId: 'remote', safeModeOff: true };
  allowed = false; assert.equal((await post(image)).status, 403); assert.equal(calls.length, 0);
  allowed = true; signed = false; assert.equal((await post(image)).status, 423); assert.equal(calls.length, 0); signed = true;
  assert.equal((await post({ ...image, image: 'bad;image' })).status, 400); assert.equal(calls.length, 0);
  assert.equal((await post({ ...image, safeModeOff: false })).status, 423); assert.equal(calls.length, 0);
  assert.equal((await post({ ...image, restartPolicy: null })).status, 400); assert.equal(calls.length, 0);
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
    runner = c => { if (c.includes('native-image-create')) throw new Error(c); return output(c); };
    const failure = await post({ ...image, serverId, env: { TOKEN: 'private-secret' } }); assert.equal(failure.body.data.status, 'FAILED'); assert(!JSON.stringify(failure.body).includes('private-secret'));
    runner = output; calls = [];
    const compose = { type: 'compose', serverId, safeModeOff: true, composeRevision: 'b'.repeat(64), projectPath: '/opt/new', composeContent: fixtureCompose };
    assert.equal((await post(compose)).body.data.status, 'RUNNING');
    assert(calls.findIndex(c => c.includes?.('config --format json')) < calls.findIndex(c => c.includes?.('native-compose-create')));
    assert(!JSON.stringify(row).includes(Buffer.from(fixtureCompose).toString('base64')));
    runner = c => { if (c.includes('native-compose-create')) throw new Error(c); return output(c); };
    const failed = await post(compose); assert.equal(failed.body.data.status, 'FAILED'); assert.match(row.logs, /Partial files/); assert(!JSON.stringify(failed.body).includes('private-secret'));
    runner = c => c.includes('test ! -L') ? mark('', 1) : output(c); calls = [];
    assert.equal((await post(compose)).status, 400); assert(!calls.includes('write')); assert(!calls.some(c => c.includes?.('native-compose-create')));
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
    const hook = hooks(), requests = [], pending = [], effects = []; let confirms = true;
    hook.react.useEffect = fn => effects.push(fn);
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    const proxy = new Proxy({}, { get: (_, key) => key });
    const componentMocks = { react: hook.react, 'react/jsx-runtime': runtime, 'lucide-react': proxy,
      '@/components/ui/Button': proxy, '@/components/ui/Input': proxy, '@/components/ui/Badge': proxy, '@/components/ui/FileBrowser': proxy,
      '@/components/deploy/DeployRequirementBanner': proxy, '@/contexts/SafeModeContext': { useSafeMode: () => ({ safeMode: false }) } };
    const fn = load(`src/components/deploy/${component}.tsx`, componentMocks, { window: { confirm: () => confirms }, fetch: async (url, options) => { if (!options?.body) return { ok: true, json: async () => ({ success: true, data: url.includes("settings/general") ? { dockerMemoryLimitMB: 0, dockerRestartPolicy: "unless-stopped" } : [] }) }; requests.push([url, JSON.parse(options.body)]); if (JSON.parse(options.body).mode === 'preview') return { ok: true, json: async () => ({ success: true, data: { revision: 'b'.repeat(64), services: ['web'], risks: { directory: '', recreate: false, builds: [], foreignBinds: [], externalVolumes: [], externalNetworks: [] } } }) }; if (url.endsWith('preflight')) return { ok: true, json: async () => ({ success: true, data: { ready: true, checks: [], nextSteps: [], gitPlan: { commitHash: 'c'.repeat(40), revision: 'b'.repeat(64), services: ['web'], risks: { directory: '', recreate: false, builds: [], foreignBinds: [], externalVolumes: [], externalNetworks: [] } } } }) }; return new Promise(resolve => pending.push(resolve)); } })[component];
    const render = () => nodes(hook.render(fn));
    let tree = render();
    hook.react.useEffect = () => {};
    if (component === "DockerImageDeploy") { for (const effect of effects) effect(); await new Promise(resolve => setImmediate(resolve)); tree = render(); }
    if (component === 'DeployForm') { tree.find(n => n.type === 'select' && n.props['aria-label'] === 'Git operation').props.onChange({ target: { value: 'deploy' } }); tree = render(); tree.find(n => n.type === 'button' && n.props.onClick?.toString().includes('setDeployTarget("remote")')).props.onClick(); tree = render(); tree.find(n => n.type === 'select' && n.props.onChange.toString().includes('setSelectedServerId')).props.onChange({ target: { value: 'remote' } }); tree = render(); }
    for (const node of tree) if (['Input', 'input', 'textarea'].includes(node.type) && node.props.onChange) node.props.onChange({ target: { value: node.props.placeholder?.startsWith('https') ? 'https://github.com/example/repo' : node.type === 'textarea' ? (component === 'DockerComposeDeploy' && node.props.value !== '{}' ? fixtureCompose : node.props.value) : node.props.placeholder?.startsWith('/') ? '/opt/new' : node.props.placeholder === 'nginx:latest' ? 'nginx' : node.props.value } });
    tree = render();
    const deployNode = () => render().find(n => n.type === 'Button' && (n.props.type === 'submit' || text(n).includes('Deploy Image') || text(n).includes('Deploy Compose')));
    const execute = () => component === 'DeployForm' ? render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }) : deployNode().props.onClick();
    assert(deployNode().props.disabled); await execute(); assert.equal(requests.length, 0);
    if (component === 'DockerComposeDeploy') await render().find(n => n.type === 'Button' && text(n).includes('Review Compose preview')).props.onClick();
    const review = () => { for (const n of render()) if (n.type === 'input' && n.props.type === 'checkbox' && n.props.onChange.toString().includes('setReviewed')) n.props.onChange({ target: { checked: true } }); };
    const baseline = requests.length;
    if (component === 'DockerComposeDeploy') review();
    await render().find(n => n.type === 'Button' && text(n).includes('Run pre-flight')).props.onClick(); await new Promise(resolve => setImmediate(resolve)); if (component === 'DeployForm') review(); assert(!deployNode().props.disabled, component);
    const editable = render().find(n => ['Input', 'input', 'textarea'].includes(n.type) && n.props.onChange); editable.props.onChange({ target: { value: editable.props.value } }); assert(deployNode().props.disabled); await execute(); assert.equal(requests.length, baseline + 1);
    if (component === 'DockerComposeDeploy') await render().find(n => n.type === 'Button' && text(n).includes('Review Compose preview')).props.onClick();
    if (component === 'DockerComposeDeploy') review();
    await render().find(n => n.type === 'Button' && text(n).includes('Run pre-flight')).props.onClick(); await new Promise(resolve => setImmediate(resolve)); if (component === 'DeployForm') review(); const before = requests.length;
    confirms = false; await execute(); assert.equal(requests.length, before); confirms = true;
    const flight = execute(); await execute(); assert.equal(requests.length, before + 1, 'single-flight prevents second execution'); assert(render().find(n => n.type === 'fieldset').props.disabled);
    pending.shift()({ ok: true, json: async () => ({ success: false, data: { id: 'real-log', status: 'UNVERIFIED', detectedStack: 'docker' }, error: 'Readiness unverified' }) }); await flight;
    assert(deployNode().props.disabled); assert(text(hook.render(fn)).includes('UNVERIFIED') || /unverified|uncertain/i.test(text(hook.render(fn))), component + ': ' + text(hook.render(fn)));
    assert(render().some(n => n.type === 'a' && n.props.href === '/deploy#deployment-real-log'));
  }
  console.log('PASS all guided forms: gated handler/button, cancel, exact-input invalidation, busy lock, single-flight and actual log/result');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { load, output, mark, hooks, nativeMocks, canonicalCompose, serviceMocks };