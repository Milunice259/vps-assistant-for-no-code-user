#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = process.argv.includes('--build') && process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'monitoring-runtime');

// Use the already-installed TypeScript compiler at image build time, never in the runner.
if (process.argv.includes('--build')) {
  const ts = require('typescript');
  for (const dir of ['lib', 'types']) {
    for (const file of fs.readdirSync(path.join(root, 'src', dir), { recursive: true })) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
      const source = path.join(root, 'src', dir, file);
      const target = path.join(runtime, dir, file.replace(/\.ts$/, '.js'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let output = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
      output = output.replace(/require\(["']@\/([^"']+)["']\)/g, (_, module) => `require(${JSON.stringify('./' + path.relative(path.dirname(target), path.join(runtime, module)).split(path.sep).join('/'))})`);
      fs.writeFileSync(target, output);
    }
  }
  console.log('[monitor] Built independent CJS runtime');
} else {
  const scheduler = require(path.join(runtime, 'lib/monitoring-scheduler.js'));
  const { prisma } = require(path.join(runtime, 'lib/db.js'));
  const deadlineMs = 120_000;
  if (process.argv.includes('--cycle')) {
    process.on('disconnect', () => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } });
    (async () => {
      // Sequential stages and sibling collectors' bounded server pools limit fanout.
      await require(path.join(runtime, 'lib/monitoring-metrics.js')).collectMonitoringMetrics();
      await require(path.join(runtime, 'lib/notification-checks.js')).runNotificationChecks();
      await prisma.$disconnect();
    })().then(() => process.exit(0), () => process.exit(1));
  } else {
    let stopping = false, child = null, nextRunAt = 0;
    // db.ts installs an exit handler; prepend cleanup so cycles never outlive the supervisor.
    const killCycle = active => { try { process.kill(-active.pid, 'SIGKILL'); } catch { active.kill('SIGKILL'); } };
    const stop = () => { stopping = true; if (child) killCycle(child); };
    process.prependListener('SIGTERM', stop);
    process.prependListener('SIGINT', stop);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function cycle(owner) {
      const startedAt = Date.now();
      let timedOut = false;
      child = fork(__filename, ['--cycle'], { stdio: 'ignore', detached: true });
      const active = child;
      const timer = setTimeout(() => { timedOut = true; killCycle(active); }, deadlineMs);
      const code = await new Promise(resolve => {
        active.once('error', () => resolve(1));
        active.once('exit', resolve);
      });
      clearTimeout(timer);
      child = null;
      await scheduler.finishMonitoringLease(owner, timedOut ? 'timeout' : code === 0 ? 'ok' : 'failed', startedAt);
    }
    (async () => {
      while (!stopping) {
        try {
          await scheduler.writeMonitoringHeartbeat();
          const config = await scheduler.getMonitoringConfig();
          if (config.enabled && Date.now() >= nextRunAt) {
            // Lease outlives the hard process deadline; killed/restarted workers must wait for expiry.
            const owner = await scheduler.acquireMonitoringLease(deadlineMs + 15_000, config.intervalSeconds * 1000);
            if (owner) {
              const running = cycle(owner);
              const heartbeat = setInterval(() => { scheduler.writeMonitoringHeartbeat().catch(() => {}); }, 5000);
              try { await running; } finally { clearInterval(heartbeat); }
              nextRunAt = Date.now() + config.intervalSeconds * 1000;
            }
          }
        } catch { console.error('[monitor] Worker unavailable; retrying safely'); }
        if (!stopping) await wait(5000);
      }
      await prisma.$disconnect();
    })().catch(() => process.exit(1));
  }
}
