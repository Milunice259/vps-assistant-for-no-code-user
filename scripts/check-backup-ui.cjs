// Run: node scripts/check-backup-ui.cjs — actual React hooks, offline DOM/network fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');

// ponytail: minimal host DOM for hook/handler checks, not layout or browser accessibility QA.
class Element {
  constructor(name, document, text = null) {
    this.nodeType = text === null ? 1 : 3;
    this.nodeName = this.tagName = name.toUpperCase();
    this.ownerDocument = document;
    this.childNodes = [];
    this.style = {};
    this.disabled = false;
    this.value = '';
    this.attributes = {};
    this.text = text || '';
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
  }
  appendChild(node) { node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node; }
  insertBefore(node, before) { node.parentNode?.removeChild(node); this.childNodes.splice(this.childNodes.indexOf(before), 0, node); node.parentNode = this; return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'disabled') this.disabled = true; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'disabled') this.disabled = false; }
  addEventListener() {}
  removeEventListener() {}
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll() { return nodes(this).filter(node => ['BUTTON', 'INPUT'].includes(node.nodeName) && !node.disabled); }
  get textContent() { return this.text + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.childNodes = []; }
}
const document = {
  nodeType: 9, addEventListener() {}, removeEventListener() {},
  createElement: name => new Element(name, document),
  createElementNS: (_, name) => new Element(name, document),
  createTextNode: text => new Element('#text', document, text),
};
document.documentElement = document.createElement('html');
document.body = document.createElement('body');
global.document = document;
global.window = { document, addEventListener() {}, removeEventListener() {}, HTMLElement: Element, HTMLIFrameElement: class {} };
document.defaultView = window;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const { act } = React;
let safeMode = false;
function Button({ loading, variant, size, children, ...props }) { return React.createElement('button', { ...props, disabled: props.disabled || loading }, children); }
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => name in mocks ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const { ConfirmDialog } = load('../src/components/ui/ConfirmDialog.tsx', { '@/components/ui/Button': { Button } });
const Page = load('../src/app/(panel)/backup/page.tsx', {
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/components/ui/Button': { Button },
  '@/components/ui/Badge': { Badge: ({ children }) => React.createElement('span', null, children) },
  '@/components/ui/ConfirmDialog': { ConfirmDialog },
  '@/components/ui/PermissionGate': { PermissionGate: ({ children }) => children },
  '@/contexts/SafeModeContext': { useSafeMode: () => ({ safeMode }) },
}).default;
function nodes(node) { return [node, ...node.childNodes.flatMap(nodes)]; }
function props(node) { return node[Object.keys(node).find(key => key.startsWith('__reactProps$'))] || {}; }
function response(data, status = 200) { return { ok: status >= 200 && status < 300, json: async () => data }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const old = { name: 'old.db', size: 100, created: '2026-01-01T00:00:00Z' };
const other = { ...old, name: 'other.db' };
const created = { ...old, name: 'created.db' };
async function mount(initial = [old]) {
  const queue = [response({ success: true, data: initial })], calls = [];
  global.fetch = (url, options = {}) => {
    calls.push({ url, ...options });
    assert.ok(queue.length, `unexpected ${options.method || 'GET'} ${url}`);
    const value = queue.shift();
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Page)));
  return { queue, calls, container, root,
    button(label) { const node = nodes(container).find(node => node.nodeName === 'BUTTON' && (props(node)['aria-label'] === label || node.textContent.trim() === label)); assert.ok(node, `missing button ${label}`); return node; },
    green() { return nodes(container).some(node => props(node).className?.includes('bg-green-500/10')); },
    rows() { return nodes(container).filter(node => node.nodeName === 'TD' && props(node).className?.includes('font-mono')).map(node => node.textContent); },
    async close() { await act(async () => root.unmount()); },
  };
}
async function click(node) { assert.equal(!!node.disabled, false, 'control must be enabled'); await act(async () => { props(node).onClick(); }); }
async function startDelete(ui) {
  await click(ui.button('Delete old.db'));
  assert.match(ui.container.textContent, /live panel database or any VPS\/app files/);
  assert.equal(ui.button('Delete').disabled, true);
  const input = nodes(ui.container).find(node => node.nodeName === 'INPUT');
  for (const value of ['', 'delete', ' DELETE ', 'wrong']) {
    await act(async () => props(input).onChange({ target: { value } }));
    assert.equal(ui.button('Delete').disabled, true);
    await act(async () => props(ui.button('Delete')).onClick());
    assert.equal(ui.calls.filter(call => call.method === 'DELETE').length, 0);
  }
  await act(async () => props(input).onChange({ target: { value: 'DELETE' } }));
  assert.equal(ui.button('Delete').disabled, false);
  await click(ui.button('Delete'));
}
(async () => {
  for (const operation of ['create', 'delete']) {
    for (const readback of ['network', 'http', 'invalid', 'mismatch', 'matched']) {
      const ui = await mount();
      try {
        const mutationGate = deferred(), gate = deferred();
        ui.queue.push(mutationGate.promise, gate.promise);
        if (operation === 'create') await click(ui.button('Create Backup'));
        else await startDelete(ui);
        assert.equal(ui.green(), false, `${operation}: no green before GET settles`);
        assert.equal(ui.button('Create Backup').disabled, true);
        const mutation = ui.calls.filter(call => call.method);
        assert.equal(mutation.length, 1);
        if (operation === 'delete') {
          assert.equal(mutation[0].url, '/api/backup?name=old.db');
          assert.equal(mutation[0].headers['X-Safe-Mode-Off'], 'true');
        } else assert.equal(mutation[0].body, JSON.stringify({ action: 'create' }));
        // Invoke the stale enabled handler too: the ref must prevent double-flight.
        await act(async () => { props(ui.button('Create Backup')).onClick(); });
        if (operation === 'delete') await act(async () => { props(ui.button('Delete')).onClick(); });
        assert.equal(ui.calls.filter(call => call.method).length, 1, 'single-flight during mutation');
        await act(async () => {
          mutationGate.resolve(response({ success: true, data: created }));
          await new Promise(resolve => setImmediate(resolve));
        });
        assert.equal(ui.calls.length, 3, 'initial GET, mutation, verification GET');
        assert.equal(ui.green(), false, 'successful mutation must not turn green before GET');
        await act(async () => { props(ui.button('Create Backup')).onClick(); });
        if (operation === 'delete') await act(async () => { props(ui.button('Delete')).onClick(); });
        assert.equal(ui.calls.filter(call => call.method).length, 1, 'single-flight through readback');
        await act(async () => {
          if (readback === 'network') gate.reject(new Error('GET failed'));
          else if (readback === 'http') gate.resolve(response({ success: true, data: [old] }, 503));
          else if (readback === 'invalid') gate.resolve(response({ success: true, data: null }));
          else gate.resolve(response({ success: true, data: operation === 'create'
            ? readback === 'matched' ? [created, other] : [other]
            : readback === 'matched' ? [other] : [old, other] }));
          await new Promise(resolve => setImmediate(resolve));
        });
        assert.equal(ui.green(), readback === 'matched', `${operation} ${readback}: success must match GET`);
        if (['network', 'http', 'invalid'].includes(readback)) {
          assert.deepEqual(ui.rows(), [], 'failed GET must erase stale recovery entries');
          assert.match(ui.container.textContent, /unavailable; refresh to verify/);
        } else assert.deepEqual(ui.rows(), operation === 'create'
          ? readback === 'matched' ? ['created.db', 'other.db'] : ['other.db']
          : readback === 'matched' ? ['other.db'] : ['old.db', 'other.db'], 'render exact readback, never mutation assumptions');
        assert.equal(ui.button('Create Backup').disabled, false);
        if (readback === 'mismatch') assert.match(ui.container.textContent, /readback\. Refresh before retrying/);
      } finally { await ui.close(); }
    }
    console.log(`PASS: ${operation} waits for GET; failed/invalid/mismatched readback has no green or stale list; single-flight until verified`);
  }
  safeMode = true;
  const ui = await mount();
  try {
    assert.equal(ui.button('Delete old.db').disabled, true);
    await act(async () => props(ui.button('Delete old.db')).onClick());
    assert.equal(nodes(ui.container).some(node => props(node).role === 'dialog'), false);
    assert.equal(ui.calls.filter(call => call.method === 'DELETE').length, 0);
    assert.equal(ui.button('Restore').disabled, true);
  } finally { await ui.close(); }
  console.log('PASS: actual ConfirmDialog requires exact DELETE, double-confirm is inert, Safe Mode locks deletion and live Restore remains disabled');
  console.log('Backup UI regression checks passed using real React createRoot/useState/useEffect/useRef, transpiled page/dialog and offline fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
