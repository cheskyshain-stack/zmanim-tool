import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import worker from '../src/worker.js';
import {scheduleSnapshot} from '../src/schedules.js';
import {createOfflineSeed} from '../src/offline-seed.js';

const {chromium}=createRequire(import.meta.url)('playwright');
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const output=process.env.TV3_OUTPUT || fileURLToPath(new URL('../outputs/tv3/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const items=JSON.parse(await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).map(item=>({...item,status:'published',startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
let apiSeed=createOfflineSeed(items,{mode:'light',darkStart:'19:00',lightStart:'07:00'},'2026-10-06T20:08:00.000Z'), offline=false;
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/preview') { res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/display-assets/tv3.css"></head><body><div id="screen"></div></body></html>');return; }
    if(pathname==='/api/display/offline') { res.writeHead(offline?503:200,{'Content-Type':'application/json'}).end(JSON.stringify(apiSeed));return; }
    const file=path.resolve(dist,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
    if(!file.startsWith(dist)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {channel:'chrome'},headless:true,args:['--no-sandbox']});
const errors=[],results=[];
try {
  await mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/preview');
  await page.evaluate(async()=>{const {TV3View}=await import('/display-assets/tv3-view.js');window.view=new TV3View(document.querySelector('#screen'));await document.fonts.load('700 44px David');await document.fonts.ready;});
  async function inspect(snapshot,now=Date.parse(snapshot.at),options={}) {
    return page.evaluate(async({snapshot,now,options})=>{
      const v=window.view;v.update(snapshot,{now,...options});
      await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));
      const issues=[];
      const within=(inner,outer)=>inner.left>=outer.left-1&&inner.top>=outer.top-1&&inner.right<=outer.right+1&&inner.bottom<=outer.bottom+1;
      const root=v.stage.getBoundingClientRect();
      for(const element of v.stage.querySelectorAll('h1,h2,h3,.tv3-brand p,.tv3-clock,.tv3-date,.tv3-countdown,.tv3-occasion,.tv3-time,.tv3-zman,.tv3-notice-copy')) {
        if(!within(element.getBoundingClientRect(),root)) issues.push('Outside stage: '+element.className);
        if(element.scrollWidth>element.clientWidth+2 || element.scrollHeight>element.clientHeight+2) issues.push('Overflow: '+element.className);
      }
      for(const element of v.stage.querySelectorAll('.tv3-time,.tv3-zman,.tv3-next')) {
        const box=element.getBoundingClientRect();
        for(const text of element.querySelectorAll('.tv3-time-value,.tv3-room,.tv3-event-note,.tv3-zman-value,.tv3-zman-label,.tv3-next-time,.tv3-next-service,.tv3-countdown'))
          if(!within(text.getBoundingClientRect(),box)) issues.push('Text does not fit: '+text.className+' '+text.textContent);
      }
      const noticeBox=v.stage.querySelector('.tv3-notices').getBoundingClientRect();
      if(!within(v.noticeCopy.getBoundingClientRect(),noticeBox)) issues.push('Notice does not fit');
      const expected=snapshot.schedule.today.events.filter(e=>!e.auxiliary).map(e=>[e.at,e.name,e.place].join('|'));
      return {issues,servicePages:[...v.servicePages.values()].map(s=>({page:s.page,at:s.at,next:s.next})),events:[...v.stage.querySelectorAll('[data-event]')].map(e=>e.dataset.event),expected,highlight:[...v.stage.querySelectorAll('.upcoming')].map(e=>e.dataset.event),next:v.next.textContent,
        pageCount:v.pages.length,pages:v.pages,theme:v.stage.dataset.theme,sourceNote:v.connection.textContent,body:v.services.textContent};
    },{snapshot,now,options});
  }
  const dates=['2026-10-06T20:08:00Z','2026-10-09T16:00:00Z','2026-10-10T16:00:00Z','2026-10-11T16:00:00Z','2026-10-19T16:00:00Z','2026-12-07T16:00:00Z','2027-03-19T16:00:00Z','2026-09-12T16:00:00Z','2026-09-20T16:00:00Z','2026-09-21T16:00:00Z','2026-09-28T16:00:00Z','2027-04-27T16:00:00Z','2027-06-11T16:00:00Z'];
  for(const at of dates) for(const theme of ['light','dark']) {
    const snapshot={at,items,appearance:{mode:theme},schedule:scheduleSnapshot(at)};
    const result=await inspect(snapshot);
    const covered=new Set(result.events);
    for(let i=1;i<=3;i++) {
      const next=await inspect(snapshot,Date.parse(at)+i*26000);next.events.forEach(e=>covered.add(e));
      assert.deepEqual(next.issues,[],at+' '+theme+' page '+i);
    }
    assert.deepEqual(result.issues,[],at+' '+theme);
    assert.deepEqual([...covered].sort(),result.expected.sort(),'All dated minyanim must appear across their service pages');
    assert.equal(result.theme,theme);
    if(snapshot.schedule.today.note) assert.ok(result.body.includes(snapshot.schedule.today.note),'Source gap must stay explicit');
    results.push({at,theme,events:covered.size,noticePages:result.pageCount});
    if(at==='2026-10-06T20:08:00Z'||at==='2027-03-19T16:00:00Z') {
      await inspect(snapshot);
      await page.screenshot({path:path.join(output,`${at.slice(0,10)}-${theme}.png`)});
    }
  }
  const at='2026-10-06T20:08:00.000Z',base={at,items,appearance:{mode:'light'},schedule:scheduleSnapshot(at)};
  await inspect(base);
  const stable=await page.evaluate(({snapshot,now})=>{const first=window.view.services.firstElementChild;window.view.update(snapshot,{now:now+1000});return first===window.view.services.firstElementChild;},{snapshot:base,now:Date.parse(at)});
  assert.equal(stable,true,'Seconds must not rebuild the schedule');
  const start='2026-10-06T20:15:00.000Z';
  for(const seconds of [0,299,301]) {
    const instant=new Date(Date.parse(start)+seconds*1000).toISOString();
    const snap={...base,at:instant,schedule:scheduleSnapshot(instant)};
    const result=await inspect(snap);
    assert.ok(result.next.includes(seconds<=299?'4:15':'4:40'),'Keep current minyan during the shared five-minute hold');
  }
  const stale=await inspect(base,Date.parse(at),{stale:true});assert.ok(stale.next.includes('Reconnecting'));assert.equal(stale.highlight.length,0);
  const longer={id:'long-notice',kind:'announcement',startsAt:'2020-01-01T00:00:00Z',endsAt:null,title:'A complete announcement that continues on later cards',data:{message:'Long notices must remain readable and complete. '.repeat(25),contact:'Office',phone:'732-555-0100'}};
  const xss={...longer,id:'escaped-notice',title:'<img src=x onerror=alert(1)>',data:{message:'<script>alert(1)</script> בעזרת נשים',phone:''}};
  const long=await inspect({...base,items:[longer,xss]});
  assert.ok(long.pageCount>2,'Long notices need readable pages');
  assert.equal(long.pages.filter(p=>p.id===longer.id).map(p=>p.message).join(''),longer.data.message,'No notice text can be lost');
  assert.equal(await page.locator('.tv3-notices img,.tv3-notices script').count(),0,'Entered text must be escaped');
  for(let i=0;i<long.pageCount;i++) {
    const result=await inspect({...base,items:[longer,xss]},Date.parse(at)+i*26000);
    assert.deepEqual(result.issues,[],'Long announcement part '+i);
  }
  const expired={...longer,id:'expires',endsAt:at};const future={...longer,id:'future',startsAt:'2026-10-06T20:09:00Z'};
  const current=await inspect({...base,items:[expired,future]});assert.equal(current.pageCount,0);
  const futureResult=await inspect({...base,items:[expired,future]},Date.parse(at)+60000);assert.ok(futureResult.pages.every(p=>p.id==='future'));
  for(const viewport of [{width:3840,height:2160},{width:1366,height:768},{width:844,height:390},{width:390,height:844}]) {
    await page.setViewportSize(viewport);const result=await inspect(base);assert.deepEqual(result.issues,[],JSON.stringify(viewport));
    const fits=await page.evaluate(()=>{const b=window.view.stage.getBoundingClientRect();return b.left>=-1&&b.top>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1;});assert.ok(fits,'Entire TV scales inside viewport');
  }
  await page.setViewportSize({width:1920,height:1080});
  await inspect(base);await page.screenshot({path:path.join(output,'tv3-preview.png')});
  // Verify the production bootstrap reads the public seed and recovers from network loss.
  const live=await browser.newPage({viewport:{width:1920,height:1080}});live.on('pageerror',e=>errors.push(e.message));
  await live.clock.install({time:new Date(at)});await live.goto(origin+'/tv3/');
  await live.waitForFunction(()=>document.querySelector('.tv3-next-time')?.textContent.includes('4:15'));
  offline=true;await live.clock.fastForward(780000);
  await live.waitForFunction(()=>document.querySelector('.tv3-connection')?.textContent==='Using saved calendar');
  assert.ok((await live.locator('.tv3-next-time').textContent()).includes('4:40'),'Cached engine still advances times');
  offline=false;await live.close();
  for(const pathname of ['/tv3','/tv3/index.html']) {
    const response=await worker.fetch(new Request('https://example.com'+pathname),{});
    assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://example.com/tv3/');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({cases:results.length,results,checks:'Native text bounds, all daily events, both themes, announcement pagination and expiration, XSS, five-minute retention, cached calendar advancement, scaling and TV3 routing'},null,2));
}finally {
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
