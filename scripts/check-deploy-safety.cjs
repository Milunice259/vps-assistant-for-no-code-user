// Run: node scripts/check-deploy-safety.cjs — no DB, SSH or host execution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const deployDir = path.join(root, 'src/app/api/deploy');
let session, allowed, calls, rows, localAllowed;
const reply = (body, options = {}) => ({ status: options.status || 200, body, headers: new Headers(options.headers) });
const touched = (name, result) => (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
const mocks = {
  'next/server': { NextResponse: { json: reply } },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/permissions': { can: (role, minimum) => (minimum === 'ADMIN' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']).includes(role) },
  '@/lib/server-access': {
    canAccessServer: touched('access', (_user, _role, serverId) => serverId === 'local' && localAllowed !== undefined ? localAllowed : allowed),
    scopedServerWhere: async () => ({ id: { in: allowed ? ['remote-a'] : [] } }),
  },
  '@/lib/db': { prisma: {
    server: { findUnique: touched('server', () => ({ id: 'remote-a', name: 'Remote A', host: 'example.test' })) },
    deploymentLog: {
      findMany: touched('logs', ({ where }) => rows.filter(row => !where || where.OR.some(term => term.serverId === null ? row.serverId === null : typeof term.serverId === 'string' ? row.serverId === term.serverId : term.serverId.in.includes(row.serverId)))),
      findUnique: touched('lookup', () => rows[0]),
      create: touched('write', ({ data }) => ({ ...data, id: 'new', createdAt: new Date(), logs: '', commitHash: null, customPath: null })),
      update: touched('write', ({ data }) => ({ ...data, id: 'new', createdAt: new Date() })),
    },
    app: { create: touched('write') }, auditLog: { create: async () => {} },
  } },
  '@/lib/operation-safety': { requireSafeModeOff: (action, body) => { calls.push(['safety', action]); return body.safeModeOff === true ? null : reply({ success: false }, { status: 423 }); } },
  '@/lib/deployer': { prepareDeployment: touched('analyze', () => ({ projectDir: '/mock', detectedStack: 'node', port: 3000 })), cleanupDeployDir: touched('cleanup'), pruneOldDeployments: touched('prune') },
  '@/lib/crypto': { encrypt: x => x, decrypt: x => x },
  '@/lib/server-ssh': { connectToServer: touched('ssh', () => ({ ssh: {}, server: { name: 'Remote A' } })), isDisconnectedError: () => false },
  '@/lib/ssh': { closeSSH: async () => {}, executeCommand: touched('command', async () => 'ok'), remoteDeployViaSSH: touched('execute', () => ({ success: true, logs: '' })) },
  '@/lib/local-server': { isLocalServer: id => !id || id === 'local', execLocal: touched('command', () => 'missing') },
  child_process: { execFileSync: touched('command', () => 'ok') },
  '@/lib/validation': loadSource('src/lib/validation.ts'),
  '@/lib/sanitize': { sanitizeLogs: x => x },
  '@/lib/audit': { auditLog: async () => {}, getClientIp: () => 'mock' },
  '@/lib/safe-error': { safeErrorMessage: () => 'error' },
  '@/lib/sse-stream': { createSSEResponse: fetcher => ({ fetcher, headers: new Headers() }) },
};
function loadSource(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require, Buffer, console }, { filename: file });
  return module.exports;
}
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(deployDir, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : name === '@/app/api/deploy/route' ? load('route.ts') : require(name), Headers, Buffer, console, Error }, { filename: file });
  return module.exports;
}
const request = body => ({ json: async () => body });
function reset() { session = { sub: 'alice', username: 'alice', role: 'MANAGER' }; allowed = false; localAllowed = undefined; calls = []; rows = []; }
function untouched() { assert.deepEqual(calls.filter(([name]) => !['access', 'safety'].includes(name)), [], 'denial must precede DB target lookup, command, SSH, writes and pruning'); }
async function securityRegressions() {
  const failures = [];
  async function check(name, test) {
    try { await test(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
  }
  const docker = () => load('docker/route.ts');
  const validImage = { serverId: 'remote-a', type: 'image', image: 'nginx:latest', safeModeOff: true };
  await check('malformed image payloads rejected before connection/execution', async () => {
    for (const invalid of [null, [], 'image', { image: {} }, { name: {} }, { name: 'bad name' }, { ports: {} }, { ports: [42] }, { ports: ['-v /:/host'] }, { ports: ['99999:80'] }, { env: [] }, { env: 'X=y' }, { env: { X: {} } }, { cpuLimit: true }, { memoryLimit: [128] }, { restartPolicy: {} }, { env: null }, { name: null }, { ports: null }, { cpuLimit: null }, { memoryLimit: null }, { serverId: null }]) {
      reset(); allowed = true;
      const body = invalid && typeof invalid === 'object' && !Array.isArray(invalid) ? { ...validImage, ...invalid } : invalid;
      assert.equal((await docker().POST(request(body))).status, 400, JSON.stringify(invalid)); untouched();
    }
    reset(); allowed = true;
    assert.equal((await docker().POST({ json: async () => { throw new SyntaxError('invalid JSON'); } })).status, 400); untouched();
  });
  await check('Compose bind root/traversal and malformed YAML rejected before SSH/run', async () => {
    const yaml = require('js-yaml');
    const validator = mocks['@/lib/validation'].validateComposeObject;
    for (const source of ['/', '//', '///', '/./', '//././', '/opt/../', { path: '/' }, 42, null, '']) {
      for (const vol of [typeof source === 'string' ? `${source}:/host` : source, { type: 'bind', source, target: '/host' }]) {
        reset(); allowed = true;
        const doc = { services: { app: { image: 'nginx', volumes: [vol] } } };
        assert.equal(validator(yaml.load(yaml.dump(doc))).valid, false, JSON.stringify(vol));
        const res = await docker().POST(request({ serverId: 'remote-a', type: 'compose', projectPath: '/opt/app', composeContent: yaml.dump(doc), safeModeOff: true }));
        assert.equal(res.status, 400); untouched();
      }
    }
    for (const doc of [{ services: [] }, { services: {} }, { services: { app: [] } }, { services: { app: { ports: {} } } }, { services: { app: { volumes: {} } } }, { services: { app: { image: {} } } }, { services: { app: { ports: [{}] } } }]) {
      reset(); allowed = true;
      assert.equal(validator(yaml.load(yaml.dump(doc))).valid, false, JSON.stringify(doc));
      assert.equal((await docker().POST(request({ serverId: 'remote-a', type: 'compose', projectPath: '/opt/app', composeContent: yaml.dump(doc), safeModeOff: true }))).status, 400); untouched();
    }
    for (const extra of [{ composeContent: {} }, { composeContent: 'services: [' }, { projectPath: [] }, { projectName: {} }, { projectName: 'bad name' }]) {
      reset(); allowed = true;
      assert.equal((await docker().POST(request({ serverId: 'remote-a', type: 'compose', projectPath: '/opt/app', composeContent: 'services: {app: {image: nginx}}', safeModeOff: true, ...extra }))).status, 400); untouched();
    }
    const safeCompose = 'services: {app: {image: nginx, volumes: [{type: bind, source: /opt/data, target: /data}, "data:/db", "./data:/files"]}}';
    assert.equal(validator(yaml.load(safeCompose)).valid, true);
    reset(); allowed = true;
    const response = await docker().POST(request({ serverId: 'remote-a', type: 'compose', projectPath: '/opt/app', composeContent: safeCompose, safeModeOff: true }));
    assert.equal(response.status, 201, 'real YAML import must allow a valid Compose deployment');
    assert(calls.some(([name]) => name === 'ssh'));
    assert(calls.some(([name, _ssh, command]) => name === 'command' && command.includes('compose')));
  });
  await check('env flag injection stays one argv and never enters deployment logs', async () => {
    reset(); allowed = true;
    const runner = async (...args) => {
      calls.push(['command', ...args]);
      const command = typeof args[0] === 'string' ? args[0] : args[1];
      if (command.startsWith('docker info')) return 'ok';
      if (command.startsWith('df ') || command.startsWith('awk ')) return '50';
      if (command.startsWith('docker run')) return 'abcdef123456';
      return '';
    };
    const old = mocks['@/lib/ssh'].executeCommand;
    mocks['@/lib/ssh'].executeCommand = runner;
    try {
      const value = 'x -v /:/host --privileged';
      const res = await docker().POST(request({ ...validImage, env: { TOKEN: value, QUOTE: "it's > ./host" } }));
      assert.equal(res.status, 201);
      const command = calls.find(([name, _ssh, cmd]) => name === 'command' && typeof cmd === 'string' && cmd.startsWith('docker run'))[2];
      // Parse only: never execute the captured Docker command.
      const parsed = require('node:child_process').spawnSync('python3', ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))', command], { encoding: 'utf8' });
      assert.equal(parsed.status, 0);
      const argv = JSON.parse(parsed.stdout);
      assert(argv.includes(`TOKEN=${value}`)); assert(argv.includes("QUOTE=it's > ./host"));
      assert(!argv.includes('-v')); assert(!argv.includes('--privileged'));
      for (const [name, args] of calls) if (name === 'write') assert(!JSON.stringify(args).includes(value), 'env secret leaked to persisted logs');
      assert(!JSON.stringify(res.body).includes(value));
      reset(); allowed = true;
      mocks['@/lib/ssh'].executeCommand = async (...args) => {
        if (args[1].startsWith('docker run')) throw new Error(`Failed command: ${args[1]}`);
        return runner(...args);
      };
      const failed = await docker().POST(request({ ...validImage, env: { TOKEN: value } }));
      assert.equal(failed.status, 500);
      assert(!JSON.stringify(failed.body).includes(value));
      for (const [name, args] of calls) if (name === 'write') assert(!JSON.stringify(args).includes(value), 'executor exception leaked env secret');
    } finally { mocks['@/lib/ssh'].executeCommand = old; }
  });
  await check('Compose upload errors never expose secret document or command locally/remotely', async () => {
    const marker = 'SEC01-compose-secret-marker';
    const composeContent = `services:\n  app:\n    image: nginx\n    environment:\n      TOKEN: ${marker}\n`;
    const encoded = Buffer.from(composeContent).toString('base64');
    for (const serverId of ['local', 'remote-a']) {
      reset(); allowed = true;
      const executor = serverId === 'local' ? mocks['@/lib/local-server'] : mocks['@/lib/ssh'];
      const method = serverId === 'local' ? 'execLocal' : 'executeCommand';
      const old = executor[method];
      let uploadCommand;
      executor[method] = async (...args) => {
        calls.push(['command', ...args]);
        const command = serverId === 'local' ? args[0] : args[1];
        if (command.includes('base64 -d')) {
          uploadCommand = command;
          throw new Error(`Failed command: ${command}`);
        }
        if (command.startsWith('docker info')) return 'ok';
        if (command.startsWith('df ') || command.startsWith('awk ')) return '50';
        return '';
      };
      try {
        const res = await docker().POST(request({ serverId, type: 'compose', projectPath: '/opt/app', composeContent, safeModeOff: true }));
        assert.equal(res.status, 500);
        assert(uploadCommand?.includes(encoded), 'real upload command must contain encoded fixture');
        const writes = calls.filter(([name]) => name === 'write').map(([, args]) => args.data);
        assert(writes.some(data => data.status === 'FAILED'), 'failure must be persisted');
        for (const [label, output] of [['response', res.body], ['persisted logs', writes]]) {
          const text = JSON.stringify(output);
          for (const secret of [encoded, marker, composeContent, uploadCommand]) {
            assert(!text.includes(secret) && !text.includes(JSON.stringify(secret).slice(1, -1)), `${serverId}: ${label} leaked Compose document/command`);
          }
        }
        assert.equal(res.body.error, "Compose file upload failed; check the target server's disk space and permissions.");
        assert(!calls.some(([name, ...args]) => name === 'command' && args.some(arg => typeof arg === 'string' && arg.includes(' up -d'))), 'failed upload must stop deployment');
      } finally { executor[method] = old; }
    }
  });
  await check('all three forms omit requirement controls for unselected Remote', () => {
    for (const component of ['DeployForm', 'DockerImageDeploy', 'DockerComposeDeploy']) {
      const source = fs.readFileSync(path.join(root, 'src/components/deploy', `${component}.tsx`), 'utf8');
      const states = [], Banner = () => null;
      let cursor = 0;
      const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      const react = { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; }, useEffect: () => {}, useCallback: fn => fn };
      const module = { exports: {} };
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? runtime : name.endsWith('/DeployRequirementBanner') ? { DeployRequirementBanner: Banner } : name.endsWith('/SafeModeContext') ? { useSafeMode: () => ({ safeMode: false }) } : new Proxy({}, { get: (_, key) => key }) });
      const render = () => { cursor = 0; return module.exports[component](); };
      function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
      let tree = nodes(render());
      assert.equal(tree.find(node => node.type === Banner).props.serverId, 'local', `${component}: explicit local target`);
      tree.find(node => node.type === 'button' && node.props.onClick?.toString().includes('setDeployTarget("remote")')).props.onClick();
      tree = nodes(render());
      assert(!tree.some(node => node.type === Banner), `${component}: unselected Remote mounted requirements`);
    }
  });
  await check('requirements and installs retain explicit target; old responses stop after target unmount', async () => {
    const source = fs.readFileSync(path.join(root, 'src/components/deploy/DeployRequirementBanner.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const requests = [], pending = [];
    function mount(serverId) {
      const states = [], effects = [];
      let cursor = 0, first = true, writes = 0;
      const react = {
        useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { writes++; states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef: initial => { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
        useCallback: fn => fn, useEffect: fn => { if (first) effects.push(fn); },
      };
      const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      const module = { exports: {} };
      vm.runInNewContext(code, {
        module, exports: module.exports,
        require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? runtime : name.endsWith('/SafeModeContext') ? { useSafeMode: () => ({ safeMode: false }) } : new Proxy({}, { get: (_, key) => key }),
        window: { confirm: () => true },
        fetch: (url, options) => { requests.push([url, JSON.parse(options.body)]); return new Promise(resolve => pending.push(json => resolve({ json: async () => json }))); },
      });
      const render = () => { cursor = 0; return module.exports.DeployRequirementBanner({ mode: 'compose', serverId }); };
      render(); first = false;
      const cleanups = effects.map(fn => fn()).filter(fn => typeof fn === 'function');
      return { render, unmount: () => cleanups.forEach(fn => fn()), writes: () => writes };
    }
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
    const empty = mount(''); assert.equal(empty.render(), null); assert.equal(requests.length, 0); empty.unmount();
    const remote = mount('remote-a');
    pending.shift()({ success: true, data: { requirements: [{ name: 'Compose', ok: false, packageId: 'docker-compose-plugin' }] } });
    await settle();
    nodes(remote.render()).find(node => node.type === 'button' && node.props.title === 'Fix Compose').props.onClick();
    const install = nodes(remote.render()).find(node => node.type === 'button' && node.props.children === 'Install');
    // Children include the icon followed by text.
    const installButton = install || nodes(remote.render()).find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Install'));
    const installing = installButton.props.onClick();
    assert.equal(requests.at(-1)[1].serverId, 'remote-a');
    remote.unmount(); const oldWrites = remote.writes();
    const local = mount('local');
    const count = requests.length;
    pending.shift()({ success: true, data: { output: 'Old remote install' } });
    await installing; await settle();
    assert.equal(requests.length, count, 'old install must not recheck another target');
    assert.equal(remote.writes(), oldWrites, 'unmounted response must not update state');
    assert.equal(requests.at(-1)[1].serverId, 'local');
    pending.shift()({ success: true, data: { requirements: [] } }); await settle(); local.unmount();
    const late = mount('remote-b'); late.unmount(); const lateWrites = late.writes();
    pending.shift()({ success: true, data: { requirements: [{ name: 'Late remote', ok: false }] } }); await settle();
    assert.equal(late.writes(), lateWrites, 'old requirement response must not update state');
  });
  assert.equal(failures.length, 0, `Security regression failures: ${failures.join(', ')}`);
}
async function main() {
  await securityRegressions();
  for (const file of ['route.ts', 'docker/route.ts', 'preflight/route.ts', 'requirements/route.ts', 'requirements/install/route.ts']) {
    for (const serverId of [undefined, 'local', 'remote-b']) {
      const body = { serverId, repoUrl: 'https://github.com/example/repo', type: 'image', image: 'nginx', mode: 'git', packageId: 'git', safeModeOff: true };
      reset(); session = null;
      assert.equal((await load(file).POST(request(body))).status, 401, `${file} unauthenticated`); untouched();
      reset();
      assert.equal((await load(file).POST(request(body))).status, 403, `${file} unauthorized target ${serverId}`); untouched();
      assert.equal(calls.find(([name]) => name === 'access')[3], serverId || 'local');
    }
  }
  for (const file of ['route.ts', 'docker/route.ts', 'requirements/install/route.ts']) {
    reset(); allowed = true; session.role = 'VIEWER';
    assert.equal((await load(file).POST(request({ serverId: 'remote-a', customPath: '/opt/app', type: 'image', packageId: 'git', safeModeOff: true }))).status, 403, `${file} viewer mutation`); untouched();
  }
  for (const file of ['route.ts', 'docker/route.ts', 'preflight/route.ts', 'requirements/route.ts', 'requirements/install/route.ts']) {
    for (const serverId of ['', 123, {}, []]) {
      reset(); allowed = true;
      assert.equal((await load(file).POST(request({ serverId }))).status, 400, `${file} malformed target`); untouched();
    }
  }
  reset(); session.role = 'ADMIN';
  assert.equal((await load('rollback/route.ts').POST(request({ deploymentId: {} }))).status, 400); untouched();
  for (const serverId of [null, 'remote-b']) {
    reset(); session.role = 'ADMIN'; rows = [{ id: 'old', serverId, status: 'RUNNING' }];
    assert.equal((await load('rollback/route.ts').POST(request({ deploymentId: 'old', safeModeOff: true }))).status, 403);
    assert(!calls.some(([name]) => ['server', 'write', 'command', 'ssh'].includes(name)));
  }
  reset(); allowed = true;
  assert.equal((await load('requirements/install/route.ts').POST(request({ serverId: 'local', packageId: 'git' }))).status, 423); untouched();
  reset(); allowed = true;
  assert.equal((await load('requirements/install/route.ts').POST(request({ serverId: 'local', packageId: 'git', safeModeOff: true }))).status, 200);
  assert(calls.some(([name]) => name === 'command')); assert(!calls.some(([name]) => name === 'ssh'));
  reset(); allowed = true;
  assert.equal((await load('docker/route.ts').POST(request({ serverId: 'local', type: 'image' }))).status, 423); untouched();
  reset(); allowed = true;
  assert.equal((await load('route.ts').POST(request({ serverId: 'remote-a', repoUrl: 'https://github.com/example/repo', customPath: '/opt/app' }))).status, 423); untouched();
  for (const file of ['preflight/route.ts', 'requirements/route.ts']) {
    reset(); allowed = true;
    const res = await load(file).POST(request({ serverId: 'local', repoUrl: 'https://github.com/example/repo', mode: 'git' }));
    assert.equal(res.status, 200); assert.equal(res.body.data.target, 'local');
    assert(!calls.some(([name]) => ['ssh', 'server', 'safety', 'write'].includes(name)));
  }
  reset(); allowed = true;
  assert.equal((await load('route.ts').POST(request({ serverId: 'local', repoUrl: 'https://github.com/example/repo' }))).status, 201);
  assert(calls.some(([name]) => name === 'analyze')); assert(!calls.some(([name]) => ['ssh', 'server', 'safety'].includes(name)));
  reset(); allowed = true;
  assert.equal((await load('docker/route.ts').POST(request({ serverId: 'local', type: 'image', safeModeOff: true }))).status, 400);
  assert(!calls.some(([name]) => name === 'ssh'));
  reset(); session = null;
  assert.equal((await load('route.ts').GET()).status, 401); untouched();
  assert.equal((await load('stream/route.ts').GET()).status, 401); untouched();
  reset(); rows = [{ id: 'a', serverId: 'remote-a', createdAt: new Date() }, { id: 'b', serverId: 'remote-b', createdAt: new Date() }, { id: 'c', serverId: null, createdAt: new Date() }, { id: 'd', serverId: 'local', createdAt: new Date() }]; allowed = true;
  let res = await load('route.ts').GET();
  assert.deepEqual(Array.from(res.body.data, row => row.id), ['a', 'c', 'd']);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
  localAllowed = false;
  res = await load('route.ts').GET();
  assert.deepEqual(Array.from(res.body.data, row => row.id), ['a'], 'remote-only scope excludes both local log encodings');
  localAllowed = true;
  allowed = false;
  res = await load('route.ts').GET();
  assert.deepEqual(Array.from(res.body.data, row => row.id), ['c', 'd'], 'local-only scope excludes remote logs');
  allowed = true; localAllowed = undefined;
  const stream = await load('stream/route.ts').GET();
  assert.deepEqual(Array.from((await stream.fetcher()).deployments, row => row.id), ['a', 'c', 'd']);
  allowed = false;
  assert.equal((await stream.fetcher()).deployments.length, 0, 'stream rechecks scope');
  session = { sub: 'bob', role: 'MANAGER' }; allowed = true;
  assert.equal((await stream.fetcher()).deployments.length, 0, 'stream must not switch accounts');
  assert.match(stream.headers.get('Cache-Control'), /no-store/);
  for (const component of ['DeployForm', 'DockerImageDeploy', 'DockerComposeDeploy']) {
    const source = fs.readFileSync(path.join(root, 'src/components/deploy', `${component}.tsx`), 'utf8');
    assert.match(source, /useSafeMode/);
    assert.match(source, /safeModeOff: !safeMode/);
    assert.match(source, /window\.confirm/);
    assert.match(source, /Safe Mode is on/);
  }
  console.log('PASS deploy SEC-01: auth/scope/roles, local dispatch, safe-mode exemptions, isolated logs/stream');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
