const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Buffer,
    Error, // Match the constructor used by mock rejections and instanceof.
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const validation = load("src/lib/validation.ts");
const env = "API_KEY=SEC01_PLAIN_MARKER\nPASSWORD=SEC01_OTHER_MARKER";
const encoded = Buffer.from(env).toString("base64");
const completed = command => `(${command}) 2>&1 && printf '\\n__VPS_DEPLOY_OK__\\n'`;
const marker = '\n__VPS_DEPLOY_OK__\n';
const upload = completed(`echo "${encoded}" | base64 -d > "/opt/apps/check/.env"`);
const expected = [
  completed('mkdir -p "/opt/apps"'),
  'test -d "/opt/apps/check/.git" && echo "exists" || echo "missing"',
  completed('git clone --depth 1 --branch "main" "https://github.com/example/check.git" "/opt/apps/check" 2>&1'),
  'cd "/opt/apps/check" && git rev-parse --short HEAD 2>/dev/null',
  upload,
  'test -f "/opt/apps/check/docker-compose.yml" -o -f "/opt/apps/check/docker-compose.yaml" -o -f "/opt/apps/check/compose.yml" -o -f "/opt/apps/check/compose.yaml" && echo "found" || echo "none"',
  completed('cd "/opt/apps/check" && docker compose up -d --build 2>&1'),
  completed('cd "/opt/apps/check" && docker compose config --services'),
  completed('cd "/opt/apps/check" && docker compose ps --all --format json'),
];

async function check(failureKind) {
  const calls = [];
  const ssh = {};
  async function execute(connection, command) {
    assert.equal(connection, ssh);
    assert.equal(command, expected[calls.length], "Unexpected deployment command");
    calls.push(command);
    if (command === upload && failureKind) {
      const message = `Command failed: ${command}; stderr: ${env}`;
      throw failureKind === "error" ? new Error(message) : message;
    }
    return [marker, "missing", marker, "abc123\n", marker, "found", marker, "web" + marker, JSON.stringify([{ Service: "web", State: "running", Health: "healthy" }]) + marker][calls.length - 1];
  }
  const { remoteDeployViaSSH } = load("src/lib/ssh/actions.ts", {
    "./connection": { executeCommand: execute, executeCommandSafe: execute },
    "../validation": validation,
  });
  const result = await remoteDeployViaSSH(
    ssh, "https://github.com/example/check.git", "main", "/opt/apps/check", env,
  );
  assert.equal(result.success, !failureKind);
  assert.equal(result.commitHash, failureKind ? "" : "abc123");
  assert.deepEqual(calls, failureKind ? expected.slice(0, 5) : expected);
  for (const secret of [env, "SEC01_PLAIN_MARKER", "SEC01_OTHER_MARKER", encoded, upload, "base64 -d"]) {
    assert.ok(!result.logs.includes(secret), "Deployment logs must not expose environment upload data");
  }
  if (failureKind) {
    assert.ok(result.logs.endsWith("ERROR: Failed to write environment file."));
    assert.ok(!result.logs.includes("Environment file written."));
    assert.ok(!calls.some(command => command.includes("compose")), "Upload failure must stop before Compose");
  } else {
    assert.ok(result.logs.includes("Environment file written."));
    assert.equal(result.status, "RUNNING");
    assert.ok(result.logs.includes("running and healthy"));
  }
}

(async () => {
  await check("error");
  await check("string");
  await check(null);
  console.log("PASS: remote env upload errors sanitized; Compose blocked on failure; successful deployment preserved.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
