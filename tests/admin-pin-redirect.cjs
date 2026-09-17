const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{
 const url=req.url.split('?')[0];
 if(url==='/'||url==='/test.html'){res.setHeader('Content-Type','text/html');return res.end('<main id="main">Home</main>');}
 const file=path.resolve(root,'.'+url);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage();const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin+'/test.html');
 await page.evaluate(async()=>{const m=await import('/js/ui/lock.js');if(await m.tryPin('0000'))throw Error('Choose another invalid test PIN');m.closeLock();m.renderLock(document.querySelector('main'),()=>{throw Error('Wrong PIN opened admin');});});
 await page.keyboard.type('0000');await page.waitForURL(origin+'/');
 assert.equal(await page.evaluate(()=>localStorage.getItem('zmanim-admin-unlock')),null);
 await page.goto(origin+'/test.html');
 const source=fs.readFileSync(path.join(root,'js/ui/lock.js'),'utf8');
 const digest=source.match(/LOCK_PIN_HASH\s*=\s*'([a-f0-9]+)'/)[1];
 await page.evaluate(async(hash)=>{
 // Simulate a matching digest to exercise success without storing a real PIN in the test.
 Object.defineProperty(crypto.subtle,'digest',{value:async()=>Uint8Array.from(hash.match(/../g),v=>parseInt(v,16)).buffer});
 const m=await import('/js/ui/lock.js');m.renderLock(document.querySelector('main'),()=>document.querySelector('main').textContent='Opened');
 },digest);
 await page.keyboard.type('1234');await page.waitForFunction(()=>document.querySelector('main').textContent==='Opened');
 assert(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('zmanim-admin-unlock')).at));
 assert.equal(new URL(page.url()).pathname,'/test.html');
 console.log('Incorrect PIN redirects home without unlock; matching digest retains successful unlock.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
