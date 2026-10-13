/* Actual Git commands; URL rewrite exists only in this private runner harness. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {load,preflight}=require('./check-deploy4-compose.cjs');
const git=load('src/lib/ssh/deploy.ts');
async function main(){
 const parent=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'deploy4-git-'));fs.chmodSync(parent,0o700);
 const repo=path.join(parent,'fixture'),target=path.join(parent,'target');
 const sh=command=>cp.execFileSync('/bin/sh',['-c',command],{encoding:'utf8',timeout:120000});
 let mutations=0;
 try {
  fs.mkdirSync(repo);sh(`git init -q -b main '${repo}'`);fs.writeFileSync(path.join(repo,'Dockerfile'),'FROM scratch\n');sh(`git -C '${repo}' add Dockerfile && git -C '${repo}' -c user.name=fixture -c user.email=fixture@example.invalid commit -qm owned-fixture`);
  const pin=sh(`git -C '${repo}' rev-parse HEAD`).trim();
  const url='https://github.com/panel-owned-fixture/git-deploy';
  const run=async command=>{
   // Native shell, Git clone and commit pin are real. Docker/resource boundary is explicit mock in this source check.
   if(command.includes('docker info'))return '__PANEL_DEPLOY_EXIT_0__';
   if(command.includes('df -P'))return '1\n__PANEL_DEPLOY_EXIT_0__';
   if(command.includes('MemTotal'))return '90\n__PANEL_DEPLOY_EXIT_0__';
   command=command.replace('GIT_CONFIG_GLOBAL=/dev/null git',`GIT_CONFIG_GLOBAL=/dev/null git -c protocol.file.allow=always -c 'url.file://${repo}.insteadOf=${url}'`);
   return sh(command);
  };
  const input={repoUrl:url,branch:'main',customPath:target,serverId:'local'};
  const plan=await git.gitPreflight(run,input);assert.equal(plan.commitHash,pin);
  await assert.rejects(git.deployGit(run,{...input,commitHash:'0'.repeat(40)},async()=>{mutations++;}),/changed/);assert.equal(mutations,0);
  const result=await git.deployGit(run,{...input,commitHash:pin},async(r,i,source)=>{mutations++;assert.equal(source.originalCommit,null);assert.equal(sh(`git -C '${i.sourcePath}' rev-parse HEAD`).trim(),pin);assert.equal(fs.statSync(i.sourcePath).mode&0o777,0o700);return {success:false,status:'UNVERIFIED',logs:'Source-only check; no Engine deployment claimed'};});
  assert.equal(result.commitHash,pin);assert.equal(mutations,1);assert(!fs.existsSync(target));assert.deepEqual(fs.readdirSync(parent),['fixture']);
  for(const repoUrl of ['file:///owned','https://user:pass@github.com/o/r','https://github.com/o/r;true'])assert.throws(()=>git.validateGitDeploy({...input,repoUrl}));
  await assert.rejects(preflight.checked(async()=>sh('( false ) 2>&1; code=$?; printf "\\n__PANEL_DEPLOY_EXIT_%s__\\n" "$code"'),'false'));
  assert.equal(await preflight.checked(async command=>sh(command),'true'),'');
  assert.equal(await preflight.checked(async command=>sh(command),'printf git-progress >&2'),'git-progress');
  fs.chmodSync(parent,0o755);await assert.rejects(git.gitPreflight(run,input));fs.chmodSync(parent,0o700);
  console.log('PASS actual private Git clone/pin, fresh preflight, marker silent/stderr, hostile URLs, private parent, exact stage cleanup (Engine boundary mocked)');
 } finally {fs.rmSync(parent,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
