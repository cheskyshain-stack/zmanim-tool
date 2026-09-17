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
 const page=await context.newPage();await page.goto(origin+'/week/?count=off');await page.locator('.weekly-reader').waitFor();await page.evaluate(()=>document.fonts.ready);
const check=await page.evaluate(async()=>{
 const {weeklyAgenda,agendaSection,agendaDayKind}=await import('/js/ui/weekly-agenda.js');
 const {weeklyReaderData,readerWeekIndex,renderWeeklyReader}=await import('/js/ui/weekly-reader.js');
 const {buildAutomaticCharts}=await import('/js/publish.js');
 const {loadTables}=await import('/js/data-loader.js');
 const {resolveSettings}=await import('/js/settings.js');
 const {excelSerial}=await import('/js/zmanim/solar.js');
 const state=buildAutomaticCharts(await(await fetch('/data/published.json')).json(),await loadTables(),new Date('2026-09-16T12:00:00Z'));
 const settings=resolveSettings(state.settings),index=readerWeekIndex(state);
 const serial=excelSerial(new Date('2026-09-19T00:00:00Z'));
 const model=weeklyReaderData(serial,index,state,settings);
 const agenda=weeklyAgenda(model,serial,state,settings,new Date('2026-09-16T18:00:00Z'));
 const events=agenda.sections.flatMap(s=>s.events);
 if(agendaSection({name:'שקיעה'},serial-1,settings).title!=='Shabbos')throw Error('Shkia outside Shabbos');
 const shabbos=agenda.sections.find(s=>s.title==='Shabbos');
 if(!shabbos.events[0].earlyShabbos && !shabbos.events[0].name.includes('הדלקת'))throw Error('Shabbos must start with early Mincha or candle lighting');
 if(agenda.sections.find(s=>s.title==='Erev Shabbos').events.some(e=>e.earlyShabbos))throw Error('Early mincha left in Erev Shabbos');
 if(events.some(e=>e.serial<serial-3 || (e.serial===serial-3 && e.mins<840)))throw Error('Past time remains');
 if(events.filter(e=>e.next).length!==1)throw Error('Next marker');
 const future=weeklyAgenda(weeklyReaderData(serial+7,index,state,settings),serial+7,state,settings,new Date('2026-09-16T18:00:00Z'));
 if(future.sections.some(s=>s.events.some(e=>e.next)))throw Error('Future week has next marker');
 const phase=(name,day)=>agendaSection({name},day,settings).title;
 if(phase('מנחה ערב שבת',serial-1)!=='Erev Shabbos')throw Error('Erev Shabbos');
 if(phase('מנחה מעריב',serial-1)!=='Shabbos')throw Error('Combined Friday');
 if(phase('מעריב',serial)!=='Motzaei Shabbos')throw Error('Motzaei');
 let days=0;
 for(const week of index.keys()){
 if(week<serial-365 || week>serial+365)continue;
 const model=weeklyReaderData(week,index,state,settings);
 const a=weeklyAgenda(model,week,state,settings,new Date('2020-01-01T00:00:00Z'));
 const all=a.sections.flatMap(s=>s.events);
 for(const day of model.special){for(const e of day.events){if(!all.some(t=>t.serial===day.serial+Math.floor(e.mins/1440)&&t.mins===e.mins%1440&&t.name===e.name&&t.place===e.place))throw Error('Missing special time');} days++;}
 for(let d=week-6;d<=week;d++){
 const k=agendaDayKind(d,settings),n=agendaDayKind(d+1,settings);
 if(n.holy && phase('מעריב',d)!==n.holy)throw Error('Yom tov night');
 if(k.holy&&!n.holy&&phase('מעריב',d)!=='Motzaei '+k.holy)throw Error('Yom tov end');
 if(k.chol&&!k.holy&&!phase('שחרית',d).startsWith('Chol Hamoed'))throw Error('Chol hamoed');
 }
 }
 if(agendaSection({name:'מעריב',mins:0},serial-1,settings).title!=='Thursday')throw Error('Midnight Maariv pulled into Shabbos');
 const sample={regular:[{serial:serial-3,events:[{name:'שחרית',mins:600,place:''}]}],special:[],shabbos:[]};
 const atFive=weeklyAgenda(sample,serial,state,settings,new Date('2026-09-16T14:05:00Z')).sections.flatMap(s=>s.events);
 if(atFive.length!==1 || !atFive[0].started || atFive[0].next)throw Error('Five minute retention');
 if(weeklyAgenda(sample,serial,state,settings,new Date('2026-09-16T14:06:00Z')).sections.length)throw Error('Started minyan remains too long');
 const host=document.querySelector('#week-host');
 renderWeeklyReader(host,{showing:serial+7,index,state,settings,serials:[...index.keys()],onSerialChange:()=>{},title:'Audit',now:new Date('2026-09-16T18:00:00Z')});
 const titles=[...host.querySelectorAll('.reader-agenda-day > summary strong')].map(e=>e.textContent);
 if(titles.indexOf('Friday')<0 || titles.indexOf('Friday')>titles.findIndex(t=>t.includes('Shabbos')))throw Error('Friday out of order: '+titles);
 if(host.querySelector('.reader-next-badge'))throw Error('Future next badge');
 return {specialDays:days,sections:agenda.sections.map(s=>s.title)};
});console.log(check);
await page.reload();await page.locator('.weekly-reader').waitFor();
await page.locator('.reader-options summary').click();
for(const id of ['reader-next','reader-prev','reader-today']){await page.locator('#'+id).click();if(!await page.locator('.reader-options').evaluate(e=>e.open))throw Error('Options closed');}
await page.locator('.reader-agenda-day').evaluateAll(es=>es.forEach(e=>e.open=true));
for(const width of [320,393,768,1280]){
 await page.setViewportSize({width,height:900});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+width);
 await page.screenshot({path:path.resolve(__dirname,`../../agenda-${width}.png`),fullPage:true});
}

 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
