const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
assert.match(read('src/app/(panel)/dashboard/page.tsx'), /<MonitoringStatus\s*\/>/);
assert.match(read('src/app/(panel)/apps/[id]/page.tsx'), /<AppHealthCheck appId=\{appId\}/);
assert.doesNotMatch(read('src/app/(panel)/apps/[id]/page.tsx'), /InlineHealthCheck/);
assert.match(read('src/app/(panel)/apps/[id]/page.tsx'), /appId = decodeURIComponent\(segment\)/, 'encoded Next route segment must canonicalize once');
assert.match(read('src/app/(panel)/apps/[id]/page.tsx'), /<\/table>[\s\S]*<AppHealthCheck/, 'readiness remains outside clipped metadata table');
let source = read('src/lib/notification-checks.ts');
const parsed = ts.createSourceFile('checks.ts', source, ts.ScriptTarget.Latest, true);
for (const name of ['listServers', 'checkServer']) {
  const node = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(node, name);
  source = source.replace(node.getText(parsed), name === 'listServers' ? 'async function listServers() { return fixtureServers; }' : 'async function checkServer(server: any) { return fixtureCheck(server); }');
}
let active = 0, max = 0, calls = [];
const exports_ = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: exports_, require: () => ({}), fixtureServers: Array.from({ length: 7 }, (_, i) => ({ id: String(i) })),
  fixtureCheck: async s => { active++; max = Math.max(max, active); calls.push(s.id); await new Promise(r => setTimeout(r, 5)); active--; return { status: 'checked', alerts: [] }; },
});
(async () => {
  const result = await exports_.runNotificationChecks();
  assert.equal(max, 2); assert.equal(result.checked, 7); assert.equal(new Set(calls).size, 7);
  console.log('PASS MON5 actual page mounts and real orchestration max-two server pool (observations mocked explicitly)');
})().catch(e => { console.error(e); process.exitCode = 1; });
