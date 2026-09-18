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
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const origin='http://127.0.0.1:'+server.address().port;
 const page=await browser.newPage({viewport:{width:393,height:852}});
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const width of [393,1280]) {
 await page.setViewportSize({width,height:852});
 for(const dest of ['week','donate']) {
 await page.goto(origin+'/?count=off');
 await page.locator('.luach-menu a[href="/'+dest+'/"]').click();
 const motion=await page.locator('#main').evaluate(e=>e.getAnimations({subtree:true}).length);
 if(!motion)throw Error('Missing opening animation '+dest);
 if(await page.locator('#main').evaluate(e=>e.getAnimations().length) || await page.locator('.luach-bar').evaluate(e=>e.getAnimations({subtree:true}).length))throw Error('Header must stay still');
 await page.waitForTimeout(420);
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow');
 if(new URL(page.url()).pathname!=='/'+dest+'/')throw Error('Wrong destination');
 }
 }
 for (const width of [320,393,1280]) {
 await page.setViewportSize({width,height:852});
 for(const dest of ['chart','schedules']) {
 await page.goto(origin+'/'+dest+'/?count=off');
 const back=page.locator('.luach-back[aria-label="Back to Weekly Zmanim"]');await back.waitFor();
 if(await back.getAttribute('href')!=='/week/')throw Error('Wrong back link');
 await back.click();await page.locator('.reader-schedule-links').waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Schedule overflow');
 }
 }
 await page.screenshot({path:path.resolve(__dirname,'../../schedule-nav.png')});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(origin+'/?count=off');await page.locator('.luach-menu a[href="/week/"]').click();
 if(await page.locator('#main').evaluate(e=>e.getAnimations({subtree:true}).length))throw Error('Reduced motion');
 console.log('Both pages animate on phone and desktop; reduced motion respected.');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});



