const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
class Response {
  constructor(body, status) { this.body = body; this.status = status; }
  static json(body, {status = 200} = {}) { return new Response(body, status); }
}
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, require: id => { assert(id in mocks, `Unmocked boundary: ${id}`); return mocks[id]; }, Error, Buffer, console}, {filename: file, timeout: 5000});
  return exports;
}
const calls = [];
let role = 'ADMIN', scope = true, signed = true, stack = 'docker-compose', target = null, status = 'UNVERIFIED', fail = false;
let helperFail=false, definitionFail=false, pending=false, git=false, logFail=false, definitionKind=null, definitionMissing=false, definitionTarget=null;
const routing={nativeLabelsVerified:true,routeReady:false,tlsReady:false};
const revision = 'a'.repeat(64), confirmation = 'ROLLBACK fixture', secret = 'PRIVATE_COMPOSE_SENTINEL';
const note = name => calls.push(name);
const prisma = {
  deploymentLog: {
    findUnique: async q => { note('projection'); assert.deepEqual(Object.keys(q.select).sort(), q.select.detectedStack ? ['detectedStack','serverId'] : ['serverId']); return {serverId: target, detectedStack: stack}; },
    create: async q => { note('create'); return {...q.data, id: 'fixture', createdAt: new Date(0)}; },
    update: async q => { note('update'); if(logFail) throw Error(secret); return {...q.data, id: 'fixture', createdAt: new Date(0), serverId: target}; },
  },
  server: {findUnique: async () => {note('server-secret'); return {id: target}; }},
};
const mocks = {
  'next/server': {NextResponse: Response},
  '@/lib/auth': {getSession: async () => role ? {sub: 'actor', role} : null},
  '@/lib/permissions': {can: (r, need) => ({VIEWER:0,OPERATOR:1,ADMIN:2,OWNER:3}[r] >= {VIEWER:0,OPERATOR:1,ADMIN:2}[need])},
  '@/lib/server-access': {canAccessServer: async () => {note('scope'); return scope;}},
  '@/lib/operation-safety': {ADVANCED_COOKIE: 'advanced', verifyAdvancedToken: async () => {note('signed'); return signed;}, requireSafeModeOff: (_, body) => body.safeModeOff === true ? null : Response.json({success:false}, {status:423})},
  '@/lib/db': {prisma},
  '@/lib/local-server': {isLocalServer: id => id === 'local', execOnHost: async () => {note('host'); return '';}, execLocal: async () => {note('local'); return '';}},
  '@/lib/server-ssh': {connectToServer: async () => {note('ssh'); return {ssh:{}};}},
  '@/lib/ssh': {executeCommand: async () => {note('remote-run'); return '';}, closeSSH: async ssh => {if (ssh) note('ssh-close');}},
  '@/lib/deploy-preflight': {validateDockerDeploy: () => null, dockerPreflight: async run => {note('image-preflight'); await run('docker info'); return {services:[]};}},
  '@/lib/image-deployment': {validateImageInput: () => {}, deployImage: async () => {note('image-deploy'); if(helperFail) throw Error(secret); return {status,containerId:'image-id',readiness:'unverified',routing};}},
  '@/lib/compose-deployment': {
    composePreflight: async (run, body, server) => {note('compose-preview'); assert(!('mode' in body)); assert(!('safeModeOff' in body)); assert.equal(server, body.serverId || 'local'); await run('read-only'); if(fail) throw Error(secret); return {services:['web'],risks:{builds:[],foreignBinds:[],externalVolumes:[],externalNetworks:[],recreate:false,directory:''},revision};},
    deployCompose: async (run, body, server, id) => {note('compose-deploy'); assert.equal(id, 'fixture'); assert.equal(body.composeRevision, revision); await run('native-helper'); if(fail || helperFail) throw Error(secret); return {containerIds:['container-id'],status,revision};},
    composeOperationPreview: async run => {note('recovery-preview'); await run('read-only'); return {pending:true,canAutomaticallyReconcile:false,revision};},
    composeRollbackPreview: async run => {note('rollback-preview'); await run('read-only'); if(fail) throw Error(secret); return {revision,confirmation,rollbackScope:'Configuration only; data and schema not restored'};},
    rollbackCompose: async (run, api, id, server, input) => {note('rollback'); assert.equal(input.revision,revision); assert.equal(input.confirmation,confirmation); if(fail) throw Error(secret); return {rolledBack:true,containerIds:['restored-id'],revision};},
  },
  '@/lib/container-recreate': {engine: async () => {note('engine'); return {call:async()=>{},close:async()=>note('engine-close')};}},
  '@/lib/git-deployment': {readGitSource:async()=>{note('source');return git?{pending:false}:null;},gitRollbackPreview:async()=>{note('git-preview');return {revision,confirmation};},rollbackGitCompose:async()=>{note('git-rollback');return {rolledBack:true,commitHash:'c'.repeat(40)};}},
  '@/lib/deployment-state': {readDeploymentDefinition:async()=>{note('definition');if(definitionFail)throw Error(secret);if(definitionMissing)return null;return {state:{serverId:definitionTarget || target || 'local',definition:{kind:definitionKind || (stack==='docker-image'?'image':'compose')},pending:pending?secret:undefined}};},deploymentFail: (message,statusCode=409) => {throw Object.assign(Error(message),{deploymentError:true,statusCode});}},
  '@/lib/deployment-lifecycle': {deploymentView:async()=>{note('view');return {kind:stack};}, imageLifecycle:async()=>{note('image-lifecycle');return {}; }},
  '@/lib/audit': {auditLog:async()=>note('audit'),getClientIp:()=>''},
};
const docker = load('src/app/api/deploy/docker/route.ts', mocks);
const lifecycle = load('src/app/api/deploy/[id]/route.ts', mocks);
assert.deepEqual(Object.keys(docker).sort(),['POST','dynamic']);
assert.deepEqual(Object.keys(lifecycle).sort(),['GET','POST','dynamic']);
const context = {params:Promise.resolve({id:'fixture'})};
const req = body => ({json:async()=>JSON.parse(JSON.stringify(body)),cookies:{get:()=>({value:'fixture-signed'})}});
const compose = {type:'compose',composeContent:secret,projectPath:'/srv/fixture',composeRevision:revision,composeConsent:{},safeModeOff:true};
const apply = {mode:'apply',action:'rollback',safeModeOff:true,revision,confirmation,dataCompatibility:'unchanged',schemaCompatibility:'operator-confirmed',writableLayerLoss:true};

