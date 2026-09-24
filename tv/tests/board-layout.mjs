import { scheduleSnapshot } from '../src/schedules.js';
import { groupAnnouncements } from '../public/display-assets/announcements.js';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.BOARD_TEST_ORIGIN || 'http://127.0.0.1:8795';
const screenshots = process.env.BOARD_SCREENSHOT_DIR;
const issues = [];
const check = (condition, message, details) => { if (!condition) issues.push({ message, details }); };
const sameIds = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
// Read-only capture of the current public notices, used only in local browser
// previews. Move starts back for pre-publication layout dates without saving it.
const notices = JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')).map(item=>({...item,startsAt:'2020-01-01T00:00:00Z'}));
const expectedGroups = groupAnnouncements(notices);
// Clearly labeled dedication fixtures: never saved or published.
const dedications=[1,2].map(i=>({id:`development-dedication-${i}`,kind:'dedication',title:'DEVELOPMENT DEDICATION',startsAt:'2020-01-01T00:00:00Z',endsAt:null,data:{anonymous:true,dedicationType:'לזכות',dedicationName:`תצוגה לדוגמה ${i}`,dedicationText:'Development preview only',message:'',duration:25}}));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.route(origin+'/admin/display/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><title>Private browser regression</title><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>'}));
 await page.goto(origin+'/admin/display/');await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(async()=>{const {DisplayView}=await import('/display-assets/renderer.js');document.body.innerHTML='<div id="board-audit" style="width:100vw;height:100vh"></div>';window.boardAuditView=new DisplayView(document.querySelector('#board-audit'));});
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const date of ['2026-09-19','2026-09-24','2026-09-26','2026-10-15']){
  const at=date+'T16:00:00Z',schedule=scheduleSnapshot(at);
  for(const theme of ['light','dark']){
   const snapshot={at,schedule,items:[...notices,...dedications],upcoming:[],appearance:{mode:theme}};
   const result=await page.evaluate(async snapshot=>{
    const v=window.boardAuditView;v.update(snapshot,{preview:true,now:100000});const root=v.stage;
    await document.fonts.ready;
    const host=root.querySelector('.original-sheet-host');
    if(host)await host.originalSheetReady;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const outside=(e,c)=>{const r=rect(e),b=rect(c);return r.left<b.left-2||r.right>b.right+2||r.top<b.top-2||r.bottom>b.bottom+2;};
    const overflow=[];
    for(const e of root.querySelectorAll('.board-week-body,.board-shabbos-body,.board-notices,.board-zmanim,.announcement-group,.board-dedication .tv-card')){
     if(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)overflow.push({className:e.className,title:e.querySelector('h2')?.textContent,vertical:e.scrollHeight-e.clientHeight,horizontal:e.scrollWidth-e.clientWidth});
    }
    // Check actual text bounds: overflow:hidden must not disguise clipped text.
    for(const card of root.querySelectorAll('.announcement-group,.board-dedication .tv-card'))for(const body of card.querySelectorAll('h2,h3,p,.contact')){
     if(getComputedStyle(body).display!=='none'&&outside(body,card))overflow.push({className:card.className,title:card.querySelector('h2')?.textContent,clippedBody:body.className||body.tagName,body:rect(body),card:rect(card)});
    }
    // A body can expand outside its constrained panel without scroll overflow.
    for(const body of root.querySelectorAll('.board-week-body,.board-shabbos-body')){
     if(outside(body,body.parentElement))overflow.push({className:body.className,outsideParent:true});
     for(const child of body.children)if(outside(child,body.parentElement))overflow.push({className:child.className,outsideSchedulePanel:true});
    }
    const sheet=root.querySelector('.original-sheet-box'),shadow=host?.shadowRoot,weekly=root.querySelector('.board-weekly'),right=root.querySelector('.board-shabbos,.original-sheet-box'),zmanim=root.querySelector('.board-zmanim'),footer=root.querySelector('.tv-footer');
    const normalized=text=>String(text||'').replace(/[\s/]+/g,'');
    // Compare every original rendered row, including notes, reckoning names,
    // underlining and asterisks. The page's measurement may move rows between
    // columns, but it must never drop or rewrite any source information.
    const signature=row=>JSON.stringify({label:normalized(row.querySelector('.onepage-label')?.textContent),times:normalized(row.querySelector('.onepage-times')?.textContent),underlines:[...row.querySelectorAll('u')].map(e=>normalized(e.textContent)),pairs:[...row.querySelectorAll('.zman-pair')].map(e=>normalized(e.textContent))});
    let expectedRows=[],expectedTitle='';
    if(snapshot.schedule.specialSheet){
     const {originalSheetHTML}=await import('/display-assets/original-sheet.js');
     const expected=document.createElement('template');expected.innerHTML=originalSheetHTML(snapshot.schedule.specialSheet);
     const original=expected.content.querySelector('template.original-sheet-content').content;
     expectedRows=[...original.querySelectorAll('.onepage-row')].map(signature);
     expectedTitle=normalized(original.querySelector('.onepage-title')?.textContent);
    }
    if(shadow){
     for(const e of shadow.querySelectorAll('.onepage-cols,.onepage-col,.onepage-row')){
      if(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)overflow.push({className:e.className,vertical:e.scrollHeight-e.clientHeight,horizontal:e.scrollWidth-e.clientWidth});
      if(outside(e,sheet))overflow.push({className:e.className,outsideSheet:true,rect:rect(e),sheet:rect(sheet)});
     }
     for(const text of shadow.querySelectorAll('.onepage-row .onepage-label,.onepage-row .onepage-times')){
      if(outside(text,sheet))overflow.push({className:text.className,outsideSheet:true,text:text.textContent,rect:rect(text),sheet:rect(sheet)});
     }
    }
    // Inspect every rotation slot: each group must appear once, with every
    // saved section intact and fitting inside the space beside the schedule.
    const noticeSections=[],groups=[],pages=Number(v.notices.dataset.pages)||0;
    for(let page=0;page<Math.max(1,pages);page++){
     if(page)v.update(snapshot,{preview:true,now:100000+page*300000});
     for(const card of v.notices.querySelectorAll('.announcement-group')){
      groups.push({id:card.dataset.announcementGroup,sourceIds:[...card.querySelectorAll('.announcement-section')].map(section=>section.dataset.sourceId)});
      if(outside(card,v.notices)||card.scrollHeight>card.clientHeight+2||card.scrollWidth>card.clientWidth+2)overflow.push({page,group:card.dataset.announcementGroup,overflow:true});
      for(const body of card.querySelectorAll('h2,h3,p,bdi'))if(outside(body,card))overflow.push({page,group:card.dataset.announcementGroup,clippedBody:body.className||body.tagName});
     }
     noticeSections.push(...[...v.notices.querySelectorAll('.announcement-section')].map(section=>({sourceId:section.dataset.sourceId,title:section.querySelector('h3')?.textContent||'',message:section.querySelector('.announcement-message')?.textContent||'',contact:section.querySelector('.announcement-contact bdi[dir="auto"]')?.textContent||'',phone:section.querySelector('.announcement-contact bdi[dir="ltr"]')?.textContent||''})));
    }
    return {theme:root.dataset.theme,overflow,notices:noticeSections.length,noticeSections,groups,pages,noticeTitles:noticeSections.map(section=>section.title),zmanim:root.querySelectorAll('.board-zmanim>div').length,dedication:root.querySelector('.board-dedication')?.textContent,sheetPresent:!!sheet,sheetContained:!sheet||!outside(sheet,root),sheetPlacement:sheet?.dataset.placement,sheetRect:sheet?rect(sheet):null,weeklyRect:weekly?rect(weekly):null,rightRect:right?rect(right):null,zmanimRect:rect(zmanim),noticesRect:rect(v.notices),footerRect:rect(footer),stageRect:rect(root),extended:root.classList.contains('right-extended'),shabbosColumns:root.querySelectorAll('.board-static-column').length,sheetColumns:shadow?.querySelectorAll('.onepage-col').length,sheetFooter:!!shadow?.querySelector('footer,.poster-legend'),sheetHeader:!!shadow?.querySelector('.page-header'),sheetTitle:normalized(shadow?.querySelector('.onepage-title')?.textContent),expectedTitle,sheetRows:[...shadow?.querySelectorAll('.onepage-row')||[]].map(signature),expectedRows,sourceIds:[...root.querySelectorAll('.board-schedule-row[data-source-id]')].map(e=>e.dataset.sourceId),weeklyServices:[...root.querySelectorAll('.board-service>h3')].map(e=>e.textContent)};
   },snapshot);
   const name=`${date} ${theme}`;
   check(result.theme===theme,`${name}: saved theme applied`,result.theme);
   check(!result.overflow.length,`${name}: content fits without clipping`,result.overflow);
   check(result.notices===notices.length&&sameIds(result.noticeTitles,notices.map(n=>n.title)),`${name}: every notice appears once across a full rotation`,result.noticeTitles);
   check(sameIds(result.groups.map(group=>group.id),expectedGroups.map(group=>group.id)),`${name}: every complete group appears once across a full rotation`,result.groups);
   for(const group of expectedGroups)check(sameIds(result.groups.find(actual=>actual.id===group.id)?.sourceIds||[],group.sourceIds),`${name}: ${group.id} stays together in one slot`,result.groups);
   for(const item of notices){const actual=result.noticeSections.find(section=>section.sourceId===item.id);check(actual&&actual.title===item.title&&['message','contact','phone'].every(key=>actual[key]===(item.data[key]||'')),`${name}: ${item.id} complete saved text is present`,actual);}
   check(result.zmanim===11,`${name}: all 11 daily zmanim visible`,result.zmanim);
   check(!!result.dedication,`${name}: dedication remains visible`);
   check(result.shabbosColumns===0,`${name}: Shabbos remains one column`,result.shabbosColumns);
   check(!result.weeklyRect||(result.weeklyRect.left>=result.zmanimRect.right-2&&result.rightRect.left>=result.weeklyRect.right-2),`${name}: weekday schedule is centered with Shabbos or special sheet on its right`,result);
   check(result.rightRect.bottom<=result.footerRect.top+2,`${name}: right schedule stays above the footer`,result.rightRect);
   if(result.extended)check(result.rightRect.bottom>result.noticesRect.top&&result.noticesRect.right<=result.rightRect.left+2,`${name}: extended schedule uses lower space without covering announcements`,{right:result.rightRect,notices:result.noticesRect});
   if(schedule.specialSheet){
    check(result.sheetPresent&&result.sheetContained,`${name}: sheet stays inside the screen`,result.sheetContained);
    check(result.sheetColumns===2,`${name}: original page has exactly two columns`,result.sheetColumns);
    check(!result.sheetFooter,`${name}: no sheet footer`);
    check(!result.sheetHeader,`${name}: printed shul header is removed`);
    check(result.sheetTitle===result.expectedTitle,`${name}: title is Yom Tov and year only`,result.sheetTitle);
    check(sameIds(result.sheetRows,result.expectedRows),`${name}: every original source row and location mark appears exactly once`,{actual:result.sheetRows,expected:result.expectedRows});
    check(result.sheetPlacement===schedule.specialSheet.placement,`${name}: scheduled sheet placement applies`,result.sheetPlacement);
    if(schedule.specialSheet.placement==='shabbos'){
     check(!!result.weeklyRect&&result.sheetRect.left>=result.weeklyRect.right-2,`${name}: original sheet stays to the right of the visible weekday schedule`,{sheet:result.sheetRect,weekly:result.weeklyRect});
     check(result.sheetRect.width<result.stageRect.width*0.5,`${name}: upcoming sheet uses only the right schedule column`,result.sheetRect);
     check(sameIds(result.weeklyServices,[...schedule.presentation.weekly.services.map(s=>s.name),...(schedule.presentation.weekly.posterSections||[]).map(s=>s.heading)]),`${name}: weekday prayer sections remain complete`,result.weeklyServices);
    }else{
     check(!result.weeklyRect,`${name}: weekday box is covered once its schedule finishes`);
     check(result.sheetRect.left>=result.zmanimRect.right-2&&result.sheetRect.width>result.stageRect.width*0.5,`${name}: active original sheet spans both schedule columns beside the complete announcement rail`,{sheet:result.sheetRect,zmanim:result.zmanimRect});
    }
   }else{
    check(!result.sheetPresent,`${name}: ordinary schedule panels used`);
    const ids=[...(schedule.presentation.special?.sections||[]),...(schedule.presentation.weekly.posterSections||[])].flatMap(s=>s.rows.map(r=>r.id));
    check(sameIds(result.sourceIds,ids),`${name}: every ordinary source row retained`,{actual:result.sourceIds,expected:ids});
    check(sameIds(result.weeklyServices,[...schedule.presentation.weekly.services.map(s=>s.name),...(schedule.presentation.weekly.posterSections||[]).map(s=>s.heading)]),`${name}: all weekday service sections visible`,result.weeklyServices);
   }
   if(screenshots)await page.screenshot({path:path.join(screenshots,`${date}-${theme}.png`)});
  }
 }
 const rotation=await page.evaluate(()=>{
  const v=window.boardAuditView,snapshot={...v.snapshot,appearance:{mode:'dark'}};v.slots.clear();v.update(snapshot,{preview:true,now:200000});
  const before=JSON.stringify([...v.slots]),selected=v.slots.get('dedication').id;
  v.update({...snapshot,appearance:{mode:'light'}},{preview:true,now:201000});const afterTheme=JSON.stringify([...v.slots]);
  v.update({...snapshot,appearance:{mode:'light'}},{preview:true,now:226000});
  return {before,afterTheme,selected,afterRotation:v.slots.get('dedication').id,theme:v.stage.dataset.theme,notices:v.stage.querySelectorAll('.announcement-section').length,pages:Number(v.notices.dataset.pages),groups:v.noticePages.flat().map(group=>group.id)};
 });
 check(rotation.before===rotation.afterTheme,'Theme change preserves selected cards and rotation start times',rotation);
 check(rotation.selected!==rotation.afterRotation,'Dedications advance after configured duration',rotation);
 check(rotation.theme==='light'&&rotation.notices>0&&rotation.pages>0&&sameIds(rotation.groups,expectedGroups.map(group=>group.id)),'Timed dedication rotation preserves saved theme and every announcement group',rotation);
}finally{await browser.close();}
if(issues.length){console.error(JSON.stringify(issues,null,2));process.exitCode=1;}else console.log('Board layout passed: weekday center and single-column Shabbos right, original special-page placement, whole announcement groups across rotation, Light/Dark, complete sources, actual card bounds, theme/rotation continuity.');
