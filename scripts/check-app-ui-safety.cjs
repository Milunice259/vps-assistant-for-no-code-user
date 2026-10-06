/* eslint-disable @typescript-eslint/no-require-imports -- Runnable Node CommonJS self-check. */
// Run: node scripts/check-app-ui-safety.cjs (offline; no API/VPS/DB calls).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = { page: 'src/app/(panel)/apps/[id]/page.tsx', env: 'src/components/apps/AppEnvEditor.tsx' };
const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
function handler(key, name) {
  const tree = ts.createSourceFile(files[key], source[key], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) body = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(body, name);
  return /^(async )?function/.test(body) ? body : `const ${body};`;
}
function fixture(overrides = {}) {
  const requests = [], prompts = [], effects = [];
  const profile = { id: 'profile', name: 'Production', vars: { API_TOKEN: '[REDACTED]', OMITTED_SECRET: '[REDACTED]' }, isActive: false };
  const context = {
    safeMode: false, actionStep: 'idle', actionLoading: null, needsReadback: false, impacts: { restart: 'Restart once' }, setPendingAction() {}, appId: 'test', appName: 'Test app on Test server',
    app: { name: 'Test app', serverName: 'Test server' }, deriveAppName: app => app.name,
    profiles: [profile], editingProfile: profile, activeProfile: profile, editDirty: true,
    newProfileName: '  Production  ', editEntries: [{ key: ' API_TOKEN ', value: '[REDACTED]' }, { key: 'MODE', value: 'test' }],
    confirm: message => { prompts.push(message); return true; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ success: true, data: { ...profile, vars: { API_TOKEN: '[REDACTED]', MODE: 'test' } } }) };
    },
    fetchEnv: async () => { effects.push('refresh'); }, openProfileEditor() {},
    setActionStep() {}, setActionMessage() {}, setActionError() {}, setActionLoading() {},
    setNewProfileName() {}, setShowCreateForm() {}, setEditingProfile() {}, setEditEntries() {}, setEditDirty() {},
    router: { push: route => effects.push(route) }, setTimeout() {}, ...overrides,
  };
  return { requests, prompts, effects, context };
}
async function invoke(key, name, args, f) {
  // Execute actual source handlers with mocked boundaries, including save-and-apply composition.
  const save = key === 'env' && name === 'handleApplyProfile' ? `${handler('env', 'handleSaveProfile')}\n` : '';
  const code = ts.transpileModule(`${save}${handler(key, name)}\n${name}(...args);`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return await vm.runInNewContext(code, { ...f.context, args });
}
const mutations = [
  ['page', 'handleAction', ['restart']], ['page', 'handleDelete', []],
  ['env', 'handleCreateProfile', []], ['env', 'handleSaveProfile', []],
  ['env', 'handleDeleteProfile', [{ id: 'profile', name: 'Production', isActive: false }]],
  ['env', 'handleApplyProfile', ['profile', true]], ['env', 'handleDeactivate', []],
];
// Render the actual TSX with native-key/hook semantics; mock only UI/network boundaries.
function appPageFixture() {
  let routeId = 'A', current, hookIndex, dirty = false;
  const instances = new Map(), requests = [], streams = new Map();
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const slot = init => { const index = hookIndex++; return current.hooks[index] ||= init(); };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const react = {
    useState(initial) {
      const owner = current, state = slot(() => ({ value: initial }));
      return [state.value, value => { if (owner.alive) { state.value = typeof value === 'function' ? value(state.value) : value; dirty = true; } }];
    },
    useRef(value) { return slot(() => ({ current: value })); },
    useCallback(fn, deps) { const memo = slot(() => ({})); if (changed(memo.deps, deps)) Object.assign(memo, { fn, deps }); return memo.fn; },
    useEffect(fn, deps) { const effect = slot(() => ({})); if (changed(effect.deps, deps)) Object.assign(effect, { next: fn, deps }); },
  };
  const exports = {};
  const code = ts.transpileModule(source.page, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    exports, URLSearchParams, navigator: { onLine: true }, confirm: () => true,
    fetch: (url, options = {}) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === 'next/navigation') return { useParams: () => ({ id: routeId }), useRouter: () => ({ push() {} }) };
      if (name === 'next/dynamic') return () => 'Chart';
      if (name === '@/contexts/SafeModeContext') return { useSafeMode: () => ({ safeMode: false }) };
      if (name === '@/hooks/useSSE') return { useSSE: url => { const [data, setData] = react.useState(null); streams.set(url, setData); return { data }; } };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  });
  let tree;
  function render(id = routeId, effects = true) {
    routeId = id;
    do {
      dirty = false;
      const seen = new Set();
      function walk(node, location) {
        if (Array.isArray(node)) return node.map((child, i) => walk(child, `${location}/${i}`));
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') {
          const identity = `${location}:${node.key ?? ''}`;
          let instance = instances.get(identity);
          if (!instance || instance.type !== node.type) {
            instance = { type: node.type, hooks: [], alive: true };
            instances.set(identity, instance);
          }
          seen.add(identity); current = instance; hookIndex = 0;
          return walk(node.type(node.props), `${identity}/child`);
        }
        return { ...node, props: { ...node.props, children: walk(node.props.children, `${location}/children`) } };
      }
      tree = walk(jsx(exports.default, {}), 'root');
      for (const [identity, instance] of instances) if (!seen.has(identity)) {
        instance.alive = false;
        for (const hook of instance.hooks) hook.cleanup?.();
        instances.delete(identity);
      }
      if (effects) for (const instance of instances.values()) for (const hook of instance.hooks) if (hook.next) {
        hook.cleanup?.(); hook.cleanup = hook.next(); delete hook.next;
      }
    } while (dirty);
    return tree;
  }
  function nodes(type) {
    const found = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      if (!type || node.type === type) found.push(node);
      visit(node.props.children);
    }
    visit(tree); return found;
  }
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props.children) : String(node ?? '');
  const button = label => nodes('Button').find(node => text(node).trim() === label);
  const settle = async (request, data, options = {}) => {
    request.resolve({ ok: options.ok ?? true, status: options.status ?? 200, json: async () => ({ success: options.success ?? true, data }) });
    // Drain detail -> state-readback chains without timers or real network.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    render();
  };
  return { render, nodes, text: () => text(tree), button, requests, streams, settle };
}
const identityApp = id => ({ id, name: `App ${id}`, serverName: `Server ${id}`, serverId: `server-${id}`, containerId: `container-${id}`, status: 'RUNNING', image: `image-${id}`, appSource: 'docker' });

