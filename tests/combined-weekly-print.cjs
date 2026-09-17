const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+req.url.split('?')[0]);
 if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1});
  const origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/week/?count=off');
  await page.locator('.weekly-reader').waitFor();
  await page.setViewportSize({width:1400,height:1100});
  await page.evaluate(async()=>{
    const {renderWeek}=await import('/js/ui/week-view.js');
    const {loadPublished}=await import('/js/publish.js');
    const {excelSerial}=await import('/js/zmanim/solar.js');
    document.body.classList.remove('is-luach');
    const host=document.querySelector('main'),state=await loadPublished({automatic:true});
    const draw=(serial)=>renderWeek(host,state,draw,serial);
    draw(excelSerial(new Date('2026-09-19T00:00:00Z')));
    const radio=host.querySelector('#week-layout-combined');radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));
    await document.fonts.ready;await new Promise(r=>setTimeout(r,500));
  });
  await page.emulateMedia({media:'print'});
  await page.locator('.week-pair').screenshot({path:path.resolve(__dirname,'../../combined-actual.png')});
  assert.equal(await page.locator('[name="week-layout"]').count(),2);
  assert.equal(await page.locator('[name="week-pages"], [name="week-order"]').count(),0);
  const size=await page.locator('.week-pair').evaluate(sheet=>({width:sheet.offsetWidth,height:sheet.offsetHeight}));
  assert.deepEqual(size,{width:1056,height:816});
  assert(await page.locator('.week-pair .is-weekday-card').count());
  assert(await page.locator('.week-pair .is-shabbos-print').count());
  await page.evaluate(()=>{const r=document.querySelector('#week-layout-charts');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('.week-pair').count(),0);
  assert.equal(await page.locator('.week-card').count(),2);
  console.log('Two options, combined landscape sheet and separate portrait pages verified.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
