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
 try{
 const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
 for (const mode of ['temporary','persistent','calendar']) {
 const page=await context.newPage();let tries=0;
 const target=mode==='calendar'?'**/data/parsha_chutz.json':'**/data/published.json';
 await page.route(target,route=>{tries++;return mode==='temporary'&&tries>1?route.continue():route.fulfill({status:503,body:'Unavailable'});});
 await page.goto(origin+'/?count=off');
 if(mode==='temporary')await page.locator('.luach-menu').waitFor();
 else {await page.getByRole('button',{name:'Try again',exact:true}).waitFor();if((await page.locator('body').innerText()).includes('Nothing has been published'))throw Error('Misleading error');}
 if(tries!==2)throw Error(mode+' retry count '+tries);
 console.log(mode+' passed');await page.close();
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
