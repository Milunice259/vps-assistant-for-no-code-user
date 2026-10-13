const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = {
  health: 'src/components/apps/AppHealthCheck.tsx',
  chart: 'src/components/apps/AppResourceChart.tsx',
  scheduler: 'src/components/dashboard/MonitoringStatus.tsx',
};
function fixture(kind) {
  const slots = [], requests = [], timeouts = [], intervals = [];
  let cursor = 0, effects = [], tree;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const source = fs.readFileSync(path.join(root, files[kind]), 'utf8');
  const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, AbortController, Date, Map, setTimeout: fn => { timeouts.push(fn); return timeouts.length; }, clearTimeout: id => { timeouts[id - 1] = null; },
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval: id => { intervals[id - 1] = null; },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@/lib/i18n') return { useTranslation: () => ({ formatDate: v => v }) };
      if (name === '@/components/ui/Button') return { Button: 'button' };
      if (name === 'lucide-react') return { HeartPulse: 'svg', RefreshCw: 'svg' };
      if (name === 'recharts') return Object.fromEntries(['AreaChart', 'Area', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'ResponsiveContainer'].map(k => [k, k]));
      throw new Error(name);
    },
  });
  const component = exports[{ health: 'AppHealthCheck', chart: 'AppResourceChart', scheduler: 'MonitoringStatus' }[kind]];
  const render = () => { cursor = 0; tree = component({ appId: 'app::A', liveStats: { cpuPercent: 99 } }); const queue = effects; effects = []; queue.forEach(fn => fn()); return tree; };
  const nodes = () => { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit); out.push(n); visit(n.props?.children); } visit(tree); return out; };
  const text = () => { function visit(n) { if (n == null || typeof n === 'boolean') return ''; if (Array.isArray(n)) return n.map(visit).join(' '); if (typeof n === 'object') return visit(n.props?.children); return String(n); } return visit(tree); };
  const button = label => nodes().find(n => n.type === 'button' && (Array.isArray(n.props.children) ? n.props.children.filter(v => typeof v === 'string').join('') : n.props.children).trim() === label);
  const settle = async (request, data, status = 200) => { request.resolve({ ok: status === 200, status, json: async () => ({ success: status === 200, data }) }); await new Promise(resolve => setImmediate(resolve)); render(); };
  return { render, text, nodes, button, requests, settle, intervals, timeouts, unmount: () => slots.forEach(s => s?.cleanup?.()) };
}
const point = (time, cpu = 3, gap) => ({ time, cpu, mem: cpu === null ? null : 42, netIn: cpu === null ? null : 1024, netOut: cpu === null ? null : 2048, ...(gap ? { gap } : {}) });
(async () => {
  const h = fixture('health'); h.render();
  await h.settle(h.requests[0], { status: 'unknown', checkedAt: new Date().toISOString(), containerState: 'running', container: { health: 'none' }, backend: { status: 'verified' }, tls: { tls: 'pending' }, output: 'PRIVATE raw command' });
  assert.match(h.text(), /No health check/); assert.match(h.text(), /HTTP backend.*Verified/); assert.match(h.text(), /TLS certificate.*Pending/); assert.doesNotMatch(h.text(), /PRIVATE/);
  h.button('Check now').props.onClick(); h.render();
  assert.doesNotMatch(h.text(), /No health check/);
  await h.settle(h.requests.at(-1), null, 403); assert.match(h.text(), /Access denied/);
  h.button('Check now').props.onClick(); const lateHealth = h.requests.at(-1); h.unmount();
  await h.settle(lateHealth, { status: 'healthy', checkedAt: new Date().toISOString() }); assert.doesNotMatch(h.text(), /Healthy/);

  const c = fixture('chart'); c.render();
  await c.settle(c.requests[0], { points: [] }); assert.match(c.text(), /No saved readings/); assert.doesNotMatch(c.text(), /99|Collecting data points/);
  c.button('6h').props.onClick(); c.render(); const oldRange = c.requests.at(-1);
  c.button('24h').props.onClick(); c.render(); const newRange = c.requests.at(-1);
  await c.settle(oldRange, { points: [point('2026-01-01T00:00:00Z', 99)] }); assert.doesNotMatch(c.text(), /99/);
  await c.settle(newRange, { intervalMs: 60000, points: [point('2026-01-01T00:00:00Z'), point('2026-01-01T00:04:00Z'), point('2026-01-01T00:05:00Z', null, 'offline')] });
  const chart = c.nodes().find(n => n.type === 'AreaChart');
  assert.equal(chart.props.data.length, 4); assert.equal(chart.props.data[1].cpu, null); assert.equal(chart.props.data[3].cpu, null);
  assert.ok(c.nodes().filter(n => n.type === 'Area').every(n => n.props.connectNulls === false));
  assert.match(c.text(), /cumulative bytes/); assert.match(c.text(), /Collection gap/);
  c.button('Refresh history').props.onClick(); c.render(); await c.settle(c.requests.at(-1), null, 403); assert.match(c.text(), /Access denied/); assert.equal(c.nodes().filter(n => n.type === 'AreaChart').length, 0);
  c.button('Refresh history').props.onClick(); c.render(); const timeout = c.timeouts.findLast(Boolean); timeout(); c.render(); assert.match(c.text(), /timed out/);
  await c.settle(c.requests.at(-1), { points: [point('2026-01-01T00:00:00Z')] }); assert.match(c.text(), /timed out/);
  c.unmount();

  const s = fixture('scheduler'); s.render(); await s.settle(s.requests[0], { enabled: true, workerOnline: false, lastStartedAt: 1234, outcome: 'ok' }); assert.match(s.text(), /Worker offline/); assert.doesNotMatch(s.text(), /healthy/);
  s.button('Refresh status').props.onClick(); s.render(); await s.settle(s.requests.at(-1), { enabled: false }); assert.match(s.text(), /Disabled/);
  s.button('Refresh status').props.onClick(); s.render(); await s.settle(s.requests.at(-1), null, 401); assert.match(s.text(), /Access denied/); assert.doesNotMatch(s.text(), /Last started/);
  s.button('Refresh status').props.onClick(); s.render(); const old = s.requests.at(-1); s.unmount(); await s.settle(old, { enabled: true, running: true }); assert.doesNotMatch(s.text(), /Running/);
  for (const f of [h, c, s]) assert.ok(f.requests.every(r => !r.options.method || r.options.method === 'GET'));
  for (const file of Object.values(files)) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /method:\s*["'](?:POST|PUT|DELETE)/);
  console.log('PASS MON5 UI: independent readiness, read-only durable history, real gaps/cumulative counters, range races, denied clearing, timeout/late reads, scheduler offline/disabled, unmount isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
