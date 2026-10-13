// Real Settings React page; explicit mocked auth/network only. Run then visit localhost:3117.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const out = '/root/.hermes/cache/scratch/conf-settings-browser';
fs.mkdirSync(out, { recursive: true });
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Settings from '${root}/src/app/(panel)/settings/page';
let saved={applicationName:'Fixture Panel',dockerRestartPolicy:'unless-stopped',dockerMemoryLimitMB:0,cleanupSchedule:'never',backupSchedule:'never',backupRetentionDays:30};window.calls=[];
window.fetch=async(url,opts={})=>{window.calls.push({url,method:opts.method||'GET'});if(url==='/api/settings/general'){if(opts.method==='PUT')saved=JSON.parse(opts.body);return {ok:true,json:async()=>({success:true,data:saved})}}return {ok:true,json:async()=>({success:true,data:url==='/api/notifications'?[]:null})}};
createRoot(document.getElementById('root')).render(<Settings/>);`;
const boundaries = {
 'next/navigation': `export const useRouter=()=>({refresh:()=>{}});`,
 'next/link': `import React from 'react';export default function Link(p){return <a {...p}/>}`,
 '@/hooks/useAuth': `export const useAuth=()=>({user:{id:'fixture',role:'ADMIN'},loading:false});`,
 '@/contexts/SafeModeContext': `export const useSafeMode=()=>({safeMode:true});`,
};
(async()=>{
 await require('esbuild').build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(out,'bundle.js'),bundle:true,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>boundaries[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:boundaries[a.path],loader:'tsx',resolveDir:root}))}}]});
 const configModule = { exports: {} };
 require('node:vm').runInNewContext(require('typescript').transpileModule(fs.readFileSync(path.join(root,'tailwind.config.ts'),'utf8'),{compilerOptions:{module:1,esModuleInterop:true}}).outputText,{module:configModule,exports:configModule.exports,require});
 const result=await require('postcss')([require('tailwindcss')({...configModule.exports.default,content:[path.join(root,'src/**/*.{ts,tsx}')]})]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
 fs.writeFileSync(path.join(out,'style.css'),result.css);
 http.createServer((req,res)=>{const file=req.url==='/bundle.js'?'bundle.js':req.url==='/style.css'?'style.css':null;res.setHeader('Content-Type',file==='bundle.js'?'text/javascript':file==='style.css'?'text/css':'text/html');res.end(file?fs.readFileSync(path.join(out,file)):'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:16px"><div id="root"></div><script src="/bundle.js"></script>');}).listen(3117,'0.0.0.0',()=>console.log('CONF Settings mocked-boundary browser ready :3117'));
})().catch(e=>{console.error(e);process.exitCode=1});