test('route switch immediately hides app, confirmation, metrics and live state; late A cannot overwrite B', async () => {
  const f = appPageFixture();
  f.render('A');
  const firstA = f.requests[0];
  f.render('B', false);
  assert.doesNotMatch(f.text(), /App A/);
  f.render();
  await f.settle(f.requests.find(r => r.url.startsWith('/api/apps/B?')), identityApp('B'));
  await f.settle(firstA, { ...identityApp('A'), metrics: [{ id: 'old-A-metric' }] });
  assert.match(f.text(), /App B/);
  assert.doesNotMatch(f.text(), /App A|Server A/);
  f.nodes('Tabs')[0].props.onChange('resources'); f.render();
  assert.equal(f.nodes('Chart')[0].props.metrics.length, 0, 'late A metrics are discarded');

  f.render('A');
  await f.settle(f.requests.at(-1), identityApp('A'));
  const oldStream = f.streams.get('/api/apps/A/stream');
  oldStream({ cpuPercent: 77, memUsageMB: 12, memLimitMB: 100, netIn: 0, netOut: 0 });
  f.render();
  f.button('Restart').props.onClick(); f.render();
  assert.equal(f.nodes('ConfirmDialog')[0].props.open, true);
  f.render('B', false);
  assert.equal(f.nodes('ConfirmDialog').length, 0, 'confirmation is gone before route effects run');
  assert.equal(f.button('Restart'), undefined, 'no previous target can POST while B loads');
  f.render();
  oldStream({ cpuPercent: 99, memUsageMB: 12, memLimitMB: 100, netIn: 0, netOut: 0 });
  await f.settle(f.requests.at(-1), identityApp('B'));
  assert.equal(f.nodes('StatCard').length, 0);
  assert.doesNotMatch(f.text(), /77|99|App A|Server A/);
  assert.equal(f.nodes('ConfirmDialog')[0].props.open, false);
  assert.equal(f.requests.filter(r => r.options.method === 'POST').length, 0);
});

