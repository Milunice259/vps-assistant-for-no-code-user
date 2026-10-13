const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');

// Run the real hook with a minimal deterministic hook scheduler and deferred reads.
let slots = [], cursor = 0, effects = [], sources = [], timers = [], pending = [];
const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const react = {
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
  useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
  useCallback(fn, deps) { const i = cursor++; if (!depsEqual(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
  useEffect(fn, deps) { const i = cursor++; if (!depsEqual(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
};
class EventSource {
  constructor(url) { this.url = url; this.listeners = {}; sources.push(this); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  close() { this.closed = true; }
  emit(type, value) { this.listeners[type]?.({ data: JSON.stringify(value) }); }
}
const exports_ = {};
vm.runInNewContext(ts.transpileModule(source('src/hooks/useSSE.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: exports_, require: name => { assert.equal(name, 'react'); return react; }, EventSource,
  fetch: url => new Promise(resolve => pending.push({ url, resolve })),
  setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
  setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {},
});
function render(url, options = { fallbackPollMs: 10 }) { cursor = 0; const result = exports_.useSSE(url, options); const queue = effects; effects = []; queue.forEach(fn => fn()); return result; }
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  render('/a/stream');
  sources.at(-1).emit('snapshot', { target: 'a' });
  assert.equal(render('/a/stream').data.target, 'a');
  const a = sources.at(-1);
  assert.equal(render('/b/stream').data, null, 'old target must disappear on first render');
  a.emit('snapshot', { target: 'late-a' });
  a.emit('delta', { target: 'late-a' });
  a.onerror();
  assert.equal(render('/b/stream').data, null, 'closed A events cannot update B');
  for (let i = 0; i < 5; i++) { sources.at(-1).onerror(); if (i < 4) timers.pop()(); }
  assert.equal(pending.at(-1).url, '/b');
  const bPoll = pending.at(-1);
  render('/c/stream');
  sources.at(-1).emit('snapshot', { target: 'c' });
  bPoll.resolve({ ok: true, json: async () => ({ success: true, data: { target: 'late-b-poll' } }) });
  await tick();
  assert.equal(render('/c/stream').data.target, 'c', 'late polling cannot replace current target');
  assert.equal(render('/c/stream', { enabled: false }).data, null);
  render('/api/dashboard/stream', { fallbackPollMs: 10, pollUrl: '/api/dashboard/summary' });
  for (let i = 0; i < 5; i++) { sources.at(-1).onerror(); if (i < 4) timers.pop()(); }
  assert.equal(pending.at(-1).url, '/api/dashboard/summary');
  pending.at(-1).resolve({ ok: false, json: async () => ({ success: false, error: 'Scoped summary unavailable' }) });
  await tick();
  assert.equal(render('/api/dashboard/stream', { fallbackPollMs: 10, pollUrl: '/api/dashboard/summary' }).error, 'Scoped summary unavailable');

  // Keyed boundaries force React to discard all target-owned child state.
  assert.match(source('src/app/(panel)/servers/[id]/page.tsx'), /<ServerDetail key=\{serverId\}/);
  assert.match(source('src/app/(panel)/network/page.tsx'), /<PortTable key=\{selectedServerId\}/);
  assert.match(source('src/components/apps/AppLogViewer.tsx'), /<TargetAppLogViewer key=\{appId\}/);
  assert.match(source('src/app/(panel)/apps/[id]/page.tsx'), /<AppDetail key=\{appId\}/);
  assert.match(source('src/components/apps/AppResourceChart.tsx'), /read !== historyRead.current/);

  // Real JSX rendering: remote-only payloads have no invented local server/metrics.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const payload = { servers: { total: 2, remote: 2, active: 1, inactive: 1 }, apps: { total: 0, running: 0, stopped: 0 }, deployments: { total: 0, running: 0, failed: 0, recent: 0 }, network: null };
  function load(p, mocks) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source(p), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, require: name => mocks[name] ?? require(name) });
    return exports;
  }
  const QuickOverview = load('src/components/dashboard/QuickOverview.tsx', {
    '@/components/dashboard/SummaryCard': { SummaryCard: p => React.createElement('div', null, p.title, ': ', p.value, ' ', p.subtitle) },
  }).QuickOverview;
  const page = load('src/app/(panel)/dashboard/page.tsx', {
    '@/hooks/useSSE': { useSSE: () => ({ data: payload, connected: true, error: null }) },
    '@/components/dashboard/QuickOverview': { QuickOverview },
    '@/components/dashboard/OnboardingWizard': { OnboardingWizard: () => null },
    '@/components/dashboard/RiskOverview': { RiskOverview: () => null },
    '@/components/dashboard/MonitoringStatus': { MonitoringStatus: () => null },
  }).default;
  const html = renderToStaticMarkup(React.createElement(page));
  assert.match(html, /Remote-only overview/);
  assert.match(html, /2 remote · 0 local/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /1 local|Fleet healthy/);
  if (process.env.DATA_UI_HTML) fs.writeFileSync(process.env.DATA_UI_HTML, '<!doctype html><html><body>' + html + '</body></html>');
  payload.servers = { total: 0, remote: 0, active: 0, inactive: 0 };
  assert.match(renderToStaticMarkup(React.createElement(page)), /No servers in scope/);
  console.log('PASS: target reset, late SSE/error/poll isolation, disabled streams, dashboard fallback, keyed server/network/log/app boundaries, history generation, remote-only and empty dashboard rendering');
})().catch(error => { console.error(error); process.exitCode = 1; });
