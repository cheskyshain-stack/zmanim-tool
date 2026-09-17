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
  const result=await page.evaluate(async()=>{
   const {weeklyReaderData,groupReaderSchedules,renderWeeklyReader,readerWeekIndex,remainingReaderDays}=await import('/js/ui/weekly-reader.js');
   const {buildAutomaticCharts}=await import('/js/publish.js');
   const {loadTables}=await import('/js/data-loader.js');
   const {resolveSettings}=await import('/js/settings.js');
   const {weekIndex}=await import('/js/sheets/rows.js');
   const {excelSerial}=await import('/js/zmanim/solar.js');
   const {buildTzomGedaliaPoster}=await import('/js/posters/tzomgedalia.js');
   const {buildRoshHashanaPoster}=await import('/js/posters/roshhashana.js');
   const {buildYomKippurPoster}=await import('/js/posters/yomkippur.js');
   const {buildSukkosPoster}=await import('/js/posters/sukkos.js');
   const {buildPesachPoster}=await import('/js/posters/pesach.js');
   const check=(v,m)=>{if(!v)throw Error(m);};
   const config=await(await fetch('/data/published.json')).json();
   const state=buildAutomaticCharts(config,await loadTables(),new Date('2026-09-16T12:00:00Z'));
   const settings=resolveSettings(state.settings),index=readerWeekIndex(state),serials=[...index.keys()].sort((a,b)=>a-b);
   const serial=excelSerial(new Date('2026-09-19T00:00:00Z'));
   const model=weeklyReaderData(serial,index,state,settings);
   const afterMidnight=remainingReaderDays(model,serial,settings,new Date('2026-09-16T04:00:00Z'));
   check(afterMidnight.regular.map(d=>d.label).join(',')==='Wednesday,Thursday,Friday','past weekdays remain');
   check(afterMidnight.special.length===0,'past special days remain');
   const beforeMidnight=remainingReaderDays(model,serial,settings,new Date('2026-09-16T03:59:59Z'));
   check(beforeMidnight.regular[0].label==='Tuesday','Lakewood midnight boundary incorrect');
   const saturday=remainingReaderDays(model,serial,settings,new Date('2026-09-19T12:00:00Z'));
   check(saturday.regular.length===0 && saturday.shabbos.every(r=>!r.friday),'Friday remains on Shabbos');
   const morning=groupReaderSchedules(model.regular,'morning');
   check(morning.length===2,'Selichos schedules not grouped');
   check(morning[0].days.join(',')==='Tuesday,Wednesday,Friday','baseline day labels');
   check(morning[1].change?.to.mins===380 && morning[1].change?.from.mins===385,'Thursday first minyan should change 6:25 to 6:20');
   check(groupReaderSchedules(model.regular,'mincha')[0].days.join(',')==='Tuesday,Wednesday,Thursday','special days leaked into ordinary Mincha');
   const key=e=>JSON.stringify([e.name,e.mins,e.place||'']);
   let checked=0;
   for(const year of [5786,5787,5788])for(const builder of [buildRoshHashanaPoster,buildYomKippurPoster,buildTzomGedaliaPoster,buildSukkosPoster,buildPesachPoster]){
    const poster=builder(year,settings);
    for(const day of [...new Set(poster.minyanim.map(e=>e.serial))]){
     const anchor=serials.find(s=>s>=day&&s-day<=6);
     check(anchor!=null,`missing week for ${builder.name} ${year} ${day}`);
     const weekly=weeklyReaderData(anchor,index,state,settings);
     const special=weekly.special.find(d=>d.serial===day);
     const regular=weekly.regular.find(d=>d.serial===day);
     const actual=special?.events||regular?.events||[];
     const expected=poster.minyanim.filter(e=>e.serial===day);
     for(const event of expected)check(actual.some(e=>key(e)===key(event)),`poster mismatch ${builder.name} ${year} ${day} ${key(event)}`);
     checked++;
    }
   }
   const host=document.querySelector('#week-host');
   const draw=s=>renderWeeklyReader(host,{showing:s??serial,index,state,settings,serials,onSerialChange:draw,now:new Date('2026-09-16T12:00:00Z'),title:'פרשת האזינו · שובה'});
   draw(serial);
   check(!host.querySelector('#reader-print'),'print button remains');
   check(host.querySelectorAll('.reader-shabbos').length===1 && host.querySelector('.reader-shabbos h3').textContent==='Shabbos','Shabbos should be one section');
   return {checkedPosterDays:checked,morningChanges:morning[1].change};
  });
  await page.evaluate(()=>document.fonts.ready);
  const widths=[];
  for(const width of [320,393,480,1280]){
   await page.setViewportSize({width,height:900});
   const sizes=await page.evaluate(()=>({screen:innerWidth,body:document.documentElement.scrollWidth,reader:document.querySelector('.weekly-reader').getBoundingClientRect().width,smallest:Math.min(...[...document.querySelectorAll('.reader-time')].map(e=>parseFloat(getComputedStyle(e).fontSize)))}));
   assert.ok(sizes.body<=width+1,`horizontal overflow at ${width}: ${sizes.body}`);widths.push(sizes);
   assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.reader-shabbos-row')].every(r=>r.firstElementChild.getBoundingClientRect().left>r.lastElementChild.getBoundingClientRect().left)),'Shabbos labels not on right');
   if(width===393||width===1280)await page.screenshot({path:path.resolve(__dirname,`../../weekly-${width}.png`),fullPage:true});
  }
  await page.locator('.reader-options summary').click();
  const before=await page.locator('.reader-heading p').textContent();
  await page.locator('#reader-next').click();assert.notEqual(await page.locator('.reader-heading p').textContent(),before);
  await page.locator('.reader-options summary').click();await page.locator('#reader-today').click();assert.equal(await page.locator('.reader-heading p').textContent(),before);
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('.reader-options').isVisible(),false);
  await page.pdf({path:path.resolve(__dirname,'../../weekly-print.pdf'),preferCSSPageSize:true,printBackground:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,widths,errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
