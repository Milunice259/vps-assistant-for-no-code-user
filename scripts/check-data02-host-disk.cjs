const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function check(output,fail=false){const exports={};let calls=0;const code=ts.transpileModule(fs.readFileSync('src/lib/stats.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports,require:id=>id==='@/lib/local-server'?{execOnHost:cmd=>{assert.equal(cmd,'LC_ALL=C df -P -B1 /');calls++;if(fail)throw Error('unavailable');return output}}:id==='child_process'?{execSync:()=>''}:require(id),console,setInterval,clearInterval});const disk=exports.getHostStats().disk;assert.equal(calls,1);return disk;}
assert.equal(check('Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/root   1000   400   600 40% /').usagePercent,40);
assert.equal(check('invalid').total,0);assert.equal(check('',true).total,0);
console.log('PASS DATA-02 host filesystem dispatch, whitespace parser and unavailable fail-closed');
