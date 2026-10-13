// node scripts/check-deploy4-browser.cjs offline|run
// Actual clone-mounted UI + real Compose mutations in registered nested Engines only.
// Git checks request separation (analysis request aborted); not public Git execution/login proof.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
process.umask(0o077);
const root = path.resolve(__dirname, '..');
const scratch = '/root/.hermes/cache/scratch/vps-deploy4-integrated';
const playwrightPath = process.env.DEPLOY4_PLAYWRIGHT_MODULE || '/opt/hermes-tools/venvs/web/lib/python3.11/site-packages/playwright/driver/package';
function playwright() { try { return require('playwright'); } catch { return require(playwrightPath); } }
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
const inspect = name => JSON.parse(docker('inspect', name))[0];
function privateRead(file) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && (s.mode & 0o077) === 0, 'Private fixture file required');
  return fs.readFileSync(file, 'utf8');
}
function validateRegistry(r) {
  assert.equal(r.prefix, 'vps-deploy4-integrated'); assert.equal(r.scratch, scratch);
  assert.equal(r.sessionFile, scratch + '/sessions.json'); assert.equal(r.db, scratch + '/fixture.db');
  assert.equal(r.base, 'http://127.0.0.1:' + r.port); assert(Number.isInteger(r.port) && r.port > 1024);
  assert(r.build?.stable && r.build.imageId && r.build.sourceHash, 'Stable clone build required');
  const panel = r.containers.find(c => c.scope === 'panel'); assert(panel?.id && panel.name === r.prefix + '-panel');
  return panel;
}
function verifyIsolation(r) {
  const panel = inspect(validateRegistry(r).id);
  assert.equal(panel.Name, '/' + r.prefix + '-panel'); assert.equal(panel.Config.Labels['qa.owner'], r.prefix);
  assert.equal(panel.Image, r.build.imageId); assert.equal(panel.HostConfig.PortBindings['3000/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(panel.HostConfig.PortBindings['3000/tcp'][0].HostPort, String(r.port));
  assert(!panel.Mounts.some(m => m.Source === '/var/run/docker.sock'));
  assert(panel.Mounts.some(m => m.Name === r.prefix + '-local-socket' && m.Destination === '/var/run'));
  for (const scope of ['local', 'remote']) {
    const registered = r.containers.find(c => c.scope === scope), e = inspect(registered.id);
    assert.equal(e.Name, '/' + r.prefix + '-' + scope + '-engine'); assert.equal(e.Config.Labels['qa.owner'], r.prefix);
    assert(!e.Mounts.some(m => m.Source === '/var/run/docker.sock')); assert.equal(Object.keys(e.HostConfig.PortBindings || {}).length, 0);
    assert(!/:237[56]\s/.test(docker('exec', registered.name, 'ss', '-ltnH')));
  }
}
const button = (scope, name) => ['Git Repo', 'Docker Image', 'Docker Compose'].includes(name)
  ? scope.locator('button').filter({ hasText: new RegExp('^' + name + '$'), visible: true })
  : scope.getByRole('button', { name, exact: true }).filter({ visible: true });
const label = (scope, name) => scope.getByLabel(name, { exact: true }).filter({ visible: true });
async function disabled(locator) { assert(await locator.isDisabled(), 'Expected locked control'); }
async function enabled(locator) { await locator.waitFor({ state: 'visible' }); const end = Date.now() + 30000; while (await locator.isDisabled() && Date.now() < end) await new Promise(r => setTimeout(r, 100)); assert(await locator.isEnabled(), 'Expected unlocked control'); }
async function jsonClick(page, target, route) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === 'POST', { timeout: 180000 });
  await target.click(); const res = await response; const data = await res.json(); assert(res.ok() && (data.success === true || data.data?.status === 'UNVERIFIED' && !data.uncertain && data.pending !== true), 'API operation failed'); return data.data;
}
async function offline() {
  const fixture = { prefix: 'vps-deploy4-integrated', scratch, sessionFile: scratch + '/sessions.json', db: scratch + '/fixture.db', base: 'http://127.0.0.1:18865', port: 18865, build: { stable: true, imageId: 'fixture', sourceHash: 'fixture' }, containers: [{ scope: 'panel', name: 'vps-deploy4-integrated-panel', id: 'fixture' }] };
  validateRegistry(fixture);
  for (const bad of [{ ...fixture, base: 'https://vps.mywf.in' }, { ...fixture, scratch: '/opt/vps-panel' }, { ...fixture, sessionFile: '/secret' }, { ...fixture, build: { stable: false } }]) assert.throws(() => validateRegistry(bad));
  const browser = await playwright().chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); await page.setContent('<button disabled>locked</button><label>Consent<input type="checkbox"></label>');
    await disabled(button(page, 'locked')); await label(page, 'Consent').check(); assert(await label(page, 'Consent').isChecked());
  } finally { await browser.close(); }
  console.log('PASS offline isolation guards + installed Chromium/Playwright smoke; mounted clone acceptance NOT executed');
}
async function run() {
  assert.equal(process.env.DEPLOY4_BROWSER_ISOLATED, '1', 'Explicit isolated mutation opt-in required');
  const r = JSON.parse(privateRead(scratch + '/registry.json')); verifyIsolation(r);
  const env = Object.fromEntries(privateRead(scratch + '/env').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const tokens = JSON.parse(privateRead(r.sessionFile));
  const { jwtVerify, SignJWT } = require('jose'); const key = new TextEncoder().encode(env.JWT_SECRET);
  const { payload } = await jwtVerify(tokens.owner, key); assert.equal(payload.sub, r.prefix + '-owner'); assert.equal(payload.role, 'OWNER'); assert(payload.jti);
  const advanced = await new SignJWT({ sessionIssuedAt: payload.iat, sessionId: payload.jti, forceLogoutVersion: payload.forceLogoutVersion, role: payload.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(payload.sub).setAudience('vps-advanced').setIssuedAt().setExpirationTime('15m').sign(key);
  const browser = await playwright().chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const evidence = { imageId: r.build.imageId, sourceHash: r.build.sourceHash, mountedCloneExecuted: true, passwordLoginTested: false, gitBackendExecuted: false, cases: [] };
  const runId = Date.now().toString(36);
  try {
    for (const [device, viewport, scope] of [['desktop', { width: 1440, height: 1000 }, 'local'], ['mobile', { width: 390, height: 844 }, 'remote']]) {
      const context = await browser.newContext({ viewport, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
      await context.addCookies([{ name: 'vps-session', value: tokens.owner, url: r.base, httpOnly: true, sameSite: 'Lax' }, { name: 'vps-advanced', value: advanced, url: r.base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('dialog', dialog => dialog.accept());
      // Fail closed on navigation/requests outside the exact loopback clone. No HAR/trace/session logging.
      await context.route('**/*', route => new URL(route.request().url()).origin === r.base ? route.continue() : route.abort());
      await page.goto(r.base + '/deploy'); await button(page, 'Docker Compose').click();
      if (scope === 'remote') {
        await button(page, 'Remote Server').click();
        await page.locator('select').filter({ has: page.locator('option[value="' + r.ssh.serverId + '"]') }).filter({ visible: true }).selectOption(r.ssh.serverId);
      }
      const serverId = scope === 'local' ? 'local' : r.ssh.serverId;
      const engine = r.prefix + '-' + scope + '-engine';
      const projectName = 'deploy4-browser-' + device + '-' + runId, projectPath = '/opt/deploy4/' + projectName;
      // Assets stay exclusively inside parent-owned disposable dind; parent registry cleanup removes them.
      const assets = { 'note.txt': 'isolated browser fixture' };
      const command = 'require("http").createServer((q,s)=>s.end(process.env.REVISION)).listen(8080);process.on("SIGTERM",()=>process.exit(0));';
      const yaml = version => `services:\n  web:\n    image: node:20-alpine\n    command: [node, -e, ${JSON.stringify(command)}]\n    environment: {REVISION: "${version}"}\n    healthcheck:\n      test: [CMD, node, -e, "require('http').get('http://127.0.0.1:8080',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]\n      interval: 2s\n      timeout: 2s\n      retries: 10\n`;
      await page.getByPlaceholder('my-stack', { exact: true }).fill(projectName);
      await page.getByPlaceholder('/opt/myproject', { exact: true }).fill(projectPath);
      await label(page, 'Compose build assets').fill(JSON.stringify(assets));
      // The legacy Field label has no htmlFor; select its sole unlabelled textarea.
      const composeText = page.locator('textarea:not([aria-label])').filter({ visible: true }); await composeText.fill(yaml('v1'));
      const deploy = button(page, 'Deploy Compose Stack'), preflight = button(page, 'Run pre-flight');
      await disabled(deploy); await disabled(preflight);
      const directory = page.getByLabel(/I reviewed this exact destination directory/).filter({ visible: true }); await directory.check();
      const review = async () => {
        await jsonClick(page, button(page, 'Review Compose preview (read-only)'), '/api/deploy/docker'); await disabled(preflight);
        await page.getByLabel(/I consent to these exact build services/).filter({ visible: true }).check();
      };
      await review(); await jsonClick(page, preflight, '/api/deploy/preflight'); await enabled(deploy);
      await label(page, 'Compose build assets').fill(JSON.stringify({ ...assets, 'note.txt': 'input invalidation' })); await disabled(deploy); await disabled(preflight);
      await label(page, 'Compose build assets').fill(JSON.stringify(assets)); await review();
      await jsonClick(page, preflight, '/api/deploy/preflight'); const created = await jsonClick(page, deploy, '/api/deploy/docker'); assert(['RUNNING','UNVERIFIED'].includes(created.status));
      const api = async id => { const res = await context.request.get(r.base + '/api/deploy/' + encodeURIComponent(id)); assert(res.ok()); const body = await res.json(); assert(body.success); return body.data; };
      const runtime = async (id, version) => {
        const detail = await api(id); assert.equal(detail.serverId, serverId); assert.equal(detail.pending, false); assert(detail.containerIds?.length);
        for (const cid of detail.containerIds) {
          let current; for(let attempt=0;attempt<40;attempt++){current=JSON.parse(docker('exec', engine, 'docker', 'inspect', cid))[0];if(current.State.Health?.Status==='healthy')break;await new Promise(resolve=>setTimeout(resolve,500));} assert(current.State.Running); assert.equal(current.State.Health?.Status, 'healthy'); assert(current.Config.Env.includes('REVISION=' + version));
          assert.equal(docker('exec', engine, 'docker', 'exec', cid, 'node', '-e', 'require("http").get("http://127.0.0.1:8080",r=>r.pipe(process.stdout))').trim(), version);
        }
        return detail;
      };
      await runtime(created.id, 'v1');
      await page.screenshot({ path: scratch + '/browser-' + device + '-compose.png', fullPage: true });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert(layout.document <= layout.viewport, 'Horizontal page overflow');
      const composeScreenshot = scratch + '/browser-' + device + '-compose.png';
      await label(page, 'Compose operation').selectOption('update'); await label(page, 'Managed deployment ID').fill(created.id); await composeText.fill(yaml('v2'));
      await review(); await disabled(preflight); await label(page, 'External data compatibility').selectOption('unchanged'); await disabled(preflight); await label(page, 'Database/schema compatibility').selectOption('unchanged');
      // Attestation changes invalidate the plan too: demand a new reviewed preview.
      await disabled(preflight); await review(); await page.getByLabel(/I accept writable-layer loss on replacement/).check(); await jsonClick(page, preflight, '/api/deploy/preflight'); const updated = await jsonClick(page, deploy, '/api/deploy/docker'); assert(['RUNNING','UNVERIFIED'].includes(updated.status)); await runtime(updated.id, 'v2');
      await page.reload();
      const row = page.locator('[id="deployment-' + updated.id + '"]'); await row.waitFor(); await label(row, 'Lifecycle operation').selectOption('rollback');
      const plan = await jsonClick(page, button(row, 'Review operation (read-only)'), '/api/deploy/' + encodeURIComponent(updated.id));
      const apply = button(row, 'Apply reviewed operation'); await disabled(apply);
      await label(row, 'Exact lifecycle confirmation').fill(plan.confirmation); await disabled(apply);
      await label(row, 'External data compatibility').selectOption('unchanged'); await label(row, 'Database/schema compatibility').selectOption('unchanged'); await disabled(apply);
      await row.getByLabel(/I accept writable-layer loss/).check(); await enabled(apply);
      await jsonClick(page, apply, '/api/deploy/' + encodeURIComponent(updated.id)); await row.getByRole('status').filter({ hasText: 'Native configuration read back' }).waitFor(); await runtime(updated.id, 'v1');
      await button(page, 'Docker Image').click();
      if (scope === 'remote') {
        await button(page, 'Remote Server').click();
        await page.locator('select').filter({ has: page.locator('option[value="' + r.ssh.serverId + '"]') }).filter({ visible: true }).selectOption(r.ssh.serverId);
      }
      await page.getByText('Environment, storage, health and routing', { exact: true }).click();
      await page.getByPlaceholder('nginx:latest', { exact: true }).fill('node:20-alpine');
      for (const [name, value] of [['Image environment', 'REVISION=browser'], ['Image mounts', 'bind|/opt/deploy4|/data|ro'], ['Existing networks (comma-separated)', 'bridge'], ['Health command (container shell)', 'node -e "process.exit(0)"'], ['Domain (exact lowercase hostname)', 'browser.invalid'], ['Proxy container ID (64 characters)', 'a'.repeat(64)], ['Backend port', '8080'], ['Proxy entrypoint', 'web'], ['TLS resolver (optional)', 'fixture'], ['Routing network', 'bridge']]) await label(page, name).fill(value);
      let imagePosts = 0; const watch = req => { if (new URL(req.url()).pathname === '/api/deploy/preflight' && req.method() === 'POST') imagePosts++; }; page.on('request', watch);
      await enabled(button(page, 'Run pre-flight')); assert.equal(await label(page, 'Image mounts').inputValue(), 'bind|/opt/deploy4|/data|ro'); assert(!(await page.getByLabel(/I reviewed these existing volumes/).isChecked()));
      await button(page, 'Run pre-flight').click(); await page.getByRole('alert').filter({ hasText: 'Review mounts and consent;', visible: true }).waitFor(); assert.equal(imagePosts, 0, 'Missing mount consent must block request'); await disabled(button(page, 'Deploy Image'));
      await page.getByLabel(/I reviewed these existing volumes/).check(); await label(page, 'Image mounts').fill('bind|/opt/deploy4|/data|rw'); assert(!(await page.getByLabel(/I reviewed these existing volumes/).isChecked())); page.off('request', watch);
      await button(page, 'Git Repo').click(); await page.getByPlaceholder('https://github.com/user/repo').fill('https://github.com/docker/awesome-compose');
      assert.equal(await label(page, 'Git operation').inputValue(), 'analyze');
      if (scope === 'remote') {
        await button(page, 'Remote Server').click();
        await page.locator('select').filter({ has: page.locator('option[value="' + r.ssh.serverId + '"]') }).filter({ visible: true }).selectOption(r.ssh.serverId);
        assert.equal(await label(page, 'Git operation').inputValue(), 'analyze');
      }
      let analyzedBody;
      await page.route('**/api/deploy', route => { if (route.request().method() !== 'POST') return route.continue(); analyzedBody = route.request().postDataJSON(); return route.abort(); });
      await button(page, 'Analyze repository').click(); await page.getByText('Analysis unavailable.', { exact: true }).waitFor();
      assert.equal(analyzedBody.action, 'analyze'); assert.equal(analyzedBody.serverId, serverId); assert(!('customPath' in analyzedBody));
      await page.unroute('**/api/deploy'); await label(page, 'Git operation').selectOption('deploy'); await disabled(button(page, 'Execute deployment'));
      await page.getByPlaceholder('/var/www/myapp').fill('/opt/deploy4/browser-git-' + runId); await disabled(button(page, 'Execute deployment'));
      await label(page, 'Git operation').selectOption('analyze'); await enabled(button(page, 'Analyze repository'));
      evidence.cases.push({ device, scope, layout, composeScreenshot, deploymentId: updated.id, composeCreateUpdateRollback: true, runtimeReadback: true, inputInvalidation: true, missingConsentLocks: true, imageAdvancedInputs: true, gitRequestSeparationOnly: true });
      await context.close(); console.log('PASS mounted ' + device + '/' + scope + ' Compose create/update/rollback + locks + Image inputs + Git request separation');
    }
    fs.writeFileSync(scratch + '/browser-evidence.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
  } finally { await browser.close(); }
}
(async () => { assert(['offline', 'run'].includes(process.argv[2]), 'Use offline|run'); await (process.argv[2] === 'offline' ? offline() : run()); })().catch(error => { console.error('DEPLOY4 browser failed: ' + (error.code || error.name) + '; ' + String(error.stack).split('\n').filter(line => line.trim().startsWith('at ')).join('\n')); process.exitCode = 1; });
