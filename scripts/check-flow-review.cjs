// Run: node scripts/check-flow-review.cjs [compose|forms]
// Native Compose config only (no daemon/mutations); UI uses real TSX with mocked network.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, hooks } = require('./check-guided-deploy.cjs');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join(' ');
function compose() {
  const helper = load('src/lib/deploy-preflight.ts');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch'), 'compose-interpolation-'));
  try {
    const content = value => `services:\n  web:\n    image: nginx\n    environment:\n      PROBE: ${JSON.stringify(value)}\n`;
    const native = value => {
      const result = spawnSync('docker', ['compose', '--project-directory', scratch, '-p', 'flow-review-fixture', '-f', '-', 'config', '--format', 'json'], { cwd: scratch, input: content(value), encoding: 'utf8', env: { ...process.env, FLOW_REVIEW_SENTINEL: 'fixture-inherited-value' } });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).services.web.environment.PROBE;
    };
    assert.equal(native('$FLOW_REVIEW_SENTINEL'), 'fixture-inherited-value');
    assert.equal(native('${FLOW_REVIEW_SENTINEL}'), 'fixture-inherited-value');
    assert.equal(native('$$FLOW_REVIEW_SENTINEL'), '$$FLOW_REVIEW_SENTINEL');
    for (const value of ['$FLOW_REVIEW_SENTINEL', '$_NAME', '$lower_case123', '${FLOW_REVIEW_SENTINEL}', '${NAME:-fallback}', '${NAME-fallback}', '${NAME:?required}', '${NAME?required}', '${NAME:+alt}', '${NAME+alt}', '$$${NAME}', '$$$$$NAME']) {
      assert(helper.validateDockerDeploy({ type: 'compose', projectPath: '/opt/fixture-new', composeContent: content(value) }), `must reject interpolation ${value}`);
    }
    for (const value of ['$$FLOW_REVIEW_SENTINEL', '$${NAME}', '$$$$NAME', '$$$${NAME}', 'price $5', 'literal $', '$-']) {
      assert.equal(helper.validateDockerDeploy({ type: 'compose', projectPath: '/opt/fixture-new', composeContent: content(value) }), null, `must preserve literal ${value}`);
    }
    for (const escape of ['\\u0024', '\\x24']) assert(helper.validateDockerDeploy({ type: 'compose', projectPath: '/opt/fixture-new', composeContent: `services: {web: {image: nginx, environment: {PROBE: "${escape}FLOW_REVIEW_SENTINEL"}}}` }), 'parsed YAML dollar must be rejected');
    assert.deepEqual(fs.readdirSync(scratch), [], 'native config must not write target files');
    console.log('PASS native Compose 2.x inherited fixture expands bare/braced variables; validator rejects interpolation and preserves $$ including parsed YAML dollars; scratch unchanged');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
async function forms() {
  for (const component of ['DockerImageDeploy', 'DockerComposeDeploy']) for (const failure of ['network', 'json', 'http', 'shape', 'null', 'false-success']) {
    const hook = hooks(), requests = [], busy = []; let inspectionFails = true, releaseInspection, historyStatus = 'UNVERIFIED';
    const proxy = new Proxy({}, { get: (_, key) => key });
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    const fn = load(`src/components/deploy/${component}.tsx`, { react: hook.react, 'react/jsx-runtime': runtime, 'lucide-react': proxy, '@/components/ui/Button': proxy, '@/components/ui/FileBrowser': proxy, '@/components/deploy/DeployRequirementBanner': proxy, '@/contexts/SafeModeContext': { useSafeMode: () => ({ safeMode: false }) } }, {
      window: { confirm: () => true },
      fetch: async (url, options = {}) => {
        requests.push([url, options]);
        if (url.endsWith('/preflight')) return { ok: true, json: async () => ({ success: true, data: { ready: true, checks: [] } }) };
        if (url === '/api/deploy/docker') {
          if (failure === 'network') throw new Error('response lost');
          if (failure === 'json') return { ok: true, json: async () => { throw new SyntaxError('truncated'); } };
          return { ok: failure !== 'http', json: async () => failure === 'null' ? null : failure === 'false-success' ? { success: true, data: { id: 'bad', status: 'FAILED' } } : failure === 'shape' ? { success: true } : { success: false, error: 'gateway error' } };
        }
        if (inspectionFails) return { ok: false, json: async () => ({ success: false }) };
        if (url.includes('/servers/')) await new Promise(resolve => { releaseInspection = resolve; });
        return { ok: true, json: async () => ({ success: true, data: url === '/api/deploy' ? [{ id: 'other-target', serverId: 'other', status: 'RUNNING' }, { id: 'fixture-log', serverId: 'local', status: historyStatus, repoUrl: component === 'DockerImageDeploy' ? 'docker://nginx' : 'compose:///opt/fixture-new', createdAt: new Date().toISOString() }] : [{ id: 'fixture-container', name: 'partial-container', image: 'nginx', state: 'running' }] }) };
      },
    })[component];
    const render = () => hook.render(() => fn({ onBusyChange: value => busy.push(value) }));
    const findButton = label => nodes(render()).find(n => n.type === 'Button' && text(n).includes(label));
    for (const node of nodes(render())) if (node.props.onChange && ['input', 'textarea'].includes(node.type)) node.props.onChange({ target: { value: node.props.placeholder === 'nginx:latest' ? 'nginx' : node.props.placeholder?.startsWith('/') ? '/opt/fixture-new' : node.props.value } });
    await findButton('Run pre-flight').props.onClick();
    await findButton(component === 'DockerImageDeploy' ? 'Deploy Image' : 'Deploy Compose').props.onClick();
    assert.match(text(render()), /outcome unknown/i, `${component}/${failure} must not claim failure or unlock`);
    assert.match(text(render()), /partial|may remain/i);
    assert(nodes(render()).filter(n => n.type === 'fieldset').every(n => n.props.disabled), 'inputs/target remain locked');
    assert(findButton('Run pre-flight').props.disabled);
    assert(findButton(component === 'DockerImageDeploy' ? 'Deploy Image' : 'Deploy Compose').props.disabled);
    assert.equal(busy.at(-1), true, 'parent mode switch remains locked');
    // Bypass DOM disabled flags too: handlers must remain guarded.
    await findButton('Run pre-flight').props.onClick();
    await findButton(component === 'DockerImageDeploy' ? 'Deploy Image' : 'Deploy Compose').props.onClick();
    assert.equal(requests.filter(([url]) => url === '/api/deploy/docker').length, 1);
    assert.equal(requests.filter(([url]) => url === '/api/deploy/preflight').length, 1);
    await findButton('Check history and target').props.onClick();
    assert(nodes(render()).filter(n => n.type === 'fieldset').every(n => n.props.disabled), 'failed inspection stays locked');
    inspectionFails = false;
    historyStatus = 'BUILDING';
    const buildingCheck = findButton('Check history and target').props.onClick();
    await new Promise(resolve => setImmediate(resolve)); releaseInspection(); await buildingCheck;
    assert(nodes(render()).every(n => n.type !== 'fieldset' || n.props.disabled), 'in-flight history stays locked');
    historyStatus = 'UNVERIFIED';
    const inspection = findButton('Check history and target').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert(nodes(render()).filter(n => n.type === 'fieldset').every(n => n.props.disabled), 'pending inspection stays locked');
    const count = requests.length;
    await findButton('Check history and target').props.onClick(); assert.equal(requests.length, count, 'inspection is single-flight');
    releaseInspection(); await inspection;
    assert(requests.some(([url, options]) => url === '/api/servers/local/docker' && !options.method), 'inspect original target read-only');
    assert(requests.some(([url, options]) => url === '/api/deploy' && !options.method), 'history read-only');
    assert.match(text(render()), /fixture-log/); assert.match(text(render()), /partial-container/);
    assert(!text(render()).includes('other-target'), 'history evidence scoped to original target');
    assert.match(text(render()), /outcome unknown/i, 'inspection does not convert missing response into success');
    assert(!nodes(render()).find(n => n.type === 'fieldset').props.disabled);
    assert(findButton(component === 'DockerImageDeploy' ? 'Deploy Image' : 'Deploy Compose').props.disabled, 'new preflight is still required');
    assert.equal(requests.filter(([url]) => url === '/api/deploy/docker').length, 1, 'never automatically retries');
    assert.equal(busy.at(-1), false);
    console.log(`PASS ${component}/${failure}: unknown outcome, locked inputs/preflight/parent, guarded failed/pending/single-flight GET inspection, target evidence, no automatic retry`);
  }
}
(async () => { if (process.argv[2] !== 'forms') compose(); if (process.argv[2] !== 'compose') await forms(); })().catch(error => { console.error(error); process.exitCode = 1; });
