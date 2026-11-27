const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {setTimeout:delay}=require("node:timers/promises");
const path=require("node:path");
assert.match(process.env.DATABASE_URL||"", /^file:\/tmp\/vps-mobile-ci-[^/]+\/fixture\.db$/);
const {prisma}=require("../scripts/monitoring-runtime/lib/db.js");
const bcrypt=require("bcryptjs");
const base="http://127.0.0.1:3199";
let child;
async function request(url,status,{method="GET",headers={},body}={}){
 const res=await fetch(base+url,{method,headers:{...headers,...(body!==undefined?{"Content-Type":"application/json"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:"manual",signal:AbortSignal.timeout(60_000)});
 assert.equal(res.status,status,method+" "+url+" status");
 return res;
}
(async()=>{
 const a=await prisma.server.create({data:{name:"HTTP allowed",host:"example.invalid",username:"mock"}});
 const b=await prisma.server.create({data:{name:"HTTP forbidden",host:"example.invalid",username:"mock"}});
 const password="Fixture-only-password-42!";
 await prisma.user.create({data:{username:"mobile-http-viewer",passwordHash:await bcrypt.hash(password,4),role:"VIEWER",serverAccessMode:"SELECTED",serverAccess:{create:{serverId:a.id}}}});
 child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3199"],{stdio:["ignore","ignore","ignore"],env:{...process.env,NEXT_TELEMETRY_DISABLED:"1",JWT_SECRET:"mobile-ci-fixture-only-no-production-secret"}});
 let ready=false;
 for(let i=0;i<45;i++){
   if(child.exitCode!==null)throw Error("Fixture web server exited");
   try{const res=await fetch(base+"/login",{signal:AbortSignal.timeout(5000)});if(res.status===200){ready=true;break}}catch{}
   await delay(1000);
 }
 assert.ok(ready,"Fixture HTTP server ready");
 const login=await request("/api/auth/login",200,{method:"POST",headers:{Origin:base},body:{username:"mobile-http-viewer",password}});
 const cookie=login.headers.getSetCookie().map(s=>s.split(";")[0]).find(s=>s.startsWith("vps-session="));
 assert.ok(cookie,"Fixture login cookie");
 const web={Cookie:cookie,Origin:base};
 const devices="/api/mobile/v1/devices",pair="/api/mobile/v1/pair",snap="/api/mobile/v1/snapshot";
 await request(devices,401);
 await request(devices,403,{method:"POST",headers:{Cookie:cookie},body:{label:"Phone",serverIds:[a.id]}});
 await request(devices,403,{method:"POST",headers:{Cookie:cookie,Origin:"https://cross-origin.invalid"},body:{label:"Phone",serverIds:[a.id]}});
 await request(devices,403,{method:"POST",headers:web,body:{label:"Phone",serverIds:[b.id]}});
 const issue=await request(devices,201,{method:"POST",headers:web,body:{label:"Phone",serverIds:[a.id]}});
 assert.match(issue.headers.get("cache-control")||"",/no-store/);
 const {id,code}=await issue.json();
 await request(pair,403,{method:"POST",headers:web,body:{code}});
 await request(pair,413,{method:"POST",body:{code:"x".repeat(1100)}});
 const redeem=await request(pair,200,{method:"POST",body:{code}});
 assert.equal(redeem.headers.get("set-cookie"),null);
 const {token}=await redeem.json();
 const auth={Authorization:"Bearer "+token};
 await request(pair,401,{method:"POST",body:{code}});
 await request(snap,401);
 await request(snap,403,{headers:{Cookie:cookie}});
 await request(snap,404,{method:"POST",headers:auth,body:{}});
 await request("/api/mobile/v1/unknown",404,{headers:auth});
 await request("/api/servers",401,{headers:auth});
 await request(devices,401,{headers:auth});
 const result=await request(snap,200,{headers:auth});
 assert.match(result.headers.get("cache-control")||"",/no-store/);
 const snapshot=await result.json();
 assert.deepEqual(snapshot.servers.map(s=>s.id),[a.id]);
 assert.equal(JSON.stringify(snapshot).includes("example.invalid"),false);
 await request(devices,200,{method:"DELETE",headers:web,body:{id}});
 await request(snap,401,{headers:auth});
 console.log("Mobile HTTP boundary, actual login, CSRF, pairing and revocation: PASS");
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(child){child.kill("SIGTERM"); await Promise.race([new Promise(resolve=>child.once("exit",resolve)),delay(3000)]);if(child.exitCode===null)child.kill("SIGKILL");}await prisma.$disconnect()});
