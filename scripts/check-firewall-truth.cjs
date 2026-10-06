// Offline TRUST-01 regression: real TS routes, mocked SSH/host/DB only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let output, commands = [], audits = [], closed = [], failure;
const ports = [
  { protocol: 'tcp', localAddress: '0.0.0.0', localPort: 6379 },
  { protocol: 'tcp', localAddress: '::', localPort: 6379 },
  { protocol: 'tcp', localAddress: '127.0.0.1', localPort: 3306 },
  { protocol: 'tcp', localAddress: '::1', localPort: 5432 },
  { protocol: 'tcp', localAddress: '*', localPort: 22 },
];
const run = async (command) => { commands.push(command); if (failure) throw failure; return output; };
const mocks = {
  'next/server': { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, body }) } },
  '@/lib/auth': { getSession: async () => ({ sub: 'owner', role: 'OWNER' }) },
  '@/lib/server-access': { canAccessServer: async () => true },
  '@/lib/db': { prisma: { server: { findUnique: async () => ({ port: 2222 }) } } },
  '@/lib/audit': { auditLog: async (entry) => audits.push(JSON.parse(entry.details)), getClientIp: () => 'test' },
  '@/lib/operation-safety': { requireSafeModeOff: (_action, body) => body.safeModeOff === true ? null : { status: 423 } },
  '@/lib/local-server': { isLocalServer: id => id === 'local', execOnHost: run, getLocalNetworkTopology: () => ({ networks: [], hostPorts: ports }) },
  '@/lib/server-ssh': { connectToServer: async () => ({ ssh: 'mock-ssh' }), isDisconnectedError: () => false },
  '@/lib/ssh': { executeCommand: async (_ssh, command) => run(command), closeSSH: async ssh => closed.push(ssh), getRemoteDockerNetworks: async () => ({ networks: [], dockerInstalled: true }), getRemoteHostPorts: async () => ports },
};
function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { Error, module, exports: module.exports, require: name => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
    return mocks[name];
  } }, { filename: relative });
  return module.exports;
}
mocks['@/lib/operation-result'] = load('src/lib/operation-result.ts');
const firewall = load('src/app/api/servers/[id]/network/firewall/route.ts');
const network = load('src/app/api/servers/[id]/network/route.ts');
const body = { mode: 'apply', action: 'block-port', protocol: 'tcp', port: 8080, safeModeOff: true };
const context = id => ({ params: Promise.resolve({ id }) });
const post = (change = {}) => firewall.POST({ json: async () => ({ ...body, ...change }) }, context('remote'));
let passed = 0;
async function check(name, fn) {
  commands = []; audits = []; closed = []; failure = null;
  output = '__UFW_APPLIED__\nStatus: active\n[ 1] 8080/tcp                   DENY IN     Anywhere\n__UFW_RULES__\nufw deny 8080/tcp';
  await fn(); passed++; console.log(`PASS ${name}`);
}
(async () => {
  await check('rule readback never verifies external blocking', async () => {
    const result = await post();
    assert.equal(result.status, 200);
    assert.equal(result.body.data.verified, false, 'applied UFW is not externally verified');
    assert.equal(result.body.data.evidence.commandExecuted, true);
    assert.equal(result.body.data.evidence.ruleObserved, true);
    assert.equal(result.body.data.evidence.ufwActive, true);
    assert.equal(result.body.data.evidence.externalBlockingVerified, false);
    assert.match(result.body.data.message, /rule.*readback confirmed/i);
    assert.match(result.body.data.output, /earlier allow.*Docker.*external.*not verified/i);
    assert.equal(JSON.stringify(audits[0].evidence), JSON.stringify(result.body.data.evidence));
    assert.equal(audits[0].verified, false);
  });
  await check('inactive UFW can store a rule but cannot claim traffic blocked', async () => {
    output = '__UFW_APPLIED__\nStatus: inactive\n__UFW_RULES__\nufw deny 8080/tcp';
    const result = await post();
    assert.equal(result.body.data.evidence.ruleObserved, true);
    assert.equal(result.body.data.evidence.ufwActive, false);
    assert.equal(result.body.data.verified, false);
    assert.match(result.body.data.output, /UFW is inactive/);
  });
  await check('preceding allow and Docker exposure remain unverified', async () => {
    output = '__UFW_APPLIED__\nStatus: active\n[ 1] 8080/tcp                   ALLOW IN    Anywhere\n[ 2] 8080/tcp                   DENY IN     Anywhere\n__UFW_RULES__\nufw allow 8080/tcp\nufw deny 8080/tcp';
    assert.equal((await post()).body.data.verified, false);
  });
  await check('missing command/readback evidence stays unknown', async () => {
    for (const text of ['', 'Status: active\n__UFW_RULES__\nufw deny 8080/tcp', '__UFW_APPLIED__\nStatus: active\n__UFW_RULES__\nufw deny 8081/tcp', '__UFW_APPLIED__\nStatus: active\n__UFW_RULES__\nufw deny 8080/udp']) {
      output = text;
      const result = await post();
      assert.equal(result.body.data.verified, false);
      assert.match(result.body.data.message, /not confirmed/i);
      assert.equal(result.body.data.evidence.ruleObserved, false);
    }
  });
  await check('allow also reports rule evidence, not restored reachability', async () => {
    output = '__UFW_APPLIED__\nStatus: active\n__UFW_RULES__\nufw allow 8080/tcp';
    const result = await post({ action: 'allow-port' });
    assert.equal(result.body.data.evidence.ruleObserved, true);
    assert.equal(result.body.data.verified, false);
    assert.match(result.body.data.message, /allow rule.*readback confirmed/i);
  });
  await check('GET exposes active/inactive/unknown without implying protection', async () => {
    for (const [text, state] of [['Status: active', true], ['Status: inactive', false], ['', null]]) {
      output = text;
      const result = await firewall.GET({}, context('remote'));
      assert.equal(result.body.data.ufwActive, state);
      assert.match(commands.at(-1), /ufw status numbered/);
      assert.doesNotMatch(commands.at(-1), /ufw (deny|allow)/);
    }
  });
  await check('preview is offline and makes no evidence claims', async () => {
    const result = await post({ mode: 'dry-run', safeModeOff: false });
    assert.equal(commands.length, 0);
    assert.equal(result.body.data.verified, false);
    assert.equal(result.body.data.evidence.commandExecuted, false);
    assert.equal(result.body.data.evidence.ruleObserved, false);
    assert.equal(result.body.data.evidence.ufwActive, null);
    assert.match(result.body.data.output, /Would run/);
  });
  await check('executor failures close the opened SSH connection', async () => {
    failure = new Error('mock execution failure');
    assert.equal((await post()).status, 500);
    assert.ok(closed.includes('mock-ssh'));
  });
  await check('command evidence requires successful UFW execution (fake shell function only)', async () => {
    await post();
    const command = commands[0];
    for (const denyExit of [0, 7]) {
      const script = `ufw() { case "$1" in deny) return ${denyExit};; status) printf 'Status: active\\n';; show) printf 'ufw deny 8080/tcp\\n';; esac; }; ${command}`;
      let text = '';
      try { text = execFileSync('sh', ['-c', script], { encoding: 'utf8' }); } catch (error) { text = String(error.stdout || ''); }
      assert.equal(text.includes('__UFW_APPLIED__'), denyExit === 0);
    }
  });
  await check('local and remote findings use potential, never measured reachability', async () => {
    for (const id of ['local', 'remote']) {
      const result = await network.GET({}, context(id));
      assert.equal(result.status, 200);
      assert.equal(result.body.data.findings.length, 2, 'dedupe IPv4/v6; omit loopback');
      for (const finding of result.body.data.findings) {
        assert.match(finding.title, /potentially exposed/i);
        assert.doesNotMatch(finding.title, /publicly reachable/i);
        assert.match(finding.detail, /reachability.*not verified/i);
      }
    }
  });
  await check('network UI presents result caveats rather than hiding them behind raw output', async () => {
    const source = fs.readFileSync(path.join(root, 'src/components/servers/network-map/ServerNetworkMap.tsx'), 'utf8');
    assert.doesNotMatch(source, /setActionMessage\(json\.data\?\.output \|\|/);
    assert.match(source, /External reachability is not verified/);
    assert.doesNotMatch(source, /Ports reachable outside localhost/);
    assert.match(source, /Add deny rule/);
    assert.match(source, /UFW is inactive/);
  });
  console.log(`Firewall truth: ${passed} checks passed (offline mocks only).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