test('actual lifecycle stays busy through readbacks; old confirmation/outcome/readbacks cannot cross route identities', async () => {
  const f = appPageFixture();
  f.render(); await f.settle(f.requests[0], identityApp('A'));
  f.button('Restart').props.onClick(); f.render();
  const operation = f.nodes('ConfirmDialog')[0].props.onConfirm(); f.render();
  const post = f.requests.at(-1);
  assert.equal(post.url, '/api/servers/server-A/docker/action');
  assert.deepEqual(JSON.parse(post.options.body), { action: 'restart', safeModeOff: true, containerId: 'container-A' });
  await f.settle(post, { message: 'A command completed', verified: true, outcome: 'verified', health: 'healthy' });
  assert.equal(f.button('Restart').props.disabled, true);
  const detailA = f.requests.at(-1);
  assert.match(detailA.url, /\/api\/apps\/A\?/);
  await f.settle(detailA, identityApp('A'));
  const stateA = f.requests.at(-1);
  assert.equal(stateA.url, '/api/servers/server-A/docker');
  assert.equal(f.button('Restart').props.disabled, true);
  f.render('B', false);
  assert.doesNotMatch(f.text(), /A command completed|App A/);
  f.render();
  const detailB = f.requests.at(-1);
  await f.settle(detailB, identityApp('B'));
  await f.settle(stateA, [{ id: 'container-A', state: 'exited' }]);
  await operation; f.render();
  assert.match(f.text(), /App B|RUNNING/);
  assert.doesNotMatch(f.text(), /A command completed|STOPPED|Outcome unknown/);
  assert.equal(f.button('Restart').props.disabled, false);

  f.button('Restart').props.onClick(); f.render();
  const unknown = f.nodes('ConfirmDialog')[0].props.onConfirm();
  f.requests.at(-1).reject(new Error('Lost response'));
  await unknown; f.render();
  assert.match(f.text(), /Outcome unknown/);
  assert.equal(f.button('Restart').props.disabled, true);
  const recovery = f.button('Check state (no retry)').props.onClick(); f.render();
  const recoveryB = f.requests.at(-1);
  assert.equal(f.button('Check state (no retry)').props.disabled, true);
  f.render('A');
  await f.settle(f.requests.at(-1), identityApp('A'));
  await f.settle(recoveryB, identityApp('B'));
  // The already-started B recovery may finish, but only its unmounted state owns it.
  assert.equal(f.requests.at(-1).url, '/api/servers/server-B/docker');
  await f.settle(f.requests.at(-1), [{ id: 'container-B', state: 'exited' }]);
  await recovery; f.render();
  assert.match(f.text(), /App A/);
  assert.doesNotMatch(f.text(), /Outcome unknown|Current app state refreshed|App B/);
  assert.equal(f.requests.filter(r => r.options.method === 'POST').length, 2, 'read-only recovery never retries');
});

test('late mutation response or failure cannot publish an A outcome or unlock B', async () => {
  for (const failed of [false, true]) {
    const f = appPageFixture();
    f.render(); await f.settle(f.requests[0], identityApp('A'));
    f.button('Restart').props.onClick(); f.render();
    const oldOperation = f.nodes('ConfirmDialog')[0].props.onConfirm();
    const oldPost = f.requests.at(-1);
    f.render('B'); await f.settle(f.requests.at(-1), identityApp('B'));
    f.button('Restart').props.onClick(); f.render();
    const nextOperation = f.nodes('ConfirmDialog')[0].props.onConfirm(); f.render();
    const nextPost = f.requests.at(-1);
    if (failed) oldPost.reject(new Error('Lost A response'));
    else {
      await f.settle(oldPost, { message: 'Old A outcome', verified: true, outcome: 'verified' });
      await f.settle(f.requests.at(-1), identityApp('A'));
      await f.settle(f.requests.at(-1), [{ id: 'container-A', state: 'exited' }]);
    }
    await oldOperation; f.render();
    assert.match(f.text(), /App B/);
    assert.doesNotMatch(f.text(), /Old A outcome|Outcome unknown|STOPPED/);
    assert.equal(f.button('Restart').props.disabled, true, 'A completion cannot release B single-flight');
    nextPost.reject(new Error('Lost B response')); await nextOperation; f.render();
    assert.match(f.text(), /Outcome unknown/);
    assert.equal(f.button('Restart').props.disabled, true);
  }
});

