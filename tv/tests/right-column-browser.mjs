import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';
const {chromium}=createRequire(import.meta.url)('playwright');
// Layout verification uses built assets and explicit private snapshots, without
// depending on a running Worker or reading/writing any database.
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/display/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');return;}
  const file=path.resolve(dist,'.'+pathname);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const screenshots=process.env.BOARD_SCREENSHOT_DIR;
const scale=Number(process.env.DISPLAY_TEST_SCALE)||1;
// Existing public text, rendered only in private development previews. No saves.
const notices=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
  .map(i=>({...i,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
const cases=['2026-09-08','2026-09-12','2026-09-13','2026-09-14','2027-09-28','2027-10-02','2027-10-03','2026-09-17','2027-04-11','2029-07-21','2026-11-10','2027-06-22','2028-04-26','2026-09-24','2026-09-26','2026-10-05','2026-10-15','2029-09-12','2032-09-08'];
// Published chart examples: Shuva, HaGadol, and Motzei Shabbos entering the
// postponed Tisha B'Av fast. These expected rows are independent of presentation.
const drashaExpectations={
 '2026-09-17':[{label:'מנחה',times:['1:40','4:45']},{label:'דרשה',times:['5:15']},{label:'מנחה',times:['6:14','6:29']}],
 '2027-04-11':[{label:'מנחה',times:['1:40','5:25']},{label:'דרשה',times:['5:55']},{label:'מנחה',times:['6:53','7:08']}],
 '2029-07-21':[{label:'דרשה',times:['8:55']},{label:'זמן 72',times:['9:33']},{label:'מעריב',times:['9:45']}],
};
const browser=await chromium.launch({channel:'chrome',headless:true});
const failures=[],results=[];
try{
 const page=await browser.newPage({viewport:{width:1920*scale,height:1080*scale}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/display/');
 await page.evaluate(async()=>{
  await document.fonts.load('700 28px David');await document.fonts.ready;
  const {DisplayView}=await import('/display-assets/renderer.js');
  document.body.innerHTML='<div id="audit" style="width:100vw;height:100vh"></div>';
  window.audit=new DisplayView(document.querySelector('#audit'));
 });
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const date of cases)for(const withNotices of [false,true])for(const theme of ['light','dark']){
  const at=date+'T16:00:00.000Z',schedule=scheduleSnapshot(at);
  const snapshot={at,schedule,items:withNotices?notices:[],upcoming:[],appearance:{mode:theme}};
  const r=await page.evaluate(async({snapshot,expectedDrashaRows})=>{
   const view=window.audit;view.update(snapshot,{preview:true,now:100000});
   await document.fonts.ready;
   const host=view.stage.querySelector('.original-sheet-host');if(host)await host.originalSheetReady;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const root=view.stage,rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const outside=(e,p)=>{const a=rect(e),b=rect(p);return a.left<b.left-2||a.top<b.top-2||a.right>b.right+2||a.bottom>b.bottom+2;};
   const overflow=[];
   const zoom=root.getBoundingClientRect().width/1920;
   for(const exception of root.querySelectorAll('.board-exception')){
    const previous=exception.previousElementSibling;
    if(previous&&rect(exception).top-rect(previous).bottom<13*zoom)overflow.push({exceptionGap:exception.textContent.slice(0,45)});
   }
   for(const panel of root.querySelectorAll('.board-weekly,.board-shabbos,.board-zmanim,.announcement-group')){
    if(panel.scrollHeight>panel.clientHeight+2||panel.scrollWidth>panel.clientWidth+2)overflow.push({panel:panel.className,extra:panel.scrollHeight-panel.clientHeight});
    for(const text of panel.querySelectorAll('.board-service,.board-day-section,.board-day-service,.board-schedule-row,.board-zmanim>div,h2,h3,h4,p'))if(outside(text,panel))overflow.push({text:text.className||text.tagName,content:text.textContent.slice(0,45)});
   }
   const weekdayIssues=[],normalize=value=>String(value||'').replace(/[\uE000\uE001\u2066-\u2069\u200E\u200F]/g,'').replace(/\s+/g,' ').trim();
   const drashaIssues=[],isDrasha=value=>/(?:דרשה|דרשת|דרשות|דברי התעוררות|Drasha)/i.test(value);
   for(const times of root.querySelectorAll('.board-times'))if(isDrasha(times.textContent))drashaIssues.push({inlineDrasha:normalize(times.textContent)});
   if(expectedDrashaRows){
    const rows=[...root.querySelectorAll('.board-shabbos .board-schedule-row')];
    const labels=rows.map(row=>normalize(row.querySelector('.board-prayer-label')?.textContent));
    const drashaIndices=labels.flatMap((label,index)=>isDrasha(label)?[index]:[]);
    if(drashaIndices.length!==1)drashaIssues.push({expectedDrashaRows:1,actual:drashaIndices.length});
    const start=drashaIndices[0]-expectedDrashaRows.findIndex(row=>isDrasha(row.label));
    for(const [offset,expected] of expectedDrashaRows.entries()){
     const row=rows[start+offset],label=labels[start+offset],times=row?.querySelector('.board-times');
     const actualTimes=times?.textContent.match(/\d{1,2}:\d{2}/g)||[];
     if(label!==expected.label||JSON.stringify(actualTimes)!==JSON.stringify(expected.times))drashaIssues.push({expected,actual:{label,times:actualTimes}});
     if(row&&row.querySelectorAll(':scope > .board-prayer-label').length!==1)drashaIssues.push({missingOwnLabel:expected.label});
     if(row&&row.querySelectorAll(':scope > .board-times').length!==1)drashaIssues.push({missingOwnTimes:expected.label});
    }
   }
   if(!snapshot.schedule.specialSheet){
    const patterns=[...root.querySelectorAll('[data-weekday-service]')];
    for(const service of snapshot.schedule.presentation.weekly.services)for(const group of service.groups.filter(g=>g.events.length))for(const day of group.days){
     const matches=patterns.filter(e=>e.dataset.weekdayService===service.name&&e.dataset.weekdayDates.split(',').includes(day.date));
     if(matches.length!==1)weekdayIssues.push({service:service.name,date:day.date,matches:matches.length});
     const source=group.events.find(e=>e.sourceText),fields=source?[source.sourceText]:group.events.flatMap(e=>[e.time,e.note]);
     for(const field of fields.filter(Boolean))if(!normalize(matches[0]?.textContent).includes(normalize(field)))weekdayIssues.push({service:service.name,date:day.date,missing:field});
     if(day.fastDay&&/גדליה/.test(day.label)&&!matches[0]?.closest('.board-day-section'))weekdayIssues.push({fastDayOutsideDailySection:day.date,service:service.name});
    }
   }
   const seen=new Map(),pages=Number(view.notices.dataset.pages)||0;
   const originalHost=host,originalPage=host?.shadowRoot.querySelector('.original-page'),fitCount=host?.originalSheetFitCount;
   for(let n=0;n<Math.max(1,pages);n++){
    if(n)view.update(snapshot,{preview:true,now:100000+n*300000});
    for(const section of view.notices.querySelectorAll('.announcement-section')){
     const id=section.dataset.sourceId,item=snapshot.items.find(i=>i.id===id);
     seen.set(id,section.textContent);
     for(const field of [item.title,item.data.message,item.data.contact,item.data.phone].filter(Boolean))if(!section.textContent.includes(field))overflow.push({missingField:id,field});
     for(const text of section.querySelectorAll('h3,p,bdi'))if(outside(text,section.closest('.announcement-group')))overflow.push({clippedNotice:id});
    }
   }
   for(let minute=1;minute<=5;minute++)view.update({...snapshot,at:new Date(Date.parse(snapshot.at)+minute*60000).toISOString(),appearance:{mode:minute%2?'light':'dark'},schedule:{...snapshot.schedule,clock:'changed'}},{preview:true,now:2000000+minute*60000});
   view.update(snapshot,{preview:true,now:2400000});
   const stable=!host||(host===root.querySelector('.original-sheet-host')&&originalPage===host.shadowRoot.querySelector('.original-page')&&fitCount===host.originalSheetFitCount);
   let sheetRows=0,expectedRows=0,rhTogether=true;
   if(host){
    sheetRows=host.shadowRoot.querySelectorAll('.onepage-row').length;
    const {originalSheetHTML}=await import('/display-assets/original-sheet.js');
    const t=document.createElement('template');t.innerHTML=originalSheetHTML(snapshot.schedule.specialSheet);
    expectedRows=t.content.querySelector('template').content.querySelectorAll('.onepage-row').length;
    if(snapshot.schedule.specialSheet.sourceId.startsWith('rh:')) {
     const cols=[...host.shadowRoot.querySelectorAll('.onepage-col')];
     rhTogether=cols[0].querySelectorAll('.onepage-row').length===expectedRows&&cols[1].children.length===0;
    }
    for(const e of host.shadowRoot.querySelectorAll('.onepage-row,.onepage-sec-head,.onepage-title'))if(outside(e,host))overflow.push({sheet:e.className});
   }
   const weekly=root.querySelector('.board-weekly'),right=root.querySelector('.board-shabbos,.original-sheet-box'),z=root.querySelector('.board-zmanim');
   return {classes:root.className,overflow,weekdayIssues,drashaIssues,warnings:view.warning,weekly:weekly&&rect(weekly),right:right&&rect(right),zmanim:rect(z),notices:rect(view.notices),footer:rect(root.querySelector('.tv-footer')),pages,seen:[...seen.keys()].sort(),stable,sheetRows,expectedRows,rhTogether,
    shabbosColumns:root.querySelectorAll('.board-static-column').length,sourceIds:[...root.querySelectorAll('.board-schedule-row')].map(e=>e.dataset.sourceId),theme:root.dataset.theme};
  },{snapshot,expectedDrashaRows:drashaExpectations[date]});
  const name=`${date} ${theme} notices=${withNotices}`;
  const check=(ok,what)=>{if(!ok)failures.push({name,what,result:r});};
  check(!r.overflow.length&&!r.warnings.length,'all content stays inside its panel');
  check(!r.weekdayIssues.length,'weekday dates and prayers match their source, with Gedalya in its daily section');
  check(!r.drashaIssues.length,'drasha has its own label and times row, preserving adjacent prayer times and order');
  if(['2026-09-14','2029-09-12','2032-09-08'].includes(date))check(!schedule.specialSheet&&!!r.weekly,'Gedalya uses the regular weekly panel');
  if(date==='2026-10-05')check(!schedule.specialSheet&&!!r.weekly,'the post-Sukkos weekday uses the regular weekly panel');
  if(date==='2029-07-21'&&withNotices)check(r.classes.includes('right-extended'),'the longer Tisha B’Av Shabbos uses the available height beside all notices');
  check(r.shabbosColumns===0,'Shabbos never splits into columns');
  check(r.pages===(withNotices?1:0),'all announcements remain visible together, including special schedules');
  check(!r.weekly||r.weekly.left>=r.zmanim.right&&r.right.left>=r.weekly.right,'weekday center, Shabbos/special right');
  check(r.right.right<=1893*scale&&r.right.bottom<=r.footer.top,'right panel inside screen');
  if(withNotices&&r.classes.includes('right-extended'))check(r.right.bottom>r.notices.top&&r.notices.right<=r.right.left,'right panel reclaims lower area without covering notices');
  if(schedule.specialSheet)check(r.sheetRows===r.expectedRows&&r.stable,'whole special page remains stable');
  else {
   check(r.pages===(withNotices?1:0),'ordinary announcements all remain visible on one screen');
   const ids=[...(schedule.presentation.special?.sections||[]),...(schedule.presentation.weekly.posterSections||[])].flatMap(s=>s.rows.map(r=>r.id)).sort();
   check(JSON.stringify([...r.sourceIds].sort())===JSON.stringify(ids),'all original schedule rows retained');
  }
  check(JSON.stringify(r.seen)===JSON.stringify(snapshot.items.map(i=>i.id).sort()),'all notices shown as complete groups across slots');
  check(r.theme===theme,'saved theme');
  check(r.rhTogether,'Erev and both Rosh Hashanah days stay in one continuous column');
  results.push({name,extended:r.classes.includes('right-extended'),rightHeight:r.right.height,pages:r.pages,overflow:r.overflow.length});
  if(screenshots&&withNotices&&theme==='dark')await page.screenshot({path:`${screenshots}/right-column-${date}${scale===2?'-4k':''}.png`});
 }
 const rotation=await page.evaluate(()=>{
  const v=window.audit,snapshot={...v.snapshot,items:[1,2].map(n=>({id:'development-dedication-'+n,kind:'dedication',startsAt:'2020-01-01T00:00:00.000Z',endsAt:null,data:{dedicationName:'Development preview '+n,anonymous:true,duration:35}}))};
  v.slots.clear();v.update(snapshot,{preview:true,now:3000000});const before=v.slots.get('dedication').id;
  v.update(snapshot,{preview:true,now:3036000});return before!==v.slots.get('dedication').id;
 });
 assert.ok(rotation,'Complete dedications still rotate');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({results,failures:failures.map(f=>({name:f.name,what:f.what,overflow:f.result.overflow,weekdayIssues:f.result.weekdayIssues,drashaIssues:f.result.drashaIssues,warnings:f.result.warnings,seen:f.result.seen}))},null,2));
 assert.equal(failures.length,0,'Right-column layout has failures listed above');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
