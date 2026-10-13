const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let slots = [], cursor = 0, effects = [], requests = [], response;
const hooks = {
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v; }]; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
};
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/components/apps/AppList.tsx'), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exports_, fetch: async url => { requests.push(url); return { ok: true, json: async () => response }; },
  require: name => ({ react: hooks, 'next/navigation': { useRouter: () => ({ push() {} }) },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/components/ui/Button': { Button: p => React.createElement('button', p) },
    '@/components/ui/Badge': { Badge: p => React.createElement('span', null, p.children) },
    '@/components/apps/AppLogViewer': { AppLogViewer: () => null },
  }[name] ?? require(name)),
});
function render() { cursor = 0; return exports_.AppList(); }
function nodes(node) { if (!node || typeof node !== 'object') return []; return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]; }
function refresh(tree) { return nodes(tree).find(n => n.props?.title?.includes('Refresh') || (n.type instanceof Function && React.Children.toArray(n.props?.children).includes(' Refresh'))); }
const tick = () => new Promise(resolve => setImmediate(resolve));
const metadata = { serverId: 'remote', enabled: true, reachable: null, source: 'stored', observedAt: null, docker: 'unavailable', systemd: 'unavailable' };
const app = { id: 'remote-app', name: 'Remote app', serverId: 'remote', serverName: 'Remote server', appSource: 'docker', status: 'RUNNING', inventorySource: 'cached' };
(async () => {
  response = { success: true, data: [], inventory: [metadata] };
  render(); effects.shift()(); await tick();
  let tree = render();
  assert.deepEqual(requests, ['/api/apps']);
  assert.match(renderToStaticMarkup(tree), /not checked|not discovered/i);
  await refresh(tree).props.onClick();
  assert.equal(requests.at(-1), '/api/apps?liveRemote=true', 'explicit empty-state Refresh must discover remote apps');
  response = { success: true, data: [app], inventory: [{ ...metadata, source: 'cached', observedAt: '2026-10-09T00:00:00.000Z' }] };
  await refresh(render()).props.onClick();
  tree = render();
  let html = renderToStaticMarkup(tree);
  assert.match(html, /Cached/);
  assert.match(html, /2026-10-09/);
  assert.match(html, /UNKNOWN/);
  assert.doesNotMatch(html, /RUNNING/);
  response = { success: true, data: [{ ...app, inventorySource: 'live' }], inventory: [{ ...metadata, source: 'live', reachable: true, docker: 'available', systemd: 'available' }] };
  await refresh(tree).props.onClick();
  assert.match(renderToStaticMarkup(render()), /RUNNING/);
  response.inventory[0].reachable = false;
  await refresh(render()).props.onClick();
  html = renderToStaticMarkup(render());
  assert.match(html, /Unreachable/);
  assert.doesNotMatch(html, /RUNNING/);
  response.inventory[0].reachable = true; response.inventory[0].enabled = false;
  await refresh(render()).props.onClick();
  assert.match(renderToStaticMarkup(render()), /Disabled/);
  assert.doesNotMatch(renderToStaticMarkup(render()), /RUNNING/);
  assert.equal(effects.length, 0, 'renders must not schedule automatic remote reads');
  console.log('PASS AppList: cached mount, explicit discovery (empty/populated), freshness, unreachable/disabled UNKNOWN, live RUNNING, no automatic remote polling');
})().catch(error => { console.error(error); process.exitCode = 1; });
