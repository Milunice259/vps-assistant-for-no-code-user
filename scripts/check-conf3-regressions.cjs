// Offline allowlist only; reviewed mock executors and disposable SQLite. Never auto-run new scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const checks = [
  'check-action-truth', 'check-app-access', 'check-app-list-inventory', 'check-app-ui-safety',
  'check-backup-ui', 'check-canvas-ux', 'check-conf-i18n', 'check-conf-settings', 'check-conf-theme',
  'check-conf3-routing', 'check-conf3-tls', 'check-conf3-projection', 'check-conf34-configuration', 'check-confirm-dialog', 'check-dashboard-scopes',
  'check-data-apps-inventory', 'check-data-disk-ui', 'check-data-parsers', 'check-data-services',
  'check-data-ui-isolation', 'check-data02-host-disk', 'check-deploy-safety', 'check-deploy-truth',
  'check-deploy4-compose', 'check-deploy4-compose-api', 'check-deploy4-git-actions',
  'check-deploy4-git-plan', 'check-deploy4-image', 'check-deploy4-image-faults',
  'check-deploy4-safety', 'check-deploy4-ui',
  'check-firewall-safety', 'check-firewall-truth', 'check-fleet-read-scope', 'check-guided-deploy',
  'check-guided-operations', 'check-local-deploy-fk', 'check-onboarding-ux', 'check-panel-backup',
  'check-remote-env-upload', 'check-remote-git-truth', 'check-safe-dependencies', 'check-safe04-permissions',
  'check-mon5-alerts', 'check-mon5-integration', 'check-mon5-metrics',
  'check-mon5-observations', 'check-mon5-readiness', 'check-mon5-ui',
  'safe-env-recreate-regression', 'safe03-log-stream-check', 'safe12-recovery-route-check',
  'safe12-remote-check', 'sec01-cron-terminal-backup-check', 'test-advanced-safety',
].map(name => name + '.cjs');
const excluded = {
  'check-mon5-readiness-runtime.cjs': 'Privileged nested Engine and actual HTTP/container mutations; explicit isolated runtime authorization required',
  'check-mon5-runtime.cjs': 'Privileged nested Engine, SSH/HTTP receiver, worker and SQLite runtime mutations; parent-owned',
  'check-mon5-scheduler.cjs': 'Real supervised worker/child processes and 120-second hard-kill lifecycle; outside offline mock scope',
  'monitoring-worker.cjs': 'Production collector supervisor; never execute directly from the offline runner',
  'check-conf-settings-browser.cjs': 'Durable browser HTTP server and bundle writes',
  'check-conf34-browser.cjs': 'Durable browser HTTP server and bundle writes',
  'check-data-ui-browser.cjs': 'Durable browser HTTP server and bundle writes',
  'check-flow-review-browser.cjs': 'Durable browser HTTP server and bundle writes',
  'safe12-ui-check.cjs': 'Durable browser HTTP server and bundle writes',
  'safe12-editor-ui-check.cjs': 'Durable browser HTTP server and bundle writes',
  'ssh-identity-check.cjs': 'Real loopback SSH server/client',
  'check-flow-review.cjs': 'Real docker compose config invocation (read-only, still outside offline scope)',
  'check-conf3-acceptance.cjs': 'Authenticated HTTP mutation and actual Docker inspection; parent-owned',
  'check-conf3-auth-qa.cjs': 'Docker/SSH/network/QA provisioning and actual resource mutations',
  'check-conf34-runtime.cjs': 'Actual Docker/network/volume/container mutations; parent-owned',
  'check-conf3-routing-runtime.cjs': 'Actual isolated Docker/proxy/network mutations, live DNS and HTTP',
  'check-conf3-tls-runtime.cjs': 'Actual private Engine, CA, Traefik HTTPS and exact cleanup; explicit authorization required',
  'check-data-phase2-auth-qa.cjs': 'Docker/HTTP/QA provisioning',
  'check-data-phase2-remote-qa.cjs': 'Docker/SSH/HTTP/QA mutation',
  'safe-phase1-auth-qa.cjs': 'Docker/HTTP/QA mutation',
  'safe-phase1-remote-qa.cjs': 'Docker/SSH/HTTP/QA mutation',
  'safe-phase1-stream-qa.cjs': 'Authenticated HTTP/stream and existing QA dependencies',
  'safe12-db-check.cjs': 'Actual Docker create/recreate/delete',
  'safe12-health-check.cjs': 'Actual Docker create/start/recreate/delete',
  'safe12-runtime-check.cjs': 'Actual Docker/network/volume/container mutations',
  'safe12-stopped-check.cjs': 'Actual Docker run/recreate/delete',
  'check-deploy4-auth-qa.cjs': 'Docker/SSH/SQLite/session provisioning, clone image build/start, authenticated HTTP and exact resource cleanup',
  'check-deploy4-browser.cjs': 'Chromium harness; authenticated clone HTTP and actual nested Compose create/update/rollback in run mode',
  'check-deploy4-compose-native.cjs': 'Privileged nested Engine, real Compose build/create/update/rollback, volumes/networks and native fault mutations',
  'check-deploy4-compose-runtime.cjs': 'Privileged nested Engine, real Compose create/update/rollback/build and volume/network mutations',
  'check-deploy4-git.cjs': 'Native shell/Git init/commit/clone in disposable scratch; Engine mocked, but native command harness outside offline mock scope',
  'check-deploy4-git-runtime.cjs': 'Privileged nested Engine, native Git clone/build/container runtime and exact cleanup',
  'check-deploy4-git-adapter-runtime.cjs': 'Privileged nested Engine, native Git/Compose build/create/update/rollback and volume mutations; persistence mocked',
  'check-deploy4-git-browser.cjs': 'Authenticated native Git/browser QA mutation harness; sibling-owned, requires isolated clone resources',
  'check-deploy4-image-runtime.cjs': 'Privileged nested Engine, real registry/proxy HTTP, image create/update/rollback and volume/network mutations',
};
function fingerprint() {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file)));
    }
  }
  for (const dir of ['src', 'scripts', 'prisma']) visit(dir);
  for (const file of ['package.json', 'package-lock.json']) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return hash.digest('hex');
}
async function main() {
  assert.equal(new Set(checks).size, checks.length);
  assert(checks.every(name => !Object.hasOwn(excluded, name)));
  const discovered = fs.readdirSync(path.join(root, 'scripts')).filter(name => name.endsWith('.cjs') && name !== path.basename(__filename)).sort();
  const unknown = discovered.filter(name => !checks.includes(name) && !Object.hasOwn(excluded, name));
  assert(checks.every(name => discovered.includes(name)), 'Allowlisted script missing');
  const inventory = { included: checks, excluded, unknown, discovered: discovered.length };
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list') { console.log(JSON.stringify(inventory, null, 2)); return; }
  const selected = args.length ? args : checks;
  assert.equal(new Set(selected).size, selected.length, 'Duplicate selected check');
  assert(selected.every(name => checks.includes(name)), 'Use exact allowlisted .cjs filenames only');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || path.join(os.homedir(), '.hermes/cache/scratch'), 'conf3-regression-'));
  const before = fingerprint(), results = [];
  console.log('EVIDENCE ' + scratch);
  for (const file of selected) {
    const temp = path.join(scratch, file + '.scratch'); fs.mkdirSync(temp);
    const stdout = path.join(scratch, file + '.stdout.log'), stderr = path.join(scratch, file + '.stderr.log');
    const out = fs.openSync(stdout, 'w'), err = fs.openSync(stderr, 'w');
    const start = Date.now(); let timedOut = false;
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(root, 'scripts', file)], {
        cwd: root, detached: true, stdio: ['ignore', out, err],
        env: { ...process.env, TMPDIR: temp, DATABASE_URL: 'file:' + path.join(temp, 'unused-default.db'), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      });
      const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }, 180_000);
      child.once('error', error => { clearTimeout(timer); resolve({ code: null, signal: null, error: error.message }); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    fs.closeSync(out); fs.closeSync(err);
    const row = { file, ...result, timedOut, passed: result.code === 0 && !timedOut, durationMs: Date.now() - start, stdout, stderr };
    results.push(row);
    fs.writeFileSync(path.join(scratch, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${row.passed ? 'PASS' : 'FAIL'} ${file} code=${row.code} signal=${row.signal || '-'} timeout=${timedOut}`);
  }
  const after = fingerprint();
  const summary = { ...inventory, selected: selected.length, passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, sourceBefore: before, sourceAfter: after, sourceChanged: before !== after, results };
  assert.equal(summary.passed + summary.failed, summary.selected);
  fs.writeFileSync(path.join(scratch, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ selected: summary.selected, passed: summary.passed, failed: summary.failed, sourceChanged: summary.sourceChanged, unknown, evidence: scratch }));
  if (summary.failed || unknown.length || summary.sourceChanged) process.exitCode = 1;
  // ponytail: audited allowlist, not a security sandbox; re-inspect changed/new checks before adding them.
}
main().catch(error => { console.error(error); process.exitCode = 1; });
