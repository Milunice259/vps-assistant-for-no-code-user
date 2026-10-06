// Mock-network browser fixture; actual React, TSX, preflight hook and Button. No app/DB/host API.
// Run: node scripts/check-flow-review-browser.cjs (stop with Ctrl-C; scratch removed on exit).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR, 'flow-review-browser-'));
for (const file of ['DockerImageDeploy.tsx', 'DockerComposeDeploy.tsx', 'useDeployPreflight.ts']) {
  const source = fs.readFileSync(path.join(root, 'src/components/deploy', file), 'utf8');
  fs.writeFileSync(path.join(scratch, file.replace(/\.tsx?$/, '.js')), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
}
fs.writeFileSync(path.join(scratch, 'Button.js'), ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/ui/Button.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
fs.writeFileSync(path.join(scratch, 'boundaries.js'), 'exports.useSafeMode=()=>({safeMode:false});exports.DeployRequirementBanner=()=>null;exports.FileBrowser=()=>null;');
fs.writeFileSync(path.join(scratch, 'entry.js'), `
const React = require('react');
const {createRoot} = require('react-dom/client');
const Component = location.search.includes('compose') ? require('./DockerComposeDeploy').DockerComposeDeploy : require('./DockerImageDeploy').DockerImageDeploy;
window.requests=[]; window.inspectFailure=true; window.confirm=()=>true;
window.fetch=async(url,options={})=>{
  requests.push({url,method:options.method||'GET'});
  if(url==='/api/servers')return {ok:true,json:async()=>({success:true,data:[{id:'remote-fixture',name:'Remote fixture',host:'fixture.invalid'}]})};
  if(url.endsWith('/preflight'))return {ok:true,json:async()=>({success:true,data:{ready:true,checks:[]}})};
  if(url==='/api/deploy/docker')throw Error('submitted response lost');
  if(window.inspectFailure)return {ok:false,json:async()=>({success:false})};
  if(url==='/api/deploy')return {ok:true,json:async()=>({success:true,data:[{id:'browser-fixture-log',repoUrl:location.search.includes('compose')?'compose:///opt/fixture-new':'docker://nginx',serverId:'remote-fixture',status:'UNVERIFIED',createdAt:new Date().toISOString()}]})};
  return {ok:true,json:async()=>({success:true,data:[{id:'browser-fixture-container',name:'possible-partial-container',image:'nginx',state:'running'}]})};
};
createRoot(document.getElementById('root')).render(React.createElement(Component,{onBusyChange:value=>{window.parentBusy=value;}}));
`);
webpack({ mode: 'development', devtool: false, entry: path.join(scratch, 'entry.js'), output: { path: scratch, filename: 'bundle.js' }, resolve: { modules: [path.join(root, 'node_modules')], alias: { '@/components/ui/Button': path.join(scratch, 'Button.js'), '@/contexts/SafeModeContext': path.join(scratch, 'boundaries.js'), '@/components/deploy/DeployRequirementBanner': path.join(scratch, 'boundaries.js'), '@/components/ui/FileBrowser': path.join(scratch, 'boundaries.js') } } }, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); fs.rmSync(scratch, { recursive: true, force: true }); process.exitCode=1; return; }
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLOW review mocked browser fixture</title><style>body{background:#111827;color:#eee;font:16px sans-serif;margin:16px}input,textarea{max-width:100%;box-sizing:border-box}button{min-height:44px}fieldset{border:0;padding:0;margin:0}button:disabled{opacity:.5}</style><div id="root"></div><script src="/bundle.js"></script>';
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(scratch,'bundle.js')):html);});
  server.listen(0,'0.0.0.0',()=>console.log('FLOW_BROWSER_PORT='+server.address().port+' SCRATCH='+scratch));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{fs.rmSync(scratch,{recursive:true,force:true});process.exit();}));
});
