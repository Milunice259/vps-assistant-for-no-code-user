// Run: node scripts/check-onboarding-ux.cjs — isolated React hooks, no live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function fixture(role, replies = {}, actor = 'fixture-user') {
  let states = [], index = 0, effects = [], deps = [], calls = [], dismissed = {};
  const auth = { user: { id: actor, role }, loading: false };
  const react = { ...React,
    useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
    useEffect(effect, dependencies) { const slot = index++; if (!deps[slot] || dependencies.some((x, i) => x !== deps[slot][i])) { deps[slot] = dependencies; effects.push(effect); } },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/dashboard/OnboardingWizard.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const rank = { VIEWER: 0, MANAGER: 1, OPERATOR: 1, ADMIN: 2, OWNER: 3 };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return { default: props => React.createElement('a', { href: props.href }, props.children), __esModule: true };
    if (name === '@/hooks/useAuth') return { useAuth: () => auth };
    if (name === '@/lib/permissions') return { can: (value, minimum) => rank[value] >= rank[minimum] };
    return require(name);
  }, localStorage: { getItem: key => dismissed[key], setItem: (key, value) => { dismissed[key] = value; } }, fetch: async url => {
    calls.push(url);
    if (replies[url] instanceof Error) throw replies[url];
    return { ok: true, json: async () => ({ success: true, data: replies[url] || [] }) };
  } }, { filename: 'OnboardingWizard.tsx' });
  function render() { index = 0; const tree = module.exports.OnboardingWizard(); return { tree, html: renderToStaticMarkup(tree) }; }
  async function settled() { render(); const pending = effects; effects = []; for (const fn of pending) fn(); await new Promise(resolve => setImmediate(resolve)); return render(); }
  return { settled, render, calls, states, auth, dismissed };
}
(async () => {
  for (const role of ['VIEWER', 'MANAGER', 'OPERATOR']) {
    const f = fixture(role); const result = await f.settled();
    assert.equal(f.calls.length, 0, `${role} must not request setup configuration`);
    assert.equal(result.html.includes('Prepare a deployment'), role !== 'VIEWER');
    assert.equal(result.html.includes('Open settings'), false);
  }
  const f = fixture('ADMIN', { '/api/servers': [{ id: 'local', isActive: true }], '/api/notifications': [{ enabled: true, alertRules: [{ enabled: true }] }] });
  const result = await f.settled();
  assert.deepEqual(f.calls, ['/api/servers', '/api/notifications']);
  assert.equal(f.states[1].remote, false); assert.equal(f.states[1].notifications, true);
  assert.match(result.html, /Optional setup/); assert.match(result.html, /Optional for local-only use/);
  assert.doesNotMatch(result.html, /complete|progress|Run safe deploy check/);
  assert.equal(Object.keys(f.dismissed).length, 0, 'completion must not permanently dismiss for the actor');
  const failed = await fixture('OWNER', { '/api/servers': new Error('offline') }).settled();
  assert.match(failed.html, /Could not check configuration/);
  const viewer = fixture('VIEWER'); viewer.auth.loading = true;
  assert.equal((await viewer.settled()).html, ''); assert.equal(viewer.calls.length, 0);
  const source = fs.readFileSync(path.join(root, 'src/components/dashboard/OnboardingWizard.tsx'), 'utf8');
  assert.match(source, /dismissed-v3:\$\{actor\}/); assert.match(source, /if \(cancelled\) return/);
  console.log('PASS onboarding: role-filtered API access, actual enabled channel/rule DTO, optional remote setup, unavailable vs incomplete, no fake deploy achievement, actor-bound dismissal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
