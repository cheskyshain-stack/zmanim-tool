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
  for(const date of ['2027-01-09','2026-09-19']) {
   await page.setViewportSize({width:1400,height:1200});
   const result=await page.evaluate(async(date)=>{
    const {renderWeek}=await import('/js/ui/week-view.js');
    const {loadPublished}=await import('/js/publish.js');
    const {excelSerial}=await import('/js/zmanim/solar.js');
    const state=await loadPublished({automatic:true});
    document.body.classList.remove('is-luach');
    const host=document.querySelector('main');
    renderWeek(host,state,()=>{},excelSerial(new Date(date+'T00:00:00Z')));
    await document.fonts.ready;await new Promise(r=>setTimeout(r,400));
    const card=host.querySelector('.is-shabbos-print');
    const rows=[...card.querySelectorAll('.week-line')].map(r=>r.innerText);
    const box=card.querySelector('.week-lines').getBoundingClientRect(),inner=card.querySelector('.week-lines-inner').getBoundingClientRect();
    return {rows,height:card.offsetHeight,overflow:inner.bottom>box.bottom+2,title:card.querySelector('.week-title').textContent};
   },date);
   if(result.overflow)throw Error('Print overflow '+date);
   if(result.height!==1056)throw Error('Page height '+result.height);
   assert(!/202[67]|January|September/.test(result.title));
   assert.equal(result.rows.length,date==='2027-01-09'?9:17);
   await page.emulateMedia({media:'print'});
   await page.evaluate(()=>window.scrollTo(0,0));
   const printed=await page.locator('.is-shabbos-print').evaluate(card=>{
    const box=card.querySelector('.week-lines').getBoundingClientRect();
    const inner=card.querySelector('.week-lines-inner').getBoundingClientRect();
    return {fits:inner.bottom<=box.bottom+2,underlines:card.querySelectorAll('u').length};
   });
   assert(printed.fits,'Printed rows must fit');assert(printed.underlines>0,'Keep minyan underlines');
   console.log(JSON.stringify({date,...result}));
   await page.locator('.is-shabbos-print').screenshot({path:path.resolve(__dirname,`../../print-${date}.png`)});
   await page.emulateMedia({media:'screen'});
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
