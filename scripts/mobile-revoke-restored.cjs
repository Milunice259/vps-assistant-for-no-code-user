#!/usr/bin/env node
// Run while a restored COPY is isolated, before exposing its HTTP service.
// Dry-run by default. Never select a default database or an implicit live path.
const fs=require('node:fs');
const path=require('node:path');
const {PrismaClient}=require('@prisma/client');
const arg=process.argv.find(x=>x.startsWith('--restored-copy='));
if(!arg){console.error('Usage: node scripts/mobile-revoke-restored.cjs --restored-copy=/absolute/restored-copy.db [--apply]');process.exit(2);}
const file=arg.slice('--restored-copy='.length);
if(!path.isAbsolute(file)||!fs.statSync(file).isFile()){console.error('An explicit existing restored database copy is required');process.exit(2);}
const prisma=new PrismaClient({datasources:{db:{url:'file:'+file}}});
(async()=>{
 const count=await prisma.mobileDevice.count({where:{revokedAt:null}});
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({dryRun:true,activeDeviceRows:count}));return;}
 const result=await prisma.mobileDevice.updateMany({where:{revokedAt:null},data:{revokedAt:new Date(),tokenHash:null,pairingHash:null}});
 console.log(JSON.stringify({revokedDeviceRows:result.count,requiresPairing:true}));
})().catch(()=>{console.error('Restored mobile credential invalidation failed; keep restored service isolated');process.exitCode=1;}).finally(()=>prisma.$disconnect());
