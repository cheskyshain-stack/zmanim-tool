const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+req.url.split('?')[0]);
 if(!file.startsWith(root+path.sep)&&file!==root)return res.writeHead(403).end();
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
(async()=>{
 const load=name=>import(pathToFileURL(path.join(repo,'js',name)));
 const [{buildAutomaticCharts},{resolveSettings},{candleLightingForDay},{excelSerial},{websitePreviewInstant}]=await Promise.all(['publish.js','settings.js','upcoming.js','zmanim/solar.js','website-clock.js'].map(load));
 const read=name=>JSON.parse(fs.readFileSync(path.join(repo,'data',name+'.json'),'utf8'));
 const state=buildAutomaticCharts(read('published'),{parshaChutz:read('parsha_chutz'),parshaEY:read('parsha_ey'),parshaNames:read('parsha_names'),specialDays:read('special_days')},new Date('2026-11-20T17:00:00Z'));
 const settings=resolveSettings(state.settings),serial=excelSerial(new Date('2026-11-20T00:00:00Z'));
 const candle=candleLightingForDay(serial,state,settings);
 assert.ok(candle);
 const time=String(Math.floor(candle.mins/60)).padStart(2,'0')+':'+String(candle.mins%60).padStart(2,'0');
 const instant=websitePreviewInstant('2026-11-20',time,'America/New_York').instant.getTime();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const width of [393,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
   await page.addInitScript(()=>localStorage.setItem('zmanim-nocount','1'));
   await page.clock.install({time:new Date(instant-600000)});
   await page.goto(origin+'/?count=off');
   const label=page.locator('.luach-next-box.is-candles .luach-next-countdown');
   await label.waitFor();
   const text=async()=> (await label.textContent()).replace(/\u00a0/g,' ');
   assert.equal(await text(),'10:00');
   assert.equal(await label.evaluate(el=>getComputedStyle(el).color),'rgb(180, 35, 24)');
   await page.clock.runFor(1000);
   assert.equal(await text(),'9:59');
   await page.clock.fastForward(600000);
   assert.equal(await text(),'0:01 ago');
   await page.clock.runFor(1000);
   assert.equal(await text(),'0:02 ago');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
   await page.clock.fastForward(1497000);
   assert.equal(await text(),'24:59 ago');
   await page.clock.runFor(1000);
   assert.equal(await page.locator('.luach-next-box.is-candles').count(),0);
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('Candle seconds passed on phone and desktop: red ten-minute countdown, one-second updates, elapsed seconds, 25-minute removal.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
