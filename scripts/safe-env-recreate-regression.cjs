const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports, require: id => id in mocks ? mocks[id] : require(id), Buffer, URL, structuredClone, setTimeout, clearTimeout, console, Error, process}, {filename:file});
  return exports;
}
const mockCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: v => Buffer.from(v,'base64').toString()};
const env = load('src/lib/env-profile.ts', {'@/lib/crypto':mockCrypto});
const helper = load('src/lib/container-recreate.ts', {'@/lib/db':{prisma:{}}, '@/lib/env-profile':env, '@/lib/crypto':mockCrypto, '@/lib/local-server':{isLocalServer:id=>id==='local'}, '@/lib/ssh':{}});
const fixture = {Id:'a'.repeat(64), Image:'sha256:'+'b'.repeat(64), Name:'/fixture', Config:{Image:'tag', Cmd:['sh','-c','sleep 600'], Entrypoint:['/bin/sh','-e'], Env:['KEEP=a\nb', 'TOKEN=private-fixture'], Labels:{owner:'fixture'}, Healthcheck:{Test:['CMD','true']}, Hostname:'a'.repeat(12)}, HostConfig:{NetworkMode:'fixture-net', Memory:123456, NanoCpus:500000000, RestartPolicy:{Name:'no'}, PortBindings:{}, Binds:null, Mounts:[]}, Mounts:[{Type:'volume',Name:'fixture-volume',Destination:'/data',RW:true}], NetworkSettings:{Networks:{'fixture-net':{Aliases:['alias'],IPAMConfig:{IPv4Address:'172.30.1.10'}},extra:{Aliases:['extra']}}}, State:{Running:true,Status:'running'}};
const payload=helper.createPayload(fixture, ['KEEP=original']);
assert.deepEqual(JSON.parse(JSON.stringify(payload.Cmd)), fixture.Config.Cmd);
assert.deepEqual(JSON.parse(JSON.stringify(payload.Entrypoint)), fixture.Config.Entrypoint);
assert.deepEqual(JSON.parse(JSON.stringify(payload.Healthcheck)), fixture.Config.Healthcheck);
assert.equal(payload.Image, fixture.Image);
assert.equal(payload.HostConfig.Memory,123456);
assert.equal(payload.HostConfig.Mounts[0].Source,'fixture-volume');
assert.deepEqual(Object.keys(payload.NetworkingConfig.EndpointsConfig).sort(),['extra','fixture-net']);
assert.deepEqual(JSON.parse(JSON.stringify(payload.Env)),['KEEP=original']);
assert.throws(()=>helper.createPayload({...fixture,HostConfig:{...fixture.HostConfig,AutoRemove:true}}), /Unsupported/);
assert.throws(()=>helper.createPayload({...fixture,HostConfig:{...fixture.HostConfig,NetworkMode:'container:foreign'}}), /Unsupported/);
assert.equal(env.encodeEnvBaseline(['STRANGE.KEY=a\nb']).startsWith('enc:v1:'),true);
assert.deepEqual(JSON.parse(JSON.stringify(env.decodeEnvBaseline(env.encodeEnvBaseline(['STRANGE.KEY=a\nb'])))), ['STRANGE.KEY=a\nb']);
// Native Engine JSON object ordering is not configuration drift; arrays remain ordered.
assert.equal(helper.configurationHash({a:1,b:2}),helper.configurationHash({b:2,a:1}));
assert.notEqual(helper.configurationHash(['a','b']),helper.configurationHash(['b','a']));
const reordered={...fixture,NetworkSettings:{Networks:Object.fromEntries(Object.entries(fixture.NetworkSettings.Networks).reverse())}};
assert.deepEqual(JSON.parse(JSON.stringify(helper.createPayload(reordered,fixture.Config.Env))).NetworkingConfig.EndpointsConfig,JSON.parse(JSON.stringify(helper.createPayload(fixture,fixture.Config.Env))).NetworkingConfig.EndpointsConfig);
assert.throws(()=>env.decodeEncryptedVars(JSON.stringify({binding:'forged'})),/Authenticated/);
assert.deepEqual(JSON.parse(JSON.stringify(env.decodeEncryptedVars(env.encodeProfileVars({binding:'bound'})))),{binding:'bound'});
console.log('SAFE-01/02 actual-source payload/baseline/encrypted-only token checks passed');
module.exports={load,fixture,mockCrypto};
