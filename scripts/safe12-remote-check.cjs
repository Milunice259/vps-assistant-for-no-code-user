const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {load,fixture,mockCrypto}=require('./safe-env-recreate-regression.cjs');
const env=load('src/lib/env-profile.ts',{'@/lib/crypto':mockCrypto});
let exitCode=0,closed=0,commands=[];
const helper=load('src/lib/container-recreate.ts',{
 '@/lib/db':{prisma:{server:{findUnique:async()=>({host:'fixture.invalid',port:22,username:'fixture'})},appSetting:{findUnique:async()=>null}}},
 '@/lib/crypto':mockCrypto,'@/lib/env-profile':env,'@/lib/local-server':{isLocalServer:id=>id==='local'},
 '@/lib/ssh':{closeSSH:async()=>closed++,createSSHConnection:async()=>({spawn:async command=>{
 commands.push(command);const stream=new EventEmitter();stream.stderr=new EventEmitter();stream.close=()=>{};
 stream.end=data=>{assert.equal(data,'');setImmediate(()=>{stream.emit('data',Buffer.from(JSON.stringify(fixture)+'\n200'));stream.emit('exit',exitCode);stream.emit('close');});};return stream;
 }})}
});
(async()=>{
 const target=await helper.envTarget('discovered::remote::fixture');assert.equal(target.inspect.Id,fixture.Id);await target.api.close();
 assert(commands[0].includes('--unix-socket /var/run/docker.sock'));assert(!commands[0].includes('private-fixture'));
 exitCode=7;await assert.rejects(()=>helper.envTarget('discovered::remote::fixture'),/Engine command failed/);assert.equal(closed,2);
 console.log('SAFE12 mocked SSH Engine dispatch/nonzero exit checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
