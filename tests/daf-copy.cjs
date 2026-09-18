const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+req.url.split('?')[0]);
 if(file!==root&&!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const origin='http://127.0.0.1:'+server.address().port;
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/donate/');await page.locator('.luach-daf-provider').first().waitFor({state:'attached'});
 const result=await page.evaluate(async()=>{
 const writes=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>writes.push(text)},configurable:true});
 const links=[...document.querySelectorAll('.luach-daf-provider')];
 for(const link of links){link.addEventListener('click',e=>e.preventDefault(),{once:true});link.click();await new Promise(r=>setTimeout(r,0));}
 if(writes.length!==4||writes.some(t=>t!=='26-4527675'))throw Error('Wrong clipboard data');
 if(!document.querySelector('.luach-daf-copy-status').textContent.startsWith('Tax ID copied'))throw Error('Missing feedback');
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('blocked')}},configurable:true});document.execCommand=()=>false;
 links[0].addEventListener('click',e=>e.preventDefault(),{once:true});links[0].click();await new Promise(r=>setTimeout(r,0));
 if(!document.querySelector('.luach-daf-copy-status').textContent.includes('blocked'))throw Error('False success');
 return 'All four providers copy the correct Tax ID; failure feedback works; provider links retain new-tab behavior.';
 });console.log(result);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

