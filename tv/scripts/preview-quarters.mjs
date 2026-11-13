import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {createOfflineSeed} from '../src/offline-seed.js';
import {DEFAULT_APPEARANCE} from '../public/display-assets/appearance.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const assets=resolve(root,'dist');
const harness=resolve(root,'scripts/preview-quarters');
const cache=resolve(root,'.wrangler/quarter-preview/public-seed.json');
const port=Number(process.argv[2]||8996);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port between 1024 and 65535.');
await stat(resolve(assets,'display-assets/renderer.js')).catch(()=>{throw Error('Build the TV assets first: node scripts/build.mjs');});

let published,source;
try{
  const response=await fetch('https://baismedrashoflakewoodcommons.org/api/display/offline',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Public seed unavailable');
  published=await response.json();
  if(published.schema!==1||!Array.isArray(published.items))throw Error('Unexpected public seed');
  source='Current published content';
  await mkdir(resolve(root,'.wrangler/quarter-preview'),{recursive:true});
  await writeFile(cache,JSON.stringify(published));
}catch{
  try{
    published=JSON.parse(await readFile(cache,'utf8'));
    source='Saved public content';
  }catch{
    const items=JSON.parse(await readFile(resolve(root,'tests/fixtures/current-public-announcements.json'),'utf8'));
    published={items:items.map(item=>({...item,status:'published'})),appearance:DEFAULT_APPEARANCE};
    source='Recorded public content';
  }
}
const seed=createOfflineSeed(published.items,published.appearance||DEFAULT_APPEARANCE);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/seed.json'){
      res.setHeader('Content-Type',types['.json']);
      res.end(JSON.stringify({seed,source}));return;
    }
    let file;
    if(pathname==='/')file=resolve(harness,'index.html');
    else if(pathname==='/preview.js'||pathname==='/preview.css')file=resolve(harness,pathname.slice(1));
    else if(pathname.startsWith('/display-assets/')||pathname.startsWith('/tv/icons/')){
      file=resolve(assets,decodeURIComponent(pathname.slice(1)));
      if(!file.startsWith(assets+sep)){res.writeHead(403).end();return;}
    }else{res.writeHead(404).end();return;}
    const body=await readFile(file);
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Quarter layout preview: http://127.0.0.1:${port}/\n${source}. Local preview only; no analytics, service worker, or publishing.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
