import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';
import {inspectTimeColumns} from './helpers/time-column-checks.mjs';

const {chromium,webkit}=createRequire(import.meta.url)('playwright');
const engine=process.env.TIME_COLUMNS_BROWSER||'chromium',scale=Number(process.env.DISPLAY_TEST_SCALE)||1;
const boardOnly=process.env.TIME_COLUMNS_BOARD_ONLY==='1';
const selectedNames=(process.env.TIME_COLUMNS_CASES||'').split(',').map(name=>name.trim()).filter(Boolean);
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const writes=[],errors=[],results=[],failures=[];
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){writes.push(req.method+' '+req.url);res.writeHead(405).end();return;}
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/display/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');return;}
  const file=path.resolve(dist,'.'+pathname);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const notices=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
 .map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
const cases=['2027-04-11','2026-11-10','2029-07-21','2029-09-14','2029-05-13','2029-05-18',...(!boardOnly?['2026-09-24','2026-09-26','2028-09-20','2028-09-23','2028-09-24','2029-09-16']:[])]
 .map(date=>({name:date,date,schedule:scheduleSnapshot(date+'T16:00:00.000Z')}));
// Private development fixtures reuse saved times, labels and marks. These
// isolated subsets exercise balanced counts, not an alternative public schedule.
const base=scheduleSnapshot('2027-04-11T16:00:00.000Z');
const source=scheduleSnapshot('2026-09-24T16:00:00.000Z').presentation.weekly.services;
const maariv=source.find(service=>service.name==='מעריב').groups[0];
const sourceRows=base.presentation.special.sections.flatMap(section=>section.rows);
for(const count of [5,7,8,11]){
 const schedule=structuredClone(base),events=structuredClone(maariv.events.slice(0,count));
 const entries=events.map(event=>({text:event.time,underlined:/למטה/.test(event.place),mark:/אולם/.test(event.place)?'**':/בעזר/.test(event.place)?'*':''}));
 const named=sourceRows.find(row=>row.plagDetail)||sourceRows.find(row=>row.times.some(time=>time.name));
 const long=sourceRows.find(row=>row.label.length>17);
 schedule.specialSheet=null;
 schedule.presentation.special.title='תצוגה לדוגמה בלבד';
 schedule.presentation.special.sections=[{heading:'DEVELOPMENT ONLY',rows:[
  {...structuredClone(sourceRows[0]),id:'development:single',times:entries.slice(0,1)},
  {...structuredClone(long||sourceRows[0]),id:'development:long-label',times:entries.slice(0,2)},
  {...structuredClone(named||sourceRows[0]),id:'development:named'},
  {id:'development:balanced',label:'מעריב',times:entries,note:''},
 ]}];
 schedule.presentation.weekly.title='חול · תצוגה לדוגמה בלבד';
 schedule.presentation.weekly.posterSections=[];
 schedule.presentation.weekly.services=[{name:'מעריב',groups:[{...structuredClone(maariv),events}]}];
 cases.push({name:'development-balanced-'+count,date:'2027-04-11',schedule,count});
}
for(const name of selectedNames)assert.ok(cases.some(fixture=>fixture.name===name),`Unknown focused fixture ${name}`);
const selectedCases=selectedNames.length?cases.filter(fixture=>selectedNames.includes(fixture.name)):cases;
const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
try{
 const page=await browser.newPage({viewport:{width:1920*scale,height:1080*scale}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/display/`);
 await page.evaluate(async source=>{
  await document.fonts.load('700 28px David');await document.fonts.ready;
  const {DisplayView}=await import('/display-assets/renderer.js');
  document.body.innerHTML='<div id="audit" style="width:100vw;height:100vh"></div>';
  window.audit=new DisplayView(document.querySelector('#audit'));
  window.inspectTimeColumns=Function('return ('+source+')')();
 },inspectTimeColumns.toString());
 const screenshots=process.env.BOARD_SCREENSHOT_DIR;
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const fixture of selectedCases)for(const theme of ['dark','light']){
  const at=fixture.date+'T16:00:00.000Z';
  const snapshot={at,schedule:fixture.schedule,items:notices,upcoming:[],appearance:{mode:theme}};
  const result=await page.evaluate(async({snapshot,scale,boardOnly})=>{
   const view=window.audit;view.update(snapshot,{preview:true,now:100000});
   await document.fonts.ready;
   const host=view.stage.querySelector('.original-sheet-host');if(host)await host.originalSheetReady;
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const root=view.stage,{issues,metrics}=window.inspectTimeColumns(root,scale,{includeSheets:!boardOnly});
   const normalize=text=>String(text||'').replace(/[\s\uE000\uE001/]+/g,'');
   const rect=e=>e.getBoundingClientRect(),bounds=rect(root);
   for(const panel of root.querySelectorAll('.board-weekly,.board-shabbos,.board-zmanim,.announcement-group')){
    if(panel.scrollWidth>panel.clientWidth+2||panel.scrollHeight>panel.clientHeight+2)issues.push({code:'panel-overflow',panel:panel.className,height:panel.scrollHeight-panel.clientHeight,width:panel.scrollWidth-panel.clientWidth});
    const p=rect(panel);
    if(p.left<bounds.left-2||p.right>bounds.right+2||p.bottom>bounds.bottom+2)issues.push({code:'panel-outside-screen',panel:panel.className});
    const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);
    for(let node;(node=walker.nextNode());)if(node.textContent.trim()){
     const range=document.createRange();range.selectNodeContents(node);
     for(const r of range.getClientRects())if(r.left<p.left-2||r.right>p.right+2||r.top<p.top-2||r.bottom>p.bottom+2)issues.push({code:'text-outside-panel',panel:panel.className,text:node.textContent});
    }
   }
   const {boardSchedules}=await import('/display-assets/board-schedules.js');
   const template=document.createElement('template'),presentation=snapshot.schedule.presentation;
   const sheet=host?snapshot.schedule.specialSheet:null,both=sheet&&snapshot.at>=sheet.coversBothAt;
   template.innerHTML=both?'':boardSchedules({...presentation,special:sheet?null:presentation.special});
   const tokenSignature=container=>[...container.querySelectorAll('.board-time')].map(time=>({text:normalize(time.textContent),underlines:[...time.querySelectorAll('u')].map(u=>normalize(u.textContent))}));
   if(JSON.stringify(tokenSignature(template.content))!==JSON.stringify(tokenSignature(root)))issues.push({code:'board-source-time-marks-changed'});
   const rowSignature=container=>[...container.querySelectorAll('.board-schedule-row')].map(row=>({id:row.dataset.sourceId,text:normalize(row.textContent)}));
   if(JSON.stringify(rowSignature(template.content))!==JSON.stringify(rowSignature(root)))issues.push({code:'board-source-row-label-notes-changed'});
   if(host&&!boardOnly){
    const {originalSheetHTML}=await import('/display-assets/original-sheet.js');
    const original=document.createElement('template');original.innerHTML=originalSheetHTML(sheet);
    const signature=container=>[...container.querySelectorAll('.onepage-row')].map(row=>({text:normalize(row.textContent),underlines:[...row.querySelectorAll('u')].map(u=>normalize(u.textContent))}));
    if(JSON.stringify(signature(original.content.querySelector('template').content))!==JSON.stringify(signature(host.shadowRoot)))issues.push({code:'special-source-rows-marks-changed'});
    const h=rect(host);
    for(const row of host.shadowRoot.querySelectorAll('.onepage-row,.onepage-sec-head')){const r=rect(row);if(r.left<h.left-2||r.right>h.right+2||r.top<h.top-2||r.bottom>h.bottom+2)issues.push({code:'special-row-clipped',text:row.textContent});}
   }
   for(const notice of snapshot.items){
    const section=[...root.querySelectorAll('.announcement-section')].find(section=>section.dataset.sourceId===notice.id);
    for(const field of [notice.title,notice.data.message,notice.data.contact,notice.data.phone].filter(Boolean))if(!section?.textContent.includes(field))issues.push({code:'announcement-text',id:notice.id,field});
   }
   const runSignature=()=>[...root.querySelectorAll('.board-time-line')].map(line=>line.textContent);
   const originalPage=host?.shadowRoot.querySelector('.original-page'),fitCount=host?.originalSheetFitCount,before=runSignature();
   view.update(snapshot,{preview:true,now:160000});
   if(JSON.stringify(before)!==JSON.stringify(runSignature())||host&&(originalPage!==host.shadowRoot.querySelector('.original-page')||fitCount!==host.originalSheetFitCount))issues.push({code:'clock-reflowed-times'});
   return {issues,metrics,warnings:view.warning};
  },{snapshot,scale,boardOnly});
  if(fixture.count&&!result.metrics.timeCounts.includes(fixture.count))result.issues.push({code:'fixture-time-count-missing',count:fixture.count});
  results.push({name:fixture.name,theme,...result});
  if(result.issues.length)failures.push({name:fixture.name,theme,issues:result.issues});
  if(screenshots&&theme==='dark')await page.screenshot({path:path.join(screenshots,`${fixture.name}-${theme}.png`)});
 }
 const report={engine,scale,boardOnly,cases:results.length,results,failures,errors,writes};
 if(process.env.TIME_COLUMNS_REPORT)await writeFile(process.env.TIME_COLUMNS_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 assert.deepEqual(errors,[],'No browser errors');assert.deepEqual(writes,[],'No private fixture is saved');
 assert.equal(failures.length,0,'Shared time-column regressions are listed above');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
