import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';

const {chromium}=createRequire(import.meta.url)('playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const writes=[];
// Static, private browser previews only. This server has no API, database or save
// endpoint; dedication fixtures never become public data.
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
const origin=`http://127.0.0.1:${server.address().port}`;
const scale=Number(process.env.DISPLAY_TEST_SCALE)||1;
assert.ok([1,2].includes(scale),'DISPLAY_TEST_SCALE must be 1 (1080p) or 2 (4K)');
const screenshots=process.env.BOARD_SCREENSHOT_DIR;
const notices=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
 .map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
assert.equal(notices.length,10,'Exercise all ten current public announcement fixtures');
const makeDedication=(id,data)=>({
 id:'development-header-'+id,kind:'dedication',title:'DEVELOPMENT PREVIEW ONLY',
 startsAt:'2020-01-01T00:00:00.000Z',endsAt:null,
 data:{sponsor:'',anonymous:false,dedicationType:'Custom',dedicationName:'',dedicationText:'',message:'',duration:35,...data},
});
const fixtures=[
 makeDedication('optional-sponsor',{dedicationType:'לזכות',dedicationName:'לומדי בית המדרש — תצוגה לדוגמה'}),
 makeDedication('text-only',{dedicationText:'לזכות כל לומדי בית המדרש\nולהצלחת כל הקהילה\nבברכת שנה טובה'}),
 makeDedication('multiline',{
  dedicationType:'לרפואה שלמה',dedicationName:'תצוגה לדוגמה בלבד',
  dedicationText:'לזכות כל לומדי בית המדרש\nולהצלחת כל בני הקהילה\nבברכת בריאות ושנה טובה',
  message:'May the learning bring strength and blessing to our community.',
  sponsor:'Development preview family',
 }),
 makeDedication('anonymous',{anonymous:true,sponsor:'PRIVATE SPONSOR MUST NEVER APPEAR',dedicationType:'לע״נ',dedicationName:'תצוגה פרטית לדוגמה',message:'Development preview only.'}),
];
const dates=['2026-09-08','2026-09-24','2026-09-26','2026-11-10'];
const browser=await chromium.launch({channel:'chrome',headless:true});
const failures=[],results=[];
try{
 const page=await browser.newPage({viewport:{width:1920*scale,height:1080*scale}});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin+'/display/');
 await page.evaluate(async()=>{
  await document.fonts.load('700 28px David');await document.fonts.ready;
  const {DisplayView}=await import('/display-assets/renderer.js');
  document.body.innerHTML='<div id="audit" style="width:100vw;height:100vh"></div>';
  window.audit=new DisplayView(document.querySelector('#audit'));
 });
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const date of dates)for(const theme of ['light','dark']){
  const at=date+'T16:00:00.000Z',schedule=scheduleSnapshot(at);
  const snapshot={at,schedule,items:notices,upcoming:[],appearance:{mode:theme}};
  const unchanged=JSON.stringify(snapshot);
  for(const fixture of fixtures){
   const name=`${date} ${theme} ${fixture.id} ${1920*scale}x${1080*scale}`;
   const r=await page.evaluate(async({snapshot,fixture})=>{
    const view=window.audit;
    const input={...snapshot,items:[...snapshot.items,fixture]},original=JSON.stringify(input);
    view.slots.clear();view.update(input,{preview:true,now:100000});
    await document.fonts.ready;
    const host=view.stage.querySelector('.original-sheet-host');if(host)await host.originalSheetReady;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const root=view.stage,head=root.querySelector('.tv-head'),card=root.querySelector('.board-dedication .dedication');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const outside=(e,p)=>{const a=rect(e),b=rect(p);return a.left<b.left-2||a.top<b.top-2||a.right>b.right+2||a.bottom>b.bottom+2;};
    const overlap=(a,b)=>a.left<b.right-2&&a.right>b.left+2&&a.top<b.bottom-2&&a.bottom>b.top+2;
    const overflow=[],missing=[];
    for(const panel of root.querySelectorAll('.board-weekly,.board-shabbos,.board-zmanim,.announcement-group,.board-dedication,.board-dedication .dedication')){
     if(panel.scrollHeight>panel.clientHeight+2||panel.scrollWidth>panel.clientWidth+2)overflow.push({panel:panel.className,height:panel.scrollHeight-panel.clientHeight,width:panel.scrollWidth-panel.clientWidth});
     const texts=panel.querySelectorAll('.board-service,.board-schedule-row,.board-zmanim>div,h2,h3,p,bdi');
     for(const text of texts)if(text.getClientRects().length&&outside(text,panel))overflow.push({panel:panel.className,text:text.textContent.slice(0,80)});
    }
    if(host)for(const row of host.shadowRoot.querySelectorAll('.onepage-row,.onepage-sec-head,.onepage-title'))if(outside(row,host))overflow.push({sheet:row.className,text:row.textContent.slice(0,80)});
    const shown=[...root.querySelectorAll('.announcement-section')];
    for(const notice of snapshot.items){
     const section=shown.find(el=>el.dataset.sourceId===notice.id);
     for(const field of [notice.title,notice.data.message,notice.data.contact,notice.data.phone].filter(Boolean))if(!section?.textContent.includes(field))missing.push({notice:notice.id,field});
    }
    const content=card?.textContent||'',d=fixture.data;
    for(const field of [d.dedicationType==='Custom'?'':d.dedicationType,d.dedicationName,d.dedicationText,d.message,d.anonymous?'':d.sponsor].filter(Boolean))if(!content.includes(field))missing.push({dedication:fixture.id,field});
    const ps=card?[...card.querySelectorAll('p')]:[];
    const body=ps.find(p=>p.textContent===d.dedicationText&&d.dedicationText);
    let multilineRows=0;
    if(body){
     const range=document.createRange();range.selectNodeContents(body);
     multilineRows=new Set([...range.getClientRects()].filter(r=>r.width>0).map(r=>Math.round(r.top))).size;
    }
    const cardStyle=card&&getComputedStyle(card),readable=ps.filter(p=>p.textContent.trim()&&getComputedStyle(p).display!=='none');
    const mainText=readable.filter(p=>!p.matches('.sponsor,.card-page'));
    const fonts=mainText.map(p=>parseFloat(getComputedStyle(p).fontSize));
    const lineHeights=mainText.map(p=>{const s=getComputedStyle(p);return parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.2;});
    const contentHeight=card?card.clientHeight-parseFloat(cardStyle.paddingTop)-parseFloat(cardStyle.paddingBottom):0;
    const brand=root.querySelector('.tv-brand');
    const peers=[brand,...root.querySelectorAll('.tv-head .shul-donate,.tv-date,.tv-clock')].filter(e=>e.getClientRects().length);
    const collisions=card?peers.filter(e=>overlap(rect(card),rect(e))).map(e=>e.className):[];
    const panels=[...root.querySelectorAll('.board-zmanim,.board-weekly,.board-shabbos,.original-sheet-box')];
    const times=[...root.querySelectorAll('.board-zmanim>div')].map(e=>e.textContent);
    const expectedTimes=snapshot.schedule.zmanim.map(z=>z.time+z.label);
    return {overflow,missing,warnings:view.warning,card:card&&rect(card),head:rect(head),brand:brand.textContent,content,
     title:card?.querySelector('h2')?.textContent,contentHeight,lineHeights,fonts,multilineRows,collisions,
     emptyRows:ps.filter(p=>!p.textContent.trim()&&getComputedStyle(p).display!=='none').map(p=>p.className),
     sponsorRows:card?.querySelectorAll('.sponsor').length||0,anonymous:content.includes('Sponsored anonymously'),
     privateSponsorVisible:d.anonymous&&root.innerHTML.includes(d.sponsor),cardInHeader:!!card&&!outside(card,head),
     panelsBelowHeader:panels.every(panel=>rect(panel).top>=rect(head).bottom-2),
     noticeIds:shown.map(e=>e.dataset.sourceId).sort(),pages:Number(view.notices.dataset.pages),times,expectedTimes,
     theme:root.dataset.theme,sheetPlacement:root.querySelector('.original-sheet-box')?.dataset.placement||null,
     width:rect(root).width,height:rect(root).height,snapshotUnchanged:JSON.stringify(input)===original};
   },{snapshot,fixture});
   const check=(ok,what)=>{if(!ok)failures.push({name,what,result:r});};
   check(!!r.card&&r.title==='פרנס היום','active dedication has its own labeled header card');
   check(r.cardInHeader&&r.panelsBelowHeader&&!r.collisions.length,'dedication fits in header without colliding with brand, donation, date, clock or times');
   check(!!r.card&&Math.abs((r.card.left+r.card.right-r.head.left-r.head.right)/2)<=2*scale,'dedication card is centered in the full header');
   check(r.fonts.length>0&&Math.min(...r.fonts)>=20,'main dedication text stays readable at 1080p');
   check(r.lineHeights.length>0&&r.contentHeight>=3*Math.max(...r.lineHeights)-2,'active dedication reserves at least three readable lines');
   check(r.emptyRows.length===0,'optional empty fields do not produce empty rows');
   check(r.sponsorRows===(fixture.data.sponsor||fixture.data.anonymous?1:0),'blank sponsor creates no sponsor row');
   check(r.anonymous===fixture.data.anonymous&&!r.privateSponsorVisible,'anonymous label is explicit and private sponsor stays hidden');
   check(!r.missing.length,'all dedication and public announcement fields are retained');
   const longStress=fixture.id.endsWith('multiline');
   const onlyScheduleOverflow=r.overflow.every(o=>/^board-(zmanim|weekly|shabbos)(?: |$)/.test(o.panel||''));
   check(!r.overflow.length&&!r.warnings.length||longStress&&onlyScheduleOverflow&&r.warnings.length>0,
    longStress?'long dedication stays complete and any schedule capacity limit is reported':'header, times and all notice panels remain unclipped');
   check(!fixture.data.dedicationText.includes('\n')||r.multilineRows>=3,'three-line Hebrew dedication retains three visible lines');
   check(r.brand.includes('Bais Medrash of Lakewood Commons')&&r.brand.includes('קהל לב מנחם'),'both full English and Hebrew shul names remain visible');
   check(JSON.stringify(r.noticeIds)===JSON.stringify(notices.map(i=>i.id).sort())&&r.pages===1,'all ten public announcements remain visible together');
   check(JSON.stringify(r.times)===JSON.stringify(r.expectedTimes),'all original zmanim labels and times are retained');
   check(r.theme===theme&&r.width===1920*scale&&r.height===1080*scale,'saved theme and full display dimensions remain correct');
   check(r.snapshotUnchanged,'rendering preserves the input schedule and announcement data');
   check(date!=='2026-09-26'||r.sheetPlacement==='both','both-column special schedule case is exercised');
   results.push({name,headerHeight:r.head.height,cardHeight:r.card?.height,bodyLines:r.multilineRows,issues:failures.filter(f=>f.name===name).length});
   if(screenshots&&(fixture.id.endsWith('multiline')||date==='2026-09-24'&&theme==='dark'&&['development-header-optional-sponsor','development-header-text-only'].includes(fixture.id))){
    const variant=fixture.id.replace('development-header-','');
    await page.screenshot({path:path.join(screenshots,`dedication-header-${date}-${theme}-${variant}${scale===2?'-4k':''}.png`)});
   }
  }
  const transition=await page.evaluate(async({snapshot,fixtures})=>{
   const view=window.audit,root=view.stage,active={...snapshot,items:[...snapshot.items,fixtures[0],fixtures[2]]};
   const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const height=selector=>root.querySelector(selector)?.getBoundingClientRect().height||0;
   const signature=()=>JSON.stringify({zmanim:root.querySelector('.board-zmanim').textContent,
    times:[...root.querySelectorAll('.board-times')].map(e=>e.textContent),
    sheet:[...root.querySelector('.original-sheet-host')?.shadowRoot.querySelectorAll('.onepage-row')||[]].map(e=>e.textContent)});
   view.slots.clear();view.update(active,{preview:true,now:3000000});await frame();
   const host=root.querySelector('.original-sheet-host');if(host)await host.originalSheetReady;
   const page=host?.shadowRoot.querySelector('.original-page'),fits=host?.originalSheetFitCount;
   const first=view.slots.get('dedication').id,before={head:height('.tv-head'),card:height('.board-dedication .dedication'),times:signature()};
   view.update(active,{preview:true,now:3036000});await frame();
   const second=view.slots.get('dedication').id,after={head:height('.tv-head'),card:height('.board-dedication .dedication'),times:signature()};
   const stable=!host||(root.querySelector('.original-sheet-host')===host&&host.shadowRoot.querySelector('.original-page')===page&&fits===host.originalSheetFitCount);
   view.update(active,{preview:true,theme:snapshot.appearance.mode==='dark'?'light':'dark',now:3037000});await frame();
   const themeStable=view.slots.get('dedication').id===second&&height('.tv-head')===after.head&&height('.board-dedication .dedication')===after.card;
   const inactive={...snapshot,items:[...snapshot.items,{...fixtures[0],startsAt:'2030-01-01T00:00:00.000Z'},{...fixtures[2],endsAt:'2020-01-02T00:00:00.000Z'}]};
   view.update(inactive,{preview:true,now:3038000});await frame();
   const inactiveSection=root.querySelector('.board-dedication'),inactiveStyle=getComputedStyle(inactiveSection);
   return {first,second,before,after,stable,themeStable,inactiveHead:height('.tv-head'),inactiveHeight:height('.board-dedication'),inactiveHidden:inactiveSection.hidden&&(inactiveStyle.display==='none'||inactiveStyle.visibility==='hidden'),inactiveCards:root.querySelectorAll('.board-dedication .dedication').length,inactiveSlot:view.slots.has('dedication')};
  },{snapshot,fixtures});
  const check=(ok,what)=>{if(!ok)failures.push({name:`${date} ${theme} rotation/inactive`,what,result:transition});};
  check(transition.first!==transition.second,'two active dedications rotate');
  check(transition.before.head===transition.after.head&&transition.before.card===transition.after.card&&transition.themeStable,'rotation and theme changes keep card and header heights stable');
  check(transition.before.times===transition.after.times&&transition.stable,'dedication rotation preserves every schedule time and the mounted special sheet');
  check(transition.inactiveHidden&&transition.inactiveCards===0&&!transition.inactiveSlot&&transition.inactiveHead<transition.before.head,'inactive dedication collapses and returns header space to the schedules');
  assert.equal(JSON.stringify(snapshot),unchanged,'Preview rendering must not mutate original schedule or announcement fixtures');
 }
 assert.deepEqual(errors,[],'Browser has no runtime errors');
 assert.deepEqual(writes,[],'Private fixtures are never saved');
 console.log(JSON.stringify({scale,results,failures},null,2));
 assert.equal(failures.length,0,'Dedication header failures are listed above');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
