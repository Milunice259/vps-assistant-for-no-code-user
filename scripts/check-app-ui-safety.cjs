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
  return body.startsWith('async function') ? body : `const ${body};`;
}
function fixture(overrides = {}) {
  const requests = [], prompts = [], effects = [];
  const profile = { id: 'profile', name: 'Production', vars: { API_TOKEN: '[REDACTED]', OMITTED_SECRET: '[REDACTED]' }, isActive: false };
  const context = {
    safeMode: false, actionStep: 'idle', actionLoading: null, appId: 'test', appName: 'Test app on Test server',
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
