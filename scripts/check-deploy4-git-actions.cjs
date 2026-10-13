const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
async function test(body,{allowed=true,exists=true,role='ADMIN',preflight=false,status='RUNNING',pending=false,definitionPending=false,definitionTarget='local'}={}){
 const calls=[],m={exports:{}}; let captured;
 const log={id:'fixture',repoUrl:body.repoUrl,branch:'main',detectedStack:'unknown',status:'ANALYZED',logs:'',domain:null,serverId:null,commitHash:null,customPath:null,createdAt:new Date()};
 const risks={builds:['web'],foreignBinds:[],externalVolumes:[],externalNetworks:[],recreate:true,directory:null};
 const mocks={
 'next/server':{NextResponse:{json:(data,init={})=>({data,status:init.status||200})}},
 '@/lib/db':{prisma:{server:{findUnique:async()=>{calls.push('target');return exists?{}:null;}},deploymentLog:{create:async({data})=>{calls.push('log');Object.assign(log,data);return log;},update:async({data})=>Object.assign(log,data)}}},
 '@/lib/local-server':{execOnHost:async()=>{calls.push('host');return '';},execLocal:async()=>{throw Error('unexpected panel execution');}},
 '@/lib/git-deployment':{deployGitCompose:async(run,input)=>{calls.push('deploy');captured=input;return {success:status==='RUNNING',status,logs:'verified',commitHash:input.commitHash};},gitComposePreflight:async(_,input)=>{calls.push('compose-preview');captured=input;return {commitHash:input.commitHash,expectedCommit:input.expectedCommit,revision:'b'.repeat(64),composeRevision:'c'.repeat(64),services:['web'],risks,privateSecret:'must-not-return'};},readGitSource:async()=>{calls.push('source');return {source:{repoUrl:body.repoUrl,branch:'main',customPath:body.customPath,commitHash:preflight?'d'.repeat(40):body.commitHash},pending,secret:'must-not-return'};}},
 '@/lib/deployment-state':{readDeploymentDefinition:async()=>({state:{serverId:definitionTarget,pending:definitionPending}})},
 '@/lib/ssh/deploy':{validateGitDeploy:()=>{},gitPreflight:async(_,input)=>{calls.push('git-preview');return {commitHash:'a'.repeat(40),expectedCommit:input.expectedCommit};}},
 '@/lib/deployer':{prepareDeployment:()=>{calls.push('analysis');return {projectDir:'/private-fixture',detectedStack:'node',port:3000};},cleanupDeployDir:()=>calls.push('cleanup'),pruneOldDeployments:()=>{}},
 '@/lib/server-ssh':{connectToServer:async()=>{calls.push('ssh');throw Error('unexpected remote execution');}},
 '@/lib/deploy-preflight':{},'@/lib/ssh':{closeSSH:async()=>{}},
 '@/lib/validation':Object.fromEntries(['validateRepoUrl','validateBranch','validateDomain','validatePath'].map(k=>[k,()=>({valid:true})])),
 '@/lib/sanitize':{sanitizeLogs:v=>v},'@/lib/auth':{getSession:async()=>({sub:'fixture',role})},'@/lib/permissions':{can:(r,min)=>min==='ADMIN'?r==='ADMIN':r!=='VIEWER'},
 '@/lib/server-access':{canAccessServer:async()=>allowed},'@/lib/operation-safety':{requireSafeModeOff:(_,b)=>b.safeModeOff===true?null:{status:403,data:{success:false}}}
 };
 const file=preflight?'preflight/route.ts':'route.ts';
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/deploy',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{require:id=>{if(!(id in mocks))throw Error('Unmocked '+id);return mocks[id];},exports:m.exports,module:m,Error,console});
 return {response:await m.exports.POST({json:async()=>body}),calls,captured};
}
(async()=>{
 const base={repoUrl:'https://github.com/owned/fixture'};
 let r=await test({...base,action:'analyze',serverId:'remote',envVars:'unused'});assert.equal(r.response.status,201);assert.deepEqual(r.calls,['target','log','analysis','cleanup']);
 r=await test({...base,action:'analyze',serverId:'remote'},{exists:false});assert.equal(r.response.status,404);assert.deepEqual(r.calls,['target']);
 r=await test({...base,action:'analyze'},{allowed:false});assert.equal(r.response.status,403);assert.deepEqual(r.calls,[]);
 r=await test({...base,action:'unknown'});assert.equal(r.response.status,400);assert.deepEqual(r.calls,[]);
 r=await test({...base,action:'deploy'});assert.equal(r.response.status,403);assert.deepEqual(r.calls,[]);
 const deploy={...base,action:'deploy',safeModeOff:true,customPath:'/owned/project',serverId:'local'};
 r=await test(deploy);assert.equal(r.response.status,409);assert.deepEqual(r.calls,[]);
 r=await test(base);assert.equal(r.response.status,201);assert.deepEqual(r.calls,['log','analysis','cleanup']);
 const consent={builds:['web'],foreignBinds:[],externalVolumes:[],externalNetworks:[],recreate:true,writableLayerLoss:true};
 const update={...deploy,commitHash:'a'.repeat(40),expectedCommit:'d'.repeat(40),revision:'b'.repeat(64),composeDeploymentId:'previous',compose:{type:'compose',projectPath:deploy.customPath,serverId:'local',composeMode:'update',composeDeploymentId:'previous',composeConsent:consent,dataCompatibility:'unchanged',schemaCompatibility:'operator-confirmed'}};
 for(const options of [{role:'OPERATOR'},{role:'OPERATOR',preflight:true}]){
  r=await test(update,options);assert.equal(r.response.status,403);assert.deepEqual(r.calls,[]);
 }
 r=await test(update);assert.equal(r.response.status,201);assert.equal(r.response.data.data.detectedStack,'git-compose');assert.deepEqual(r.calls,['log','deploy','source']);assert.equal(r.response.data.data.pending,false);assert.equal(r.response.data.data.uncertain,false);assert.deepEqual(r.captured.compose.composeConsent,consent);assert.equal(r.captured.compose.schemaCompatibility,'operator-confirmed');
 for(const options of [{status:'UNVERIFIED'},{status:'UNVERIFIED',pending:true},{definitionPending:true},{definitionTarget:'other'}]){r=await test(update,options);assert.equal(r.response.status,options.status==='UNVERIFIED'?202:201);assert.equal(r.response.data.success,options.status!=='UNVERIFIED');assert.equal(r.response.data.data.pending,!!(options.pending||options.definitionPending||options.definitionTarget));assert.equal(r.response.data.data.uncertain,r.response.data.data.pending);}
 r=await test({...update,compose:{...update.compose,composeDeploymentId:'other'}});assert.equal(r.response.status,400);assert.deepEqual(r.calls,[]);
 r=await test(update,{preflight:true});assert.equal(r.response.data.data.ready,true);assert.deepEqual(r.calls,['source','git-preview','compose-preview']);const plan=r.response.data.data.gitPlan;assert.equal(plan.composeDeploymentId,'previous');assert.equal(plan.expectedCommit,'d'.repeat(40));assert.equal(plan.risks.recreate,true);assert.deepEqual(Array.from(plan.risks.builds),['web']);assert.equal(plan.composeRevision,'c'.repeat(64));assert(!JSON.stringify(r.response).includes('must-not-return'));
 console.log('PASS completed UNVERIFIED stays readiness-unverified with pending=false; source/definition pending and target mismatch retain uncertainty. PASS actual Git routes: analysis, target/safety denial, Admin-before-executor update, exact nested consent/compatibility forwarding, git-compose identity, structured secret-free managed preflight (persistence/executors mocked)');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
