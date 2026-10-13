// Run: node scripts/check-conf-i18n.cjs (no network or app DB).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/lib/i18n.tsx'), 'utf8');
const dictionaries = Object.fromEntries(['en', 'vi'].map(lang => [lang, require(path.join(root, `src/locales/${lang}.json`))]));
assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.vi).sort());
function fixture(saved = {}, blocked = false, denyWrite = () => blocked) {
  const states = [], effects = [], stored = { ...saved };
  let cursor = 0, current, reads = 0;
  const context = {
    exports: {}, Intl, Date, navigator: { language: 'en-US' }, document: { documentElement: {} },
    localStorage: { getItem: key => { reads++; if (blocked) throw Error('blocked'); return stored[key] ?? null; }, setItem: (key, value) => { if (denyWrite(key)) throw Error('blocked'); stored[key] = value; } },
    require: name => {
      if (name.endsWith('en.json')) return dictionaries.en;
      if (name.endsWith('vi.json')) return dictionaries.vi;
      if (name === 'react/jsx-runtime') return { jsx: (_, props) => { current = props.value; return props.children; } };
      if (name === 'react') return {
        createContext: value => ({ Provider: {}, value }), useContext: () => current,
        useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
        useCallback: callback => callback, useEffect: effect => { effects.push(effect); },
      };
      throw Error(name);
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, context);
  const render = () => { cursor = 0; effects.length = 0; context.exports.I18nProvider({ children: null }); return current; };
  render();
  assert.equal(reads, 0, 'no browser storage reads during SSR/first client render');
  assert.equal(current.locale, 'en'); assert.equal(current.timeZone, 'UTC'); assert.equal(current.preferencesReady, false);
  for (const effect of [...effects]) effect();
  render();
  return { api: context.exports, render, stored, value: () => current };
}
const f = fixture({ 'vps-locale': 'vi', 'vps-timezone': 'Asia/Ho_Chi_Minh' });
assert.equal(f.value().locale, 'vi'); assert.equal(f.value().timeZone, 'Asia/Ho_Chi_Minh'); assert.equal(f.value().preferencesReady, true);
assert.equal(f.value().t('nav.dashboard'), 'Bảng điều khiển');
f.value().setLocale('en'); f.render(); assert.equal(f.stored['vps-locale'], 'en'); assert.equal(f.value().t('nav.dashboard'), 'Dashboard');
f.value().setLocale('invalid'); f.render(); assert.equal(f.value().locale, 'en');
f.value().setTimeZone('Mars/Olympus'); f.render(); assert.equal(f.value().timeZone, 'Asia/Ho_Chi_Minh');
f.value().setTimeZone('America/New_York'); f.render(); assert.equal(f.stored['vps-timezone'], 'America/New_York');
assert.equal(fixture(f.stored).value().timeZone, 'America/New_York', 'reload restores');
const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
assert.equal(f.api.formatDateTime('2026-01-01T00:00:00Z', 'en', 'UTC', options), '00:00');
assert.equal(f.api.formatDateTime('2026-01-01T00:00:00Z', 'en', 'Asia/Ho_Chi_Minh', options), '07:00');
assert.equal(f.api.formatDateTime('2026-01-01T00:00:00Z', 'en', 'America/New_York', options), '19:00');
assert.equal(f.api.formatDateTime('2026-07-01T00:00:00Z', 'en', 'America/New_York', options), '20:00', 'DST applies');
assert.equal(f.api.formatDateTime('invalid', 'en', 'UTC'), '—');
for (const value of [null, '', 'Mars/Olympus', 'x'.repeat(101)]) assert.equal(f.api.isTimeZone(value), false);
const invalid = fixture({ 'vps-locale': 'invalid', 'vps-timezone': 'invalid' });
assert.equal(invalid.value().locale, 'en'); assert.equal(invalid.api.isTimeZone(invalid.value().timeZone), true);
const denied = fixture({}, true); assert.equal(denied.value().preferenceError, true);
denied.value().setLocale('vi'); denied.value().setTimeZone('UTC'); denied.render(); assert.equal(denied.value().locale, 'vi'); assert.equal(denied.value().preferenceError, true);
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
for (const file of files(path.join(root, 'src')).filter(file => file.endsWith('.tsx'))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.toLocale(?:String|TimeString|DateString)\(/, `timestamp bypass: ${file}`);
const chart = fs.readFileSync(path.join(root, 'src/components/apps/AppResourceChart.tsx'), 'utf8');
assert.match(chart, /const \{ formatDate \} = useTranslation\(\)/, 'chart subscribes to viewer timezone');
assert.match(chart, /tickFormatter=\{v => formatDate\(new Date\(v\)\.toISOString\(\)/, 'numeric history axis formats at render time');
assert.match(chart, /labelFormatter=\{v => formatDate\(new Date\(Number\(v\)\)\.toISOString\(\)/, 'history tooltip formats at render time');
assert.match(chart, /formatDate\(latest\.time/, 'last saved reading follows viewer timezone');
assert.doesNotMatch(chart, /time:\s*formatDate\(/, 'persisted history does not cache timezone-specific labels');
const profile = fs.readFileSync(path.join(root, 'src/app/(panel)/profile/page.tsx'), 'utf8');
assert.match(profile, /value=\{locale\}[\s\S]*setLocale\(e\.target\.value/, 'real profile language control uses provider');
assert.match(profile, /value=\{timeZone\}[\s\S]*setTimeZone\(e\.target\.value/, 'real profile timezone control uses provider');
assert.match(profile, /preferenceError[\s\S]*role="alert"/, 'language/timezone persistence failure is visible');
assert.match(fs.readFileSync(path.join(root, 'src/app/(panel)/layout.tsx'), 'utf8'), /<I18nProvider>[\s\S]*<PanelContent>/, 'provider wraps actual panel consumers');
for (const consumer of ['src/components/apps/AppHealthCheck.tsx', 'src/components/servers/ServerAuditLog.tsx', 'src/components/deploy/DeployLog.tsx', 'src/app/(panel)/audit/page.tsx', 'src/app/(panel)/backup/page.tsx']) {
  const text = fs.readFileSync(path.join(root, consumer), 'utf8');
  assert.match(text, /const \{ formatDate(?:, timeZone)? \} = useTranslation\(\)/, `provider connection: ${consumer}`);
  assert.match(text, /\{formatDate\(/, `rendered timestamp: ${consumer}`);
}
{ // Mixed-write regression is part of the normal gate too.
  const partial = fixture({ 'vps-locale': 'vi', 'vps-timezone': 'America/New_York' }, false, key => key === 'vps-locale');
  partial.value().setLocale('en'); partial.render();
  assert.equal(partial.value().preferenceError, true, 'failed locale persistence is visible');
  partial.value().setTimeZone('UTC'); partial.render();
  assert.equal(partial.stored['vps-locale'], 'vi', 'failed language write remains unsaved');
  assert.equal(partial.value().preferenceError, true, 'another preference save must not hide an unsaved language change');
}
const calendarCases = [
  ['2026-01-01T00:00:00Z', 'America/New_York', '2025-12-31'],
  ['2026-01-01T00:00:00Z', 'UTC', '2026-01-01'],
  ['2026-03-08T04:59:59.999Z', 'America/New_York', '2026-03-07'],
  ['2026-03-09T03:59:59.999Z', 'America/New_York', '2026-03-08'],
  ['2026-11-02T04:59:59.999Z', 'America/New_York', '2026-11-01'],
  ['2026-01-01T12:00:00Z', 'Pacific/Kiritimati', '2026-01-02'],
  ['invalid', 'UTC', ''],
];
for (const [instant, zone, day] of calendarCases) assert.equal(f.api.calendarDate(instant, zone), day);
const audit = fs.readFileSync(path.join(root, 'src/app/(panel)/audit/page.tsx'), 'utf8');
assert.match(audit, /calendarDate\(e.createdAt, timeZone\)/);
assert.doesNotMatch(audit, /new Date\(date(?:From|To)/);
let denyLocale = true, denyZone = true;
const recovery = fixture({}, false, key => key === 'vps-locale' ? denyLocale : denyZone);
recovery.value().setLocale('vi'); recovery.value().setTimeZone('UTC'); recovery.render();
denyLocale = false; recovery.value().setLocale('vi'); recovery.render();
assert.equal(recovery.value().preferenceError, true, 'locale success must not mask unsaved timezone');
denyZone = false; recovery.value().setTimeZone('UTC'); recovery.render();
assert.equal(recovery.value().preferenceError, false, 'warning clears only after both keys save');
console.log('CONF-02 preference-unit PASS: mixed-write persistence/readback/retry, hydration, EN/VI browser-local reload, storage denial, UTC/IANA/DST formatter/calendar-day keys and named consumer wiring. Limited translation; no authenticated or whole-phase acceptance claim.');
