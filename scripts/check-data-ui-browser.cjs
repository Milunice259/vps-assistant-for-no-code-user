// Isolated acceptance server: real React pages; mocked auth/navigation/network only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const out = process.env.DATA_UI_BROWSER_DIR || '/root/.hermes/cache/scratch/data-ui-browser';
fs.mkdirSync(out, { recursive: true });
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from '${root}/src/app/(panel)/dashboard/page';
import Server from '${root}/src/app/(panel)/servers/[id]/page';
import Network from '${root}/src/app/(panel)/network/page';
import App from '${root}/src/app/(panel)/apps/[id]/page';
import {AppLogViewer} from '${root}/src/components/apps/AppLogViewer';
import {AppResourceChart} from '${root}/src/components/apps/AppResourceChart';
import {useSSE} from '${root}/src/hooks/useSSE';
window.sources=[];window.reads=[];window.pending=[];window.empty=false;window.hold=false;
window.EventSource=class {constructor(url){this.url=url;this.listeners={};window.sources.push(this)}addEventListener(k,f){this.listeners[k]=f}close(){this.closed=true}emit(k,data){this.listeners[k]?.({data:JSON.stringify(data)});if(k==='message')this.onmessage?.({data:JSON.stringify(data)})}};
const summary=()=>({servers:{total:window.empty?0:2,remote:window.empty?0:2,active:window.empty?0:2,inactive:0},apps:{total:0,running:0,stopped:0},deployments:{total:0,running:0,failed:0,recent:0},network:null});
window.summary=summary;
const server=id=>({id,name:'Server '+id,host:id+'.example',username:'tester',port:22,isActive:true});
const response=data=>({ok:true,json:async()=>({success:true,data})});
window.fetch=(url)=>{window.reads.push(url);const id=url.split('/')[3]?.split('?')[0];let data=[];
if(url==='/api/dashboard/summary')data=summary();
else if(url==='/api/servers')data=window.empty?[]:['A','B'].map(server);
else if(url==='/api/risk')data={score:100,label:'Healthy',servers:[],alerts:[]};
else if(/\\/servers\\/[^/]+$/.test(url))data=server(id);
else if(url.includes('/network'))data={hostPorts:[{protocol:'tcp',localAddress:'0.0.0.0',localPort:id==='A'?8101:8102,state:'LISTEN',process:'process-'+id}]};
else if(url.includes('/stats'))return Promise.resolve({ok:false,json:async()=>({success:false,error:'Mock metrics unavailable'})});
else if(url.includes('/logs?'))data={logs:'log-'+id};
else if(url.includes('/metrics?'))data={points:[]};
else if(/\\/apps\\/[^/]+\\?/.test(url))data={id,name:'App '+id,status:'RUNNING',appSource:'docker',serverId:id,containerId:id,image:'test:latest',ports:[],envVars:[],volumes:[],networks:[],metrics:[],createdAt:'2026-01-01T00:00:00Z'};
if(window.hold&&id==='A')return new Promise(resolve=>window.pending.push({url,resolve:()=>resolve(response(data))}));
return Promise.resolve(response(data));};
function Probe({id,enabled}){const r=useSSE('/probe/'+id+'/stream',{enabled,fallbackPollMs:50});return <output id="probe">{JSON.stringify(r)}</output>}
function Harness(){const [page,setPage]=useState('dashboard');const [id,setId]=useState('A');const [enabled,setEnabled]=useState(true);window.routeId=id;window.navigate=(value)=>{const parts=value.split('/');setId(parts.at(-1));setPage(parts[1]==='servers'?'server':'apps')};
return <><nav>{['dashboard','server','network','apps','logs','chart','probe'].map(p=><button data-page={p} key={p} onClick={()=>setPage(p)}>{p}</button>)}<button id="target-a" onClick={()=>setId('A')}>Target A</button><button id="target-b" onClick={()=>setId('B')}>Target B</button><button id="disable" onClick={()=>setEnabled(!enabled)}>Toggle SSE</button></nav><main>{page==='dashboard'?<Dashboard/>:page==='server'?<Server/>:page==='network'?<Network/>:page==='apps'?<App/>:page==='logs'?<AppLogViewer appId={id} appName={'App '+id} onClose={()=>setPage('apps')}/>:page==='chart'?<AppResourceChart key={id} appId={id} liveStats={null} metrics={[]} cpuLimit={null} memoryLimit={null} onRefresh={()=>{}}/>:<Probe id={id} enabled={enabled}/>}</main></>}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
const boundary = {
 'next/navigation': `export const useParams=()=>({id:window.routeId});export const useRouter=()=>({push:window.navigate,refresh:()=>{}});`,
 'next/link': `import React from 'react';export default function Link(p){return <a {...p}/>}`,
 'next/dynamic': `import React from 'react';export default function dynamic(loader){return function Dynamic(p){const [C,setC]=React.useState(null);React.useEffect(()=>{loader().then(m=>setC(()=>m.default||m))},[]);return C?<C {...p}/>:null}}`,
 '@/hooks/useAuth': `export const useAuth=()=>({user:{id:'mock',role:'ADMIN'},loading:false});`,
 '@/contexts/SafeModeContext': `export const useSafeMode=()=>({safeMode:true});`,
};
// Unexercised operational children are omitted, never represented as acceptance.
const omitted=['@/components/servers/network-map','@/components/servers/ServerForm','@/components/network/PackageManager','@/components/apps/AppEnvEditor','@/components/apps/AppSettings','@/components/apps/WebTerminal'];
for(const key of omitted) boundary[key]=`export const ${key.split('/').pop()==='network-map'?'ServerNetworkMap':key.split('/').pop()}=()=>null;`;
(async()=>{
 await require('esbuild').build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(out,'bundle.js'),bundle:true,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>boundary[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:boundary[a.path],loader:'tsx',resolveDir:root}))}}]});
 const css=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8');
 const result=await require('postcss')([require('tailwindcss')({...require(path.join(root,'tailwind.config.ts')).default,content:[path.join(root,'src/**/*.{ts,tsx}')] })]).process(css,{from:path.join(root,'src/app/globals.css')});
 fs.writeFileSync(path.join(out,'style.css'),result.css);
 http.createServer((req,res)=>{const file=req.url==='/bundle.js'?'bundle.js':req.url==='/style.css'?'style.css':null;res.setHeader('Content-Type',file==='bundle.js'?'text/javascript':file==='style.css'?'text/css':'text/html');res.end(file?fs.readFileSync(path.join(out,file)):'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#030712;padding:16px"><div id="root"></div><script src="/bundle.js"></script>');}).listen(Number(process.env.DATA_UI_BROWSER_PORT || 3116),'127.0.0.1',()=>console.log('Mock-boundary actual React acceptance ready'));
})().catch(e=>{console.error(e);process.exitCode=1});
