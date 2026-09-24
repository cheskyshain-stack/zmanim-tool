import { scheduleSnapshot } from '../src/schedules.js';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.BOARD_TEST_ORIGIN || 'http://127.0.0.1:8795';
const screenshots = process.env.BOARD_SCREENSHOT_DIR;
const issues = [];
const check = (condition, message, details) => { if (!condition) issues.push({ message, details }); };
const sameIds = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
// Clearly labeled development fixtures: never saved or published.
const notices = [
 ['DEV Simcha Hall', 'Development booking instructions only. This contact card tests layout space.', 'DEV contact', 'TEST ONLY'],
 ['DEV community service', 'Development community service information. This is test content, not a real announcement.'],
 ['DEV Rav appointments', 'Development appointment instructions for testing display space and pagination.', 'DEV contact', 'TEST ONLY'],
 ['DEV donation reminder', 'Development donation message only. Please do not treat this fixture as a published request.'],
 ['DEV evening learning and community event', 'Development event information with a longer heading and an English description for layout verification.'],
 ['DEV Coffee room', 'Development coffee room notice only. This fixture checks a short announcement.'],
 ['DEV הודעה לקהילה', 'תוכן לדוגמה בלבד — בדיקת עברית ואנגלית בתצוגה. This is a development preview, not a live notice.'],
 ['DEV General reminder', 'Development reminder for checking a long message. '.repeat(9)],
 ['DEV Contact information', 'Development contact card, with a bilingual name and an isolated phone-number field.', 'DEV איש קשר', 'TEST ONLY'],
 ['DEV schedule information', 'Development notice about where to find schedule information. This text never changes the saved schedule.'],
].map(([title,message,contact='',phone=''],i)=>({id:`development-notice-${String(i+1).padStart(2,'0')}`,kind:'announcement',title,startsAt:'2020-01-01T00:00:00Z',endsAt:null,data:{message,contact,phone,category:'Development fixture',placement:'automatic',priority:i===3?'important':'normal',behavior:'rotating',duration:25}}));
const dedications=[1,2].map(i=>({id:`development-dedication-${i}`,kind:'dedication',title:'DEVELOPMENT DEDICATION',startsAt:'2020-01-01T00:00:00Z',endsAt:null,data:{anonymous:true,dedicationType:'לזכות',dedicationName:`תצוגה לדוגמה ${i}`,dedicationText:'Development preview only',message:'',duration:25}}));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.goto(origin+'/display/');await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(async()=>{const {DisplayView}=await import('/display-assets/renderer.js');document.body.innerHTML='<div id="board-audit" style="width:100vw;height:100vh"></div>';window.boardAuditView=new DisplayView(document.querySelector('#board-audit'));});
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const date of ['2026-09-19','2026-09-24','2026-09-26','2026-10-15']){
  const at=date+'T16:00:00Z',schedule=scheduleSnapshot(at);
  for(const theme of ['light','dark']){
   const snapshot={at,schedule,items:[...notices,...dedications],upcoming:[],appearance:{mode:theme}};
   const result=await page.evaluate(async snapshot=>{
    const v=window.boardAuditView;v.update(snapshot,{preview:true,now:100000});const root=v.stage;
    const host=root.querySelector('.original-sheet-host');
    if(host)await host.originalSheetReady;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const outside=(e,c)=>{const r=rect(e),b=rect(c);return r.left<b.left-2||r.right>b.right+2||r.top<b.top-2||r.bottom>b.bottom+2;};
    const overflow=[];
    for(const e of root.querySelectorAll('.board-week-body,.board-shabbos-body,.board-notices,.board-community,.board-zmanim,.board-notices .tv-card,.board-community .tv-card,.board-dedication .tv-card')){
     if(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)overflow.push({className:e.className,title:e.querySelector('h2')?.textContent,vertical:e.scrollHeight-e.clientHeight,horizontal:e.scrollWidth-e.clientWidth});
    }
    // Check actual text bounds: overflow:hidden must not disguise clipped text.
    for(const card of root.querySelectorAll('.board-notices .tv-card,.board-community .tv-card,.board-dedication .tv-card'))for(const body of card.querySelectorAll('h2,p,.contact')){
     if(getComputedStyle(body).display!=='none'&&outside(body,card))overflow.push({className:card.className,title:card.querySelector('h2')?.textContent,clippedBody:body.className||body.tagName,body:rect(body),card:rect(card)});
    }
    // A body can expand outside its constrained panel without scroll overflow.
    for(const body of root.querySelectorAll('.board-week-body,.board-shabbos-body')){
     if(outside(body,body.parentElement))overflow.push({className:body.className,outsideParent:true});
     for(const child of body.children)if(outside(child,body.parentElement))overflow.push({className:child.className,outsideSchedulePanel:true});
    }
    const center=root.querySelector('.tv-center'),sheet=root.querySelector('.original-sheet-box'),shadow=host?.shadowRoot,weekly=root.querySelector('.board-weekly');
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
    return {theme:root.dataset.theme,overflow,notices:root.querySelectorAll('.board-notices>.tv-card').length,noticeTitles:[...root.querySelectorAll('.board-notices .tv-card h2')].map(e=>e.textContent),zmanim:root.querySelectorAll('.board-zmanim>div').length,dedication:root.querySelector('.board-dedication')?.textContent,sheetPresent:!!sheet,sheetContained:!sheet||!outside(sheet,center),sheetPlacement:sheet?.dataset.placement,sheetRect:sheet?rect(sheet):null,centerRect:rect(center),weeklyRect:weekly?rect(weekly):null,sheetColumns:shadow?.querySelectorAll('.onepage-col').length,sheetFooter:!!shadow?.querySelector('footer,.poster-legend'),sheetHeader:!!shadow?.querySelector('.page-header'),sheetTitle:normalized(shadow?.querySelector('.onepage-title')?.textContent),expectedTitle,sheetRows:[...shadow?.querySelectorAll('.onepage-row')||[]].map(signature),expectedRows,sourceIds:[...root.querySelectorAll('[data-source-id]')].map(e=>e.dataset.sourceId),weeklyServices:[...root.querySelectorAll('.board-service>h3')].map(e=>e.textContent)};
   },snapshot);
   const name=`${date} ${theme}`;
   check(result.theme===theme,`${name}: saved theme applied`,result.theme);
   check(!result.overflow.length,`${name}: content fits without clipping`,result.overflow);
   check(result.notices===10&&sameIds(result.noticeTitles,notices.map(n=>n.title)),`${name}: all 10 notices visible`,result.noticeTitles);
   check(result.zmanim===11,`${name}: all 11 daily zmanim visible`,result.zmanim);
   check(!!result.dedication,`${name}: dedication remains visible`);
   if(schedule.specialSheet){
    check(result.sheetPresent&&result.sheetContained,`${name}: sheet stays inside schedule area`,result.sheetContained);
    check(result.sheetColumns===2,`${name}: original page has exactly two columns`,result.sheetColumns);
    check(!result.sheetFooter,`${name}: no sheet footer`);
    check(!result.sheetHeader,`${name}: printed shul header is removed`);
    check(result.sheetTitle===result.expectedTitle,`${name}: title is Yom Tov and year only`,result.sheetTitle);
    check(sameIds(result.sheetRows,result.expectedRows),`${name}: every original source row and location mark appears exactly once`,{actual:result.sheetRows,expected:result.expectedRows});
    check(result.sheetPlacement===schedule.specialSheet.placement,`${name}: scheduled sheet placement applies`,result.sheetPlacement);
    if(schedule.specialSheet.placement==='shabbos'){
     check(!!result.weeklyRect&&result.weeklyRect.left>=result.sheetRect.right-2,`${name}: original sheet stays in Shabbos box with weekday schedule visible on its right`,{sheet:result.sheetRect,weekly:result.weeklyRect});
     check(result.sheetRect.width<result.centerRect.width*0.7,`${name}: upcoming sheet does not cover both schedules`,result.sheetRect);
     check(sameIds(result.weeklyServices,[...schedule.presentation.weekly.services.map(s=>s.name),...(schedule.presentation.weekly.posterSections||[]).map(s=>s.heading)]),`${name}: weekday prayer sections remain complete`,result.weeklyServices);
    }else{
     check(!result.weeklyRect,`${name}: weekday box is covered once its schedule finishes`);
     check(Math.abs(result.sheetRect.width-result.centerRect.width)<3,`${name}: active original sheet covers the full schedule area`,{sheet:result.sheetRect,center:result.centerRect});
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
  return {before,afterTheme,selected,afterRotation:v.slots.get('dedication').id,theme:v.stage.dataset.theme,notices:v.stage.querySelectorAll('.board-notices>.tv-card').length};
 });
 check(rotation.before===rotation.afterTheme,'Theme change preserves selected cards and rotation start times',rotation);
 check(rotation.selected!==rotation.afterRotation,'Dedications advance after configured duration',rotation);
 check(rotation.theme==='light'&&rotation.notices===10,'Timed rotation preserves saved theme and announcement slots',rotation);
}finally{await browser.close();}
if(issues.length){console.error(JSON.stringify(issues,null,2));process.exitCode=1;}else console.log('Board layout passed: original two-column page, scheduled Shabbos-only and full-width placement, ordinary schedules, Light/Dark, complete sources, actual card bounds, theme/rotation continuity.');
