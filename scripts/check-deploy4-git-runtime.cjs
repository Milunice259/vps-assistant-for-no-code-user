/* Private, explicitly synthetic owned repo; no production URL validator bypass. */
const assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const {load}=require('./check-deploy4-compose.cjs'),git=load('src/lib/ssh/deploy.ts');
const name='vps-deploy4-git-'+crypto.randomBytes(6).toString('hex');
const docker=(args,input)=>cp.execFileSync('docker',args,{encoding:'utf8',input,timeout:180000,maxBuffer:10*1024*1024});
const command=c=>docker(['exec',name,'sh','-c',c]);
async function main(){
 let created=false;
 try{
  docker(['run','-d','--privileged','--name',name,'--label','vps-panel.fixture=deploy4-git','docker:29-dind']);created=true;
  let ready=false;for(let i=0;i<60;i++){try{command('docker info >/dev/null 2>&1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}assert(ready,'private nested Engine readiness');
  // Load an already-installed image; never pull/install/build on the host Engine.
  cp.execFileSync('sh',['-c',`docker save docker:29-dind | docker exec -i ${name} docker load`],{timeout:180000,stdio:'pipe'});
  command("umask 077; mkdir -p /opt/git-fixture/repo && git init -q -b main /opt/git-fixture/repo && printf '%s\\n' 'FROM docker:29-dind' 'ENTRYPOINT []' 'CMD [\"sleep\",\"3600\"]' 'HEALTHCHECK --interval=1s CMD true' > /opt/git-fixture/repo/Dockerfile && git -C /opt/git-fixture/repo add Dockerfile && git -C /opt/git-fixture/repo -c user.name=fixture -c user.email=fixture@example.invalid commit -qm fixture");
  const url='https://github.com/panel-owned-fixture/git-runtime',repo='/opt/git-fixture/repo',target='/opt/git-fixture/target';
  const run=async c=>command(c.replace('GIT_CONFIG_GLOBAL=/dev/null git',`GIT_CONFIG_GLOBAL=/dev/null git -c protocol.file.allow=always -c 'url.file://${repo}.insteadOf=${url}'`));
  const input={repoUrl:url,branch:'main',customPath:target,serverId:'local'};
  const plan=await git.gitPreflight(run,input);
  const result=await git.deployGit(run,{...input,commitHash:plan.commitHash},async(r,i,source)=>{
   assert.equal(source.commitHash,plan.commitHash);
   command(`docker build -q -t owned-git-fixture:checked '${i.sourcePath}' >/dev/null && docker run -d --name owned-git-runtime owned-git-fixture:checked >/dev/null`);
   let inspect;for(let i=0;i<20;i++){inspect=JSON.parse(command('docker inspect owned-git-runtime'))[0];if(inspect.State.Health?.Status==='healthy')break;await new Promise(r=>setTimeout(r,500));}
   assert.equal(inspect.State.Status,'running');assert.equal(inspect.State.Health.Status,'healthy');assert.match(inspect.Image,/^sha256:[a-f0-9]{64}$/);
   assert.equal(JSON.parse(command(`docker image inspect '${inspect.Image}'`))[0].Id,inspect.Image);
   console.log('PASS nested Engine actual Git build/runtime/native image digest',source.commitHash,inspect.Image);
   return {success:true,status:'RUNNING',logs:'Private harness actual Git/build/runtime only; production route/state integration not claimed'};
  });
  assert.equal(result.status,'RUNNING');assert.equal(command("find /opt/git-fixture -maxdepth 1 -name '*panel-git*' -print").trim(),'');
 }finally{if(created)docker(['rm','-f','-v',name]);}
 assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']).trim(),'');console.log('PASS exact fixture Engine and anonymous-volume cleanup');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
