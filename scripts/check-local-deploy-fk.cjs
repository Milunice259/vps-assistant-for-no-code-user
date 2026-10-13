// Disposable SQLite only; actual routes/helpers + Prisma, mocked auth and executors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { load, output, mark } = require('./check-guided-deploy.cjs');
const root = path.resolve(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch');
const id = 'a'.repeat(64), shortId = id.slice(0, 12);
const composeContent = 'services: {web: {image: nginx}}';

async function main() {
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'local-deploy-fk-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const schema = path.join(dir, 'schema.prisma');
    fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), schema);
    const push = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'push', '--schema', schema, '--skip-generate'], {
      cwd: dir, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(push.status, 0, push.error?.message || push.stderr || push.stdout);
    assert.equal((await prisma.$queryRawUnsafe('PRAGMA foreign_keys'))[0].foreign_keys, 1n);
    assert.equal(await prisma.server.count(), 0);
    await assert.rejects(prisma.deploymentLog.create({ data: { repoUrl: 'docker://nginx', detectedStack: 'docker-image', logs: '', serverId: 'local' } }), { code: 'P2003' });
    await assert.rejects(prisma.app.create({ data: { name: 'invalid-local', serverId: 'local' } }), { code: 'P2003' });
    console.log('PASS real SQLite foreign keys reject virtual local for DeploymentLog and App (P2003)');

    let result = 'RUNNING', commands = [], localContainers = false;
    const run = command => {
      commands.push(command);
      if (result === 'FAILED' && (command.includes('native-image-create') || command.includes('native-compose-create'))) return mark('', 1);
      if (command.includes('docker inspect ')) return mark(JSON.stringify([{ Id: id, State: { Status: 'running', Health: result === 'RUNNING' ? { Status: 'healthy' } : undefined }, Config: { Labels: { 'com.docker.compose.service': 'web' } } }]));
      return output(command);
    };
    const mocks = {
      ...require('./check-guided-deploy.cjs').serviceMocks(),
      '@/lib/db': { prisma },
      '@/lib/auth': { getSession: async () => ({ sub: 'test-owner', role: 'OWNER' }) },
      '@/lib/permissions': { can: () => true },
      '@/lib/server-access': { canAccessServer: async () => true, scopedServerWhere: async () => ({}) },
      '@/lib/operation-safety': { ADVANCED_COOKIE: 'advanced', verifyAdvancedToken: async () => true, requireSafeModeOff: (_action, body) => { assert.equal(body.safeModeOff, true); return null; } },
      '@/lib/server-ssh': { connectToServer: async serverId => { assert.equal(serverId, 'remote-fk'); return { ssh: {} }; } },
      '@/lib/ssh': { closeSSH: async () => {}, executeCommand: async (_ssh, command) => run(command) },
      '@/lib/local-server': { isLocalServer: serverId => serverId === 'local', execLocal: run, execOnHost: run },
    };
    const { POST } = load('src/app/api/deploy/docker/route.ts', mocks);
    const cases = [];
    for (const serverId of ['local', 'remote-fk']) {
      if (serverId !== 'local') await prisma.server.create({ data: { id: serverId, name: 'Disposable remote fixture', host: '192.0.2.1', username: 'test' } });
      for (const type of ['image', 'compose']) for (const expected of ['RUNNING', 'UNVERIFIED', 'FAILED']) {
        result = expected; commands = [];
        const input = { type, serverId, safeModeOff: true, ...(type === 'image' ? { image: 'nginx', name: 'fk-check' } : { projectPath: '/opt/fk-check', composeContent, composeRevision: 'b'.repeat(64) }) };
        const response = await POST({ json: async () => input, cookies: { get: () => ({ value: 'signed-fixture' }) } });
        const body = await response.json();
        assert(body.data?.id, `${serverId}/${type}/${expected}: ${response.status} ${JSON.stringify(body)}`);
        assert.equal(response.status, expected === 'FAILED' ? 500 : 201);
        assert.equal(body.success, expected === 'RUNNING');
        assert.equal(body.data.status, expected);
        const stored = await prisma.deploymentLog.findUniqueOrThrow({ where: { id: body.data.id }, include: { server: true } });
        assert.equal(stored.status, expected);
        assert.equal(stored.logs, body.data.logs);
        assert.equal(stored.serverId, serverId === 'local' ? null : serverId);
        assert.equal(stored.server?.id ?? null, serverId === 'local' ? null : serverId);
        assert(commands.some(command => command.includes(type === 'image' ? 'native-image-create' : 'native-compose-create')), 'deployment must reach executor');
        if (serverId === 'local') {
          assert.equal(await prisma.server.count(), 0, 'no synthetic local Server');
          assert.equal(await prisma.app.count(), 0, 'local Docker discovery owns App identity');
          if (type === 'image' && expected === 'RUNNING') localContainers = true;
        }
        cases.push(`${serverId}/${type}/${expected}`);
      }
    }
    assert.equal(await prisma.deploymentLog.count(), cases.length);
    assert.equal(await prisma.deploymentLog.count({ where: { status: 'BUILDING' } }), 0);
    const apps = await prisma.app.findMany({ include: { server: true } });
    assert.equal(apps.length, 0, 'native services own persistence; mocked service creates no App rows');
    assert(apps.every(app => app.serverId === 'remote-fk' && app.server.id === 'remote-fk' && app.containerId === shortId));
    console.log(`PASS ${cases.length} real route/Prisma terminal records: ${cases.join(', ')}`);

    // Read the actual Apps API: local is canonical local::<Docker ID>, not a DB App.
    assert(localContainers);
    const inventory = load('src/lib/apps-inventory.ts');
    const { GET } = load('src/app/api/apps/route.ts', {
      ...mocks,
      '@/lib/app-access': {}, '@/lib/crypto': {},
      '@/lib/apps-inventory': inventory,
      // ponytail: no adopted settings here; real encrypted projection has check-conf3-projection.cjs.
      '@/lib/app-configuration-projection': { projectAppConfiguration: async apps => apps },
      '@/lib/local-server': { execLocal: command => {
        assert.equal(command, command.startsWith('docker inspect')
          ? `docker inspect --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\\n"}}{{end}}' ${id}`
          : inventory.DOCKER_INVENTORY_COMMAND);
        return command.startsWith('docker inspect') ? '' : `${id}\tfk-check\tnginx\trunning`;
      }, execOnHost: command => {
        assert.equal(command, inventory.SERVICE_INVENTORY_COMMAND);
        return '';
      } },
    });
    const response = await GET({ nextUrl: new URL('http://localhost/api/apps') });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    const local = body.data.filter(app => app.serverId === 'local');
    assert.equal(local.length, 1);
    assert.equal(local[0].id, `local::${id}`);
    assert.equal(local[0].containerId, id);
    assert.equal(local[0].status, 'RUNNING');
    assert.equal(body.data.filter(app => app.serverId === 'remote-fk').length, apps.length);
    assert.equal(await prisma.server.count(), 1);
    assert.equal((await prisma.$queryRawUnsafe('PRAGMA foreign_key_check')).length, 0);
    console.log('PASS actual Apps discovery returns canonical local:: ID; remote App/Server relations intact; FK integrity clean');
  } finally {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
