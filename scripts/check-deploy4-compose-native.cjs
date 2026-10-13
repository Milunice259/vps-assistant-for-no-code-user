/* Exact disposable dind registry; never host/prod deploy, no prune. */
const assert=require('node:assert/strict'),cp=require('node:child_process');
const fixture='vps-deploy4-compose-check-'+require('node:crypto').randomUUID();
let fixtureId;
const {compose,preflight,logs,settings,load,prisma}=require('./check-deploy4-compose.cjs');
function host(args,options={}){return cp.execFileSync('docker',args,{encoding:'utf8',timeout:180000,...options});}
function run(command){const r=cp.spawnSync('docker',['exec','-i',fixture,'sh','-c',command],{encoding:'utf8',timeout:360000,maxBuffer:12000000});if(r.status!==0)throw Error('fixture-command failed: '+r.stderr);return Promise.resolve(r.stdout.trim());}
const api={async close(){},async call(method,url,body){const pid=JSON.parse(host(['inspect',fixture]))[0].State.Pid;return new Promise((resolve,reject)=>{const req=require('node:http').request({socketPath:`/proc/${pid}/root/var/run/docker.sock`,path:url,method,headers:{'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>res.statusCode<200||res.statusCode>=300?reject(Error('fixture Engine HTTP '+res.statusCode+': '+data)):resolve(data?JSON.parse(data):{}));});req.on('error',reject);req.end(body===undefined?'':JSON.stringify(body));});}};
async function main(){
 fixtureId=host(['run','-d','--privileged','--name',fixture,'--label','vps-panel.fixture=deploy4-compose','docker:29-dind','--host=unix:///var/run/docker.sock','--storage-driver=overlay2']).trim();
 for(let i=0;i<30;i++){try{await run('docker info >/dev/null');break;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,500));}}
 const labels=JSON.parse(host(['inspect',fixture]))[0].Config.Labels;
 assert.equal(labels['vps-panel.fixture'],'deploy4-compose');
 await run('docker info >/dev/null');
 // Read-only host image export, import only inside registered dind.
 const save=cp.spawn('docker',['save','node:20-alpine']);const restore=cp.spawn('docker',['exec','-i',fixture,'docker','load']);save.stdout.pipe(restore.stdin);await Promise.all([new Promise((r,j)=>save.on('exit',c=>c?j(Error('save')):r())),new Promise((r,j)=>restore.on('exit',c=>c?j(Error('load')):r()))]);
 await run('mkdir -p /opt/deploy4-compose-empty /opt/deploy4-compose-bind; printf durable > /opt/deploy4-compose-bind/value; docker volume create deploy4-compose-external; docker network inspect deploy4-compose-external-net >/dev/null 2>&1 || docker network create deploy4-compose-external-net');
 let body={type:'compose',serverId:'local',projectName:'deploy4-compose-native',projectPath:'/opt/deploy4-compose-empty',composeMode:'create',composeFiles:{Dockerfile:'FROM node:20-alpine\nVOLUME /anonymous\nCMD ["node", "-e", "setInterval(()=>{},1000)"]\n'},composeContent:'services:\n  web:\n    build: .\n    image: deploy4-compose-fixture:v1\n    environment:\n      FIXTURE_SECRET: private-runtime-check\n    healthcheck:\n      test: ["CMD", "node", "-e", "process.exit(0)"]\n      interval: 1s\n      timeout: 1s\n      retries: 2\n    volumes:\n      - /opt/deploy4-compose-bind:/data\n      - ext:/external\n    networks: [ext]\nvolumes:\n  ext: {external: true, name: deploy4-compose-external}\nnetworks:\n  ext: {external: true, name: deploy4-compose-external-net}\n'};
 body.composeConsent={directory:body.projectPath};
 let plan=await compose.composePreflight(run,body);body.composeRevision=plan.revision;body.composeConsent={directory:body.projectPath,builds:plan.risks.builds,foreignBinds:plan.risks.foreignBinds,externalVolumes:plan.risks.externalVolumes,externalNetworks:plan.risks.externalNetworks};
 logs.set('compose-create',{serverId:null});
 await assert.rejects(compose.deployCompose(run,{...body,composeRevision:'a'.repeat(64)},'local','bad-revision',api));assert(!settings.has('deployment:v1:bad-revision'));
 await assert.rejects(compose.deployCompose(run,{...body,composeConsent:{}},'local','bad-consent',api));assert(!settings.has('deployment:v1:bad-consent'));
 const create=await compose.deployCompose(run,body,'local','compose-create',api);assert.equal(create.containerIds.length,1);
 const state=load('src/lib/deployment-state.ts');const saved=await state.readDeploymentDefinition('compose-create');assert(!settings.get('deployment:v1:compose-create').includes('private-runtime-check'));assert.match(saved.state.definition.original.images[0].id,/^sha256:/);
 console.log('PASS native reviewed existing/create/build/bind/external + encrypted image identity');
 body={...body,composeMode:'update',composeDeploymentId:'compose-create',composeContent:body.composeContent.replace('private-runtime-check','private-runtime-update'),dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed'};
 plan=await compose.composePreflight(run,body);body.composeRevision=plan.revision;body.composeConsent={...body.composeConsent,recreate:true,writableLayerLoss:true};logs.set('compose-update',{serverId:null});
 const before=await state.readDeploymentDefinition('compose-create');
 await run('ln -s /opt/deploy4-compose-bind /opt/deploy4-compose-symlink');
 await assert.rejects(compose.composePreflight(run,{...body,projectPath:'/opt/deploy4-compose-symlink'}));
 await run('printf unreviewed > /opt/deploy4-compose-empty/unreviewed-file');
 await assert.rejects(compose.composePreflight(run,body));
 await run('rm /opt/deploy4-compose-empty/unreviewed-file');
 await assert.rejects(compose.composePreflight(run,{...body,serverId:'other'},'other'));
 await assert.rejects(compose.deployCompose(run,{...body,composeConsent:{...body.composeConsent,writableLayerLoss:false}},'local','loss-unreviewed',api));
 assert(!settings.has('deployment:v1:loss-unreviewed'));
 const update=await compose.deployCompose(run,body,'local','compose-update',api);assert.notEqual(update.containerIds[0],create.containerIds[0]);assert.equal(await run('cat /opt/deploy4-compose-bind/value'),'durable');
 const anonymousBefore=before.state.runtime.composeVersion.containers[0].Mounts.find(m=>m.Destination==='/anonymous').Name;
 const anonymousAfter=(await api.call('GET','/containers/'+update.containerIds[0]+'/json')).Mounts.find(m=>m.Destination==='/anonymous').Name;assert.equal(anonymousBefore,anonymousAfter);
 console.log('PASS native exact-revision update and bind data preservation');
 const preview=await compose.composeRollbackPreview(run,'compose-update','local');
 await assert.rejects(compose.rollbackCompose(run,api,'compose-update','local',{...preview,dataCompatibility:'',schemaCompatibility:''}));
 const rollback=await compose.rollbackCompose(run,api,'compose-update','local',{...preview,writableLayerLoss:true,dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed'});
 const inspect=await api.call('GET','/containers/'+rollback.containerIds[0]+'/json');assert(inspect.Config.Env.includes('FIXTURE_SECRET=private-runtime-check'));assert.equal(inspect.Image,saved.state.definition.original.images[0].id);assert.equal(await run('cat /opt/deploy4-compose-bind/value'),'durable');
 assert.equal(inspect.Mounts.find(m=>m.Destination==='/anonymous').Name,anonymousBefore);
 console.log('PASS native rollback pinned image, original environment/config and durable bind data');
 const afterRollback=await state.readDeploymentDefinition('compose-update');
 body={...body,composeDeploymentId:'compose-update',composeContent:require('js-yaml').dump((()=>{const d=require('js-yaml').load(afterRollback.state.definition.content);delete d.services.web.labels;d.services.web.environment.FIXTURE_SECRET='private-runtime-update-again';return d;})())};
 plan=await compose.composePreflight(run,body);body.composeRevision=plan.revision;body.composeConsent={...body.composeConsent,externalVolumes:plan.risks.externalVolumes};logs.set('compose-update-again',{serverId:null});
 const again=await compose.deployCompose(run,body,'local','compose-update-again',api);
 const active=JSON.parse(await run("docker ps -aq --filter label=com.docker.compose.project=deploy4-compose-native | xargs docker inspect"));assert.equal(active.length,1);assert.equal(active[0].Id,again.containerIds[0]);
 assert.equal(active[0].Mounts.find(m=>m.Destination==='/anonymous').Name,anonymousBefore);
 console.log('PASS native update-rollback-update: no duplicate active Compose labels; anonymous volume IDs pinned');
 // Missing anonymous volume is rejected before any current container is stopped.
 const priorAgain=(await state.readDeploymentDefinition('compose-update-again')).state.definition.previous;
 const volumeName=priorAgain.containers[0].Mounts.find(m=>m.Type==='volume').Name;
 const realRun=run;
 const missingVolume=async command=>{if(command.includes('docker volume inspect '+"'"+volumeName+"'"))throw Error('missing fixture volume');return realRun(command);};
 await assert.rejects(compose.composeRollbackPreview(missingVolume,'compose-update-again','local'));
 assert.equal((await api.call('GET','/containers/'+again.containerIds[0]+'/json')).State.Running,true);
 console.log('PASS missing original volume rejects read-only preview');
 const rp=await compose.composeRollbackPreview(run,'compose-update-again','local');
 const realCreate=prisma.appSetting.create;
 prisma.appSetting.create=async args=>{const r=await realCreate(args);if(args.data.key.startsWith('compose-operation:'))await run('printf stale >> /opt/deploy4-compose-empty/docker-compose.yml');return r;};
 await assert.rejects(compose.rollbackCompose(run,api,'compose-update-again','local',{...rp,writableLayerLoss:true,dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed'}));
 prisma.appSetting.create=realCreate;
 assert(![...settings.keys()].some(k=>k.startsWith('compose-operation:')));
 await run('printf %s '+preflight.quote(Buffer.from((await state.readDeploymentDefinition('compose-update-again')).state.definition.content).toString('base64'))+' | base64 -d > /opt/deploy4-compose-empty/docker-compose.yml');
 console.log('PASS native stale locked preview: no owned stranded lock');
 const replacedNetwork=async command=>{const out=await run(command);if(command.includes('docker network inspect')){const r=JSON.parse(out);r[0].Id='f'.repeat(64);return JSON.stringify(r);}return out;};
 await assert.rejects(compose.composeRollbackPreview(replacedNetwork,'compose-update-again','local'));
 console.log('PASS replaced original network identity rejects before stop (readback fault)');
 // Real native replacement, metadata commit fails atomically and leaves a read-only uncertain journal.
 const commitPreview=await compose.composeRollbackPreview(run,'compose-update-again','local');
 const realTransaction=prisma.$transaction;
 prisma.$transaction=async()=>{throw Error('fixture metadata commit unavailable');};
 await assert.rejects(compose.rollbackCompose(run,api,'compose-update-again','local',{...commitPreview,writableLayerLoss:true,dataCompatibility:'operator-confirmed',schemaCompatibility:'operator-confirmed'}));
 prisma.$transaction=realTransaction;
 const uncertain=await compose.composeOperationPreview(run,'compose-update-again','local');
 assert.equal(uncertain.pending,true);assert.equal(uncertain.workerActive,false);assert.equal(uncertain.canAutomaticallyReconcile,false);assert(uncertain.operation);
 await assert.rejects(compose.composeRollbackPreview(run,'compose-update-again','local'));
 const currentId=uncertain.containerIds[0];
 console.log('PASS native postreplacement commit fault: pending and exact operation lock retained, read-only journal');

}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{if(fixtureId){const exact=JSON.parse(host(['inspect',fixtureId]))[0];assert.equal(exact.Config.Labels['vps-panel.fixture'],'deploy4-compose');host(['rm','-fv',fixtureId]);assert.equal(host(['ps','-aq','--no-trunc','--filter','id='+fixtureId]).trim(),'');console.log('PASS exact registered dind cleanup');}});