test('changed components transpile and retain disabled Safe Mode controls', () => {
  for (const [key, file] of Object.entries(files)) {
    const result = ts.transpileModule(source[key], { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } });
    assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  }
  assert.match(source.page, /disabled=\{safeMode \|\| !!actionLoading/);
  assert.match(source.env, /<fieldset disabled=\{safeMode \|\| actionStep === "working"\}/);
  assert.match(source.env, /onClick=\{\(\) => handleSaveProfile\(\)\}/, 'Click event must not become the confirmation-bypass argument');
});
test('Safe Mode and busy guards prevent every mutation and confirmation', async () => {
  for (const [key, name, args] of mutations) {
    for (const guard of [{ safeMode: true }, { actionStep: 'working', actionLoading: 'restart' }]) {
      const f = fixture(guard);
      await invoke(key, name, args, f);
      assert.equal(f.requests.length, 0, name);
      assert.equal(f.prompts.length, 0, name);
    }
  }
});
test('canceling any persisted submit prevents requests', async () => {
  for (const [key, name, args] of mutations) {
    const f = fixture({ confirm: () => false });
    await invoke(key, name, args, f);
    assert.equal(f.requests.length, 0, name);
    assert.equal(f.effects.length, 0, name);
  }
});
test('both DELETE requests acknowledge Safe Mode OFF in the agreed header', async () => {
  for (const [key, name, args] of mutations.filter(([, name]) => name.includes('Delete'))) {
    const f = fixture();
    await invoke(key, name, args, f);
    assert.equal(f.requests.length, 1, name);
    assert.equal(f.requests[0].options.method, 'DELETE');
    assert.equal(f.requests[0].options.headers?.['X-Safe-Mode-Off'], 'true', name);
  }
});
test('Create confirmation identifies app/profile and stored-only impact', async () => {
  const f = fixture();
  await invoke('env', 'handleCreateProfile', [], f);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /Production/);
  assert.match(f.prompts[0], /Test app on Test server/);
  assert.match(f.prompts[0], /saved|stored/i);
  assert.match(f.prompts[0], /running container will not change/i);
  assert.equal(JSON.parse(f.requests[0].options.body).name, 'Production');
});
test('Save confirms replacement/removal of stored secrets without changing running container', async () => {
  const f = fixture();
  assert.equal(await invoke('env', 'handleSaveProfile', [], f), true);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /Production/);
  assert.match(f.prompts[0], /Test app on Test server/);
  assert.match(f.prompts[0], /replace.*saved overrides/i);
  assert.match(f.prompts[0], /omitted keys.*secrets.*removed/i);
  assert.match(f.prompts[0], /running container will not change/i);
  const payload = JSON.parse(f.requests[0].options.body);
  assert.deepEqual(payload, { vars: { API_TOKEN: '[REDACTED]', MODE: 'test' }, safeModeOff: true });
  assert.ok(f.effects.includes('refresh'));
});
test('Save & Apply uses one contextual confirmation before PUT then POST', async () => {
  const f = fixture();
  await invoke('env', 'handleApplyProfile', ['profile', true], f);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /Save and apply.*Production.*Test app on Test server/);
  assert.match(f.prompts[0], /omitted keys.*secrets.*removed/i);
  assert.match(f.prompts[0], /recreates the container/i);
  assert.match(f.prompts[0], /unavailable.*writable layer may be lost/i);
  assert.deepEqual(f.requests.map(r => r.options.method), ['PUT', 'POST']);
  assert.equal(JSON.parse(f.requests[0].options.body).vars.API_TOKEN, '[REDACTED]');
  assert.equal(JSON.parse(f.requests[1].options.body).safeModeOff, true);
});
test('failed or invalid Save never proceeds to Apply', async () => {
  for (const failure of ['http', 'api', 'missing-data', 'network', 'empty-key', 'duplicate-key']) {
    const f = fixture();
    if (failure === 'empty-key') f.context.editEntries = [{ key: ' ', value: 'test' }];
    else if (failure === 'duplicate-key') f.context.editEntries = [{ key: 'KEY', value: 'a' }, { key: ' KEY ', value: 'b' }];
    else f.context.fetch = async (url, options) => {
      f.requests.push({ url, options });
      if (failure === 'network') throw new Error('Offline mock');
      return { ok: failure !== 'http', json: async () => ({ success: failure !== 'api', error: 'Denied' }) };
    };
    await invoke('env', 'handleApplyProfile', ['profile', true], f);
    assert.ok(f.requests.every(r => r.options.method === 'PUT'), failure);
    assert.equal(f.effects.length, 0, failure);
  }
});
test('Apply without dirty edits does not save or warn about nonexistent changes', async () => {
  for (const args of [['profile', false], ['profile', true]]) {
    const f = fixture({ editDirty: false });
    await invoke('env', 'handleApplyProfile', args, f);
    assert.equal(f.prompts.length, 1);
    assert.doesNotMatch(f.prompts[0], /Save and apply|omitted keys/i);
    assert.deepEqual(f.requests.map(r => r.options.method), ['POST']);
  }
});
