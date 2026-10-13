/* eslint-disable @typescript-eslint/no-require-imports */
// Offline: installed transpiler, SSR and real handlers. No host/API/DB mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const sources = {};
for (const name of ['DeployForm', 'DockerImageDeploy', 'DockerComposeDeploy', 'DeployLog', 'DeploymentLifecycle']) sources[name] = fs.readFileSync(path.join(root, `src/components/deploy/${name}.tsx`), 'utf8');
function handler(component, name) {
 const tree = ts.createSourceFile('ui.tsx', sources[component], ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX); let found;
 function visit(node) { if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node.getText(tree); ts.forEachChild(node, visit); } visit(tree);
 assert.ok(found, name); return /^\s*(async )?function/.test(found) ? found : `const ${found};`;
}
function invoke(component, name, context, args = []) {
 return vm.runInNewContext(ts.transpileModule(`${handler(component, name)}; ${name}(...args)`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, { ...context, args, Error });
}
const modules = {};
function load(name) {
 if (modules[name]) return modules[name]; const exports = {}; modules[name] = exports;
 const result = ts.transpileModule(sources[name], { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
 assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `${name} syntax`);
 vm.runInNewContext(result.outputText, { exports, require(id) {
   if (id === 'react') return React; if (id === 'react/jsx-runtime') return require(id);
   if (id.startsWith('./') && sources[id.slice(2)]) return load(id.slice(2));
   if (id.includes('useDeployPreflight')) return { useDeployPreflight: () => ({ checking: false, preflight: null, busyRef: { current: false }, readyRef: { current: false } }) };
   if (id.includes('SafeModeContext')) return { useSafeMode: () => ({ safeMode: true }) };
   if (id.includes('i18n')) return { useTranslation: () => ({ formatDate: x => x }) };
   if (id.includes('useSSE')) return { useSSE: () => ({ data: { deployments: [] } }) };
   return new Proxy({}, { get: (_, key) => props => React.createElement('div', { 'data-component': String(key) }, props.children) });
 } }); return exports;
}
async function main() {
 for (const name of Object.keys(sources)) { const html = renderToStaticMarkup(React.createElement(load(name)[name], name === 'DeploymentLifecycle' ? { id: 'fixture', serverId: 'local', kind: 'image' } : {})); assert.ok(html.length); }
 const optionsContext = { envText: 'MODE=a=b', mountText: 'volume|existing|/data|ro', mountConsent: true, networkText: 'app', healthCommand: 'exit 0', domain: '', proxyId: '', backendPort: '', entrypoint: '', resolver: '', routingNetwork: '' };
 const options = invoke('DockerImageDeploy', 'imageOptions', optionsContext); assert.equal(options.env.MODE, 'a=b'); assert.equal(options.mounts[0].consent, true); assert.equal(options.healthcheck.test[0], 'CMD-SHELL');
 assert.throws(() => invoke('DockerImageDeploy', 'imageOptions', { ...optionsContext, envText: 'MODE=a\nMODE=b' }));
 assert.throws(() => invoke('DockerImageDeploy', 'imageOptions', { ...optionsContext, mountConsent: false }));
 const plan = { revision: 'revision', risks: { builds: ['web'], foreignBinds: ['/data'], externalVolumes: [], externalNetworks: ['net'], recreate: true, directory: '/opt/reviewed' } };
 const input = invoke('DockerComposeDeploy', 'composeInput', { filesText: '{"Dockerfile":"FROM installed"}', serverId: 'local', composeContent: 'services: {}', projectPath: '/opt/reviewed', projectName: '', composeMode: 'update', deploymentId: 'managed', dataCompatibility: 'unchanged', schemaCompatibility: 'operator-confirmed', directoryConsent: true, reviewed: true, layerConsent: true, plan });
 assert.equal(input.composeDeploymentId, 'managed'); assert.deepEqual(Object.keys(input.composeConsent).sort(), ['builds', 'directory', 'externalNetworks', 'externalVolumes', 'foreignBinds', 'recreate', 'writableLayerLoss']);
 const effects = []; const lock = { current: false };
 const c = { reading: { current: false }, lock, disabled: false, safeMode: false, layerConsent: true, preview: { revision: 'bound', confirmation: 'RECREATE exact' }, confirmation: 'RECREATE exact', action: 'recreate', image: '', dataCompatibility: 'unchanged', schemaCompatibility: 'unchanged', endpoint: '/api/deploy/fixture', serverId: 'local', setWorking() {}, setMessage() {}, setPreview() {}, setUnknown: x => effects.push(['unknown', x]), onBusyChange: x => effects.push(['busy', x]), fetch: async () => { throw new Error('lost'); } };
 await invoke('DeploymentLifecycle', 'apply', c); assert.equal(lock.current, true); assert.ok(effects.some(x => x[0] === 'unknown' && x[1]));
 effects.length = 0; await invoke('DeploymentLifecycle', 'apply', c); assert.equal(effects.length, 0);
 for (const missing of ['layerConsent', 'dataCompatibility', 'schemaCompatibility']) { await invoke('DeploymentLifecycle', 'apply', { ...c, lock: { current: false }, [missing]: missing === 'layerConsent' ? false : '', fetch: () => assert.fail('consent bypass') }); }
 let posted;
 await invoke('DeploymentLifecycle', 'apply', { ...c, lock: { current: false }, fetch: async (_url, options) => { posted = JSON.parse(options.body); throw new Error('lost'); } });
 assert.equal(posted.writableLayerLoss, true); assert.equal(posted.action, 'recreate'); assert.equal(posted.dataCompatibility, 'unchanged');
 let planValue; const seq = { current: 0 }; let release;
 const reviewing = invoke('DockerComposeDeploy', 'reviewCompose', { busyRef: { current: false }, previewInFlight: { current: false }, previewSequence: seq, invalidate: () => { seq.current++; }, composeInput: () => ({}), setPreviewing() {}, setPlan: x => { planValue = x; }, setResult() {}, fetch: () => new Promise(resolve => { release = resolve; }) });
 seq.current++; release({ ok: true, json: async () => ({ success: true, data: { revision: 'stale', services: ['web'], risks: plan.risks } }) }); await reviewing; assert.equal(planValue, undefined);
 const gitLock = { current: false }; let gitBody;
 await invoke('DeployForm', 'handleSubmit', { execution: true, operation: 'deploy', deployTarget: 'local', selectedServerId: '', customPath: '/opt/git', reviewed: true, layerConsent: true, composeMode: 'create', deploymentId: '', dataCompatibility: '', schemaCompatibility: '', gitInput: () => ({ compose: { composeConsent: { builds: ['web'] } } }), busyRef: gitLock, readyRef: { current: true }, safeMode: false, loading: false, servers: [], repoUrl: 'https://github.com/example/repo', branch: 'main', domain: '', envVars: '', preflight: { gitPlan: { commitHash: 'pinned', revision: 'bound', risks: plan.risks } }, window: { confirm: () => true }, onBusyChange() {}, invalidate() {}, setLoading() {}, setError() {}, setResult() {}, setOutcomeUnknown() {}, submittedAt: { current: 0 }, fetch: async (_url, options) => { gitBody = JSON.parse(options.body); throw new Error('lost'); } }, [{ preventDefault() {} }]);
 assert.equal(gitBody.action, 'deploy'); assert.equal(gitBody.serverId, 'local'); assert.equal(gitBody.commitHash, 'pinned'); assert.equal(gitLock.current, true);
 const gitInput = invoke('DeployForm', 'gitInput', { deployTarget: 'local', selectedServerId: '', repoUrl: 'https://github.com/example/repo', branch: 'main', customPath: '/opt/git', composeMode: 'update', deploymentId: 'exact-managed', dataCompatibility: 'unchanged', schemaCompatibility: 'operator-confirmed', directoryConsent: true, reviewed: true, layerConsent: true, preflight: { gitPlan: plan } });
 assert.equal(gitInput.composeDeploymentId, 'exact-managed'); assert.equal(gitInput.compose.composeDeploymentId, 'exact-managed'); assert.equal(gitInput.compose.schemaCompatibility, 'operator-confirmed'); assert.equal(gitInput.compose.composeConsent.foreignBinds[0], '/data');
 assert.ok(!sources.DeployForm.includes('Domain (optional)')); assert.ok(!sources.DeployForm.includes('Environment Variables (optional)'));
 for (const component of ['DockerImageDeploy', 'DockerComposeDeploy']) {
   for (const outcome of [{ success: false, data: { id: 'exact', status: 'FAILED' }, pending: true, uncertain: false }, { success: false, data: { id: 'exact', status: 'FAILED' }, pending: true, uncertain: true }, { success: false, data: { id: 'exact', status: 'FAILED' }, pending: false, uncertain: true }, { success: true, data: { id: 'exact', status: 'RUNNING' }, pending: false, uncertain: false, routing: null }]) {
     const busy = { current: false }; let result, unknown; const changes = [];
     const context = { defaultsReady: true, busyRef: busy, readyRef: { current: true }, safeMode: false, deploying: false, serverId: 'local', image: 'nginx:latest', selectedServer: null, ports: '', name: '', cpuLimit: '', memoryLimit: '128', restartPolicy: 'no', imageOptions: () => ({}), setOptionsError() {}, plan, reviewed: true, layerConsent: true, composeMode: 'create', projectPath: '/opt/exact', composeContent: 'services: {}', composeInput: () => ({}), window: { confirm: () => true }, onBusyChange: value => changes.push(value), invalidate() {}, setDeploying() {}, setResult: value => { result = value; }, setInspection() {}, submittedAt: { current: 0 }, setOutcomeUnknown: value => { unknown = value; }, fetch: async () => ({ ok: outcome.success, json: async () => outcome }) };
     await invoke(component, 'handleDeploy', context);
     const locked = outcome.pending !== false || outcome.uncertain; assert.equal(busy.current, locked); assert.equal(unknown, locked); assert.equal(changes.includes(false), !locked);
     if (!locked) assert.match(result.message, /Routing: not verified; TLS: not verified/);
     if (locked) { await invoke(component, 'handleDeploy', { ...context, fetch: () => assert.fail('retry while pending') }); }
   }
   for (const pending of [true, false]) {
     const busy = { current: true }; const changes = []; const now = Date.now();
     const log = { id: 'exact', serverId: 'local', repoUrl: component === 'DockerImageDeploy' ? 'docker://nginx:latest' : 'compose:///opt/exact', createdAt: new Date(now).toISOString(), status: 'FAILED' };
     await invoke(component, 'inspectOutcome', { busyRef: busy, inspectionRef: { current: false }, deploying: false, serverId: 'local', image: 'nginx:latest', projectPath: '/opt/exact', submittedAt: { current: now - 1 }, setInspecting() {}, setInspection() {}, setResult() {}, setOutcomeUnknown() {}, invalidate() {}, onBusyChange: value => changes.push(value), fetch: async url => ({ ok: true, json: async () => ({ success: true, data: url === '/api/deploy' ? [log] : url.includes('/servers/') ? [{ id: 'container-exact', name: 'fixture', image: 'nginx:latest', state: 'running' }] : { serverId: 'local', pending, containerIds: ['container-exact'] } }) }) });
     assert.equal(busy.current, pending); assert.equal(changes.includes(false), !pending);
   }
 }
 console.log('PASS: structured FAILED+pending/uncertain stays locked in both actual Docker handlers; exact-target pending inspection; separate routing/TLS; Git update identity/consent; stale Compose preview invalidation; explicit Local Git execution/pin and lost-response lock; five real components transpile and SSR; image option validation; exact Compose consent payload; recreate consent; lost-response single-flight lock. Offline boundaries only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