const reset = () => {calls.length=0;role='ADMIN';scope=true;signed=true;stack='docker-compose';target=null;status='UNVERIFIED';fail=false;helperFail=false;definitionFail=false;pending=false;git=false;logFail=false;definitionKind=null;definitionMissing=false;definitionTarget=null;};
const noExecution = () => {for(const name of ['host','local','ssh','server-secret','engine','create','update','compose-preview','compose-deploy','rollback-preview','rollback','image-lifecycle','view','definition','source','git-preview','git-rollback']) assert(!calls.includes(name), name);};
const secretSafe = response => {assert(!JSON.stringify(response.body).includes(secret));assert(!JSON.stringify(response.body).includes(Buffer.from(secret).toString('base64')));};
(async () => {
  for (const route of [docker,lifecycle]) {
    for(const denied of ['anonymous','viewer','scope','unsigned','false','string']) {
      reset(); let body = route === docker ? {...compose} : {...apply};
      if(denied==='anonymous')role=null;if(denied==='viewer')role='VIEWER';if(denied==='scope')scope=false;if(denied==='unsigned')signed=false;if(denied==='false')body.safeModeOff=false;if(denied==='string')body.safeModeOff='true';
      const res=await route.POST(req(body),context);assert.equal(res.status,denied==='anonymous'?401:['viewer','scope'].includes(denied)?403:423);noExecution();
    }
  }
  reset();role='OPERATOR';assert.equal((await docker.POST(req({...compose,composeMode:'update',composeDeploymentId:'original'}))).status,403);noExecution();
  reset();signed=false;const preview=await docker.POST(req({...compose,mode:'preview',safeModeOff:false}));assert.equal(preview.status,200);assert(calls.includes('host'));assert(!calls.includes('local'));assert(!calls.includes('create'));assert(!calls.includes('compose-deploy'));secretSafe(preview);
  for(const ready of ['RUNNING','UNVERIFIED','FAILED']) {reset();status=ready;const res=await docker.POST(req({...compose,mode:'apply'}));assert.equal(res.body.success,ready==='RUNNING');assert.equal(res.body.data.status,ready);assert.equal(res.status,ready==='FAILED'?500:201);assert(calls.includes('compose-deploy'));assert(!calls.includes('image-deploy'));secretSafe(res);}
  reset();fail=true;secretSafe(await docker.POST(req(compose)));assert(!calls.includes('create'));
  reset();target='remote';const remote=await docker.POST(req({...compose,serverId:'remote'}));assert.equal(remote.status,201);assert(calls.includes('remote-run'));assert(calls.includes('ssh-close'));assert(!calls.includes('host'));
  reset();const image=await docker.POST(req({type:'image',image:'fixture:latest',safeModeOff:true}));assert.equal(image.status,201);assert(calls.includes('image-deploy'));assert(calls.includes('local'));assert(!calls.includes('compose-deploy'));
  reset();signed=false;const rollbackPreview=await lifecycle.POST(req({mode:'preview',action:'rollback'}),context);assert.equal(rollbackPreview.status,200);assert(!calls.includes('engine'));assert(!calls.includes('rollback'));assert(!calls.includes('update'));assert(!calls.includes('audit'));secretSafe(rollbackPreview);
  reset();signed=false;const recovery=await lifecycle.POST(req({mode:'preview',action:'recovery'}),context);assert.equal(recovery.status,200);assert.equal(recovery.body.data.canAutomaticallyReconcile,false);assert(calls.includes('recovery-preview'));assert(!calls.includes('engine'));assert(!calls.includes('update'));assert(!calls.includes('audit'));
  reset();assert.equal((await lifecycle.POST(req({...apply,action:'recovery'}),context)).status,400);assert(!calls.includes('recovery-preview'));
  for(const invalid of [{writableLayerLoss:false},{confirmation:'wrong'},{revision:'b'.repeat(64)},{dataCompatibility:undefined},{schemaCompatibility:'inferred'},{action:'update'}]) {reset();const res=await lifecycle.POST(req({...apply,...invalid}),context);assert([400,409].includes(res.status));assert(!calls.includes('engine'));assert(!calls.includes('rollback'));}
  reset();target='remote';const rollback=await lifecycle.POST(req(apply),context);assert.equal(rollback.status,200);assert.equal(rollback.body.data.readiness,'unverified');assert.equal(rollback.body.data.dataRestored,false);assert.equal(rollback.body.data.schemaRestored,false);for(const c of ['rollback','engine-close','ssh-close','update']) assert(calls.includes(c));secretSafe(rollback);
  reset();fail=true;secretSafe(await lifecycle.POST(req(apply),context));assert(!calls.includes('rollback'));
  reset();stack='docker-image';const legacyImage=await lifecycle.POST(req({mode:'preview'}),context);assert.equal(legacyImage.status,200);assert(calls.includes('image-lifecycle'));assert(!calls.includes('rollback-preview'));
  reset();scope=false;assert.equal((await lifecycle.GET(req({}),context)).status,403);noExecution();
  reset();role='VIEWER';assert.equal((await lifecycle.GET(req({}),context)).status,200);assert(calls.includes('view'));
  for(const type of ['compose','image']) for(const outcome of ['pending','unavailable','clear','log-failure','missing','target-drift']) {
    reset();helperFail=true;pending=outcome==='pending';definitionFail=outcome==='unavailable';logFail=outcome==='log-failure';definitionMissing=outcome==='missing';definitionTarget=outcome==='target-drift'?'other':null;
    const res=await docker.POST(req(type==='compose'?compose:{type:'image',image:'fixture:latest',safeModeOff:true}));
    assert.equal(res.body.uncertain,outcome!=='clear');assert.equal(res.body.pending,outcome==='pending'?true:['unavailable','target-drift','missing'].includes(outcome)?null:false);
    assert.equal(res.body.data.id,'fixture');assert.equal(res.body.data.status,outcome==='clear'?'FAILED':'UNVERIFIED');assert.equal(res.body.recovery.deploymentId,'fixture');secretSafe(res);
  }
  reset();status='RUNNING';const routed=await docker.POST(req({type:'image',image:'fixture:latest',safeModeOff:true}));assert.equal(routed.body.success,true);assert.deepEqual(routed.body.routing,routing);
  reset();stack='unknown';git=true;const gp=await lifecycle.POST(req({mode:'preview',action:'rollback'}),context);assert.equal(gp.status,200);assert(calls.includes('git-preview'));assert(!calls.includes('image-lifecycle'));assert(calls.indexOf('scope')<calls.indexOf('definition'));
  reset();git=true;const ga=await lifecycle.POST(req(apply),context);assert.equal(ga.status,200);assert(calls.includes('git-rollback'));assert(!calls.includes('rollback'));
  reset();stack='unknown';const cp=await lifecycle.POST(req({mode:'preview',action:'rollback'}),context);assert.equal(cp.status,200);assert(calls.includes('rollback-preview'));assert(!calls.includes('image-lifecycle'));
  reset();definitionKind='git';const nativeGit=await lifecycle.POST(req({mode:'preview',action:'rollback'}),context);assert.equal(nativeGit.status,200);assert(calls.includes('git-preview'));assert(!calls.includes('image-lifecycle'));
  for(const unavailable of ['missing','target-drift','unreadable']) {reset();definitionMissing=unavailable==='missing';definitionTarget=unavailable==='target-drift'?'other':null;definitionFail=unavailable==='unreadable';const res=await lifecycle.POST(req({mode:'preview',action:'rollback'}),context);assert([422,500].includes(res.status));assert(!calls.includes('engine'));assert(!calls.includes('rollback-preview'));assert(!calls.includes('image-lifecycle'));secretSafe(res);}
  console.log('DEPLOY4 Compose API actual-route offline checks PASS: guarded dispatch, read-only previews, native helper integration, exact rollback consent, truthful readiness, target runners, image preservation, secret-safe failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
