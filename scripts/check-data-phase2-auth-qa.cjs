// Disposable authenticated API/browser fixtures; never a production DB/socket.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{PrismaClient}=require('@prisma/client'),{SignJWT}=require('jose');
const root=path.resolve(__dirname,'..'),dir='/root/.hermes/cache/scratch/vps-data2-auth-qa',base='http://127.0.0.1:18764';
(async()=>{fs.mkdirSync(dir,{recursive:true,mode:0o700});const secret=crypto.randomBytes(32).toString('hex');fs.writeFileSync(dir+'/env',`DATABASE_URL=file:/qa/fixture.db\nJWT_SECRET=${secret}\nENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}\n`,{mode:0o600});
const url='file:'+dir+'/fixture.db';execFileSync('node',['node_modules/prisma/build/index.js','db','push','--skip-generate'],{cwd:root,env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
const db=new PrismaClient({datasources:{db:{url}}});try{
for(const [id,role,mode]of [['owner','OWNER','ALL'],['remote','MANAGER','SELECTED'],['empty','MANAGER','SELECTED'],['viewer','VIEWER','SELECTED']])await db.user.upsert({where:{id},create:{id,username:id,role,serverAccessMode:mode,passwordHash:'!login-disabled-fixture'},update:{}});
for(const id of ['A','B'])await db.server.upsert({where:{id},create:{id,name:'Isolated '+id,host:'vps-data2-qa-engine',port:22,username:'root',authMethod:'KEY',isActive:true},update:{}});
for(const userId of ['remote','viewer'])for(const serverId of ['A','B'])await db.userServerAccess.upsert({where:{userId_serverId:{userId,serverId}},create:{userId,serverId},update:{}});
execFileSync('docker',['run','-d','--name','vps-data2-qa-panel','--env-file',dir+'/env','--network','vps-data2-qa-net','-v',dir+':/qa','-v','vps-data2-qa-socket:/var/run','-p','127.0.0.1:18764:3000','--entrypoint','node','vps-data-phase2-qa:workspace','server.js'],{stdio:'pipe'});
let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready,'QA readiness');
const sessions={};for(const [id,role]of [['owner','OWNER'],['remote','MANAGER'],['empty','MANAGER'],['viewer','VIEWER']])sessions[id]=await new SignJWT({username:id,role,forceLogoutVersion:0}).setProtectedHeader({alg:'HS256'}).setSubject(id).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(secret));
fs.writeFileSync(dir+'/sessions.json',JSON.stringify(sessions),{mode:0o600});console.log('READY authenticated session fixtures '+base+'; password login not tested');
}finally{await db.$disconnect()}})().catch(e=>{console.error(e.message);process.exitCode=1});
