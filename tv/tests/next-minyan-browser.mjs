import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const output=fileURLToPath(new URL('../outputs/next-minyan/',import.meta.url));
const live=process.env.NEXT_MINYAN_SNAPSHOT?JSON.parse(await readFile(process.env.NEXT_MINYAN_SNAPSHOT,'utf8')):null;
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const items=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
  .map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');return;}
    const file=path.resolve(dist,'.'+pathname);
    if(!file.startsWith(dist)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
  await mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.goto(origin);
  await page.evaluate(async()=>{
    const {DisplayView}=await import('/display-assets/renderer.js');
    document.body.innerHTML='<div id="screen" style="width:100vw;height:100vh"></div>';
    window.testView=new DisplayView(document.querySelector('#screen'));
  });
  for(const date of live?['current']:['2026-10-15','2026-09-28','2026-09-11','2026-09-20','2027-04-21'])for(const theme of ['light','dark']){
    const at=live?.at||date+'T19:44:00.000Z';
    const snapshot=live?{...live,appearance:{mode:theme}}:{at,items,appearance:{mode:theme},schedule:scheduleSnapshot(at)};
    const result=await page.evaluate(async({snapshot,theme})=>{
      const v=window.testView;
      v.update(snapshot,{preview:true,now:Date.parse(snapshot.at),theme});
      const host=v.stage.querySelector('.original-sheet-host');
      if(host)await host.originalSheetReady;
      await document.fonts.ready;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const card=rect(v.next),header=rect(v.stage.querySelector('.tv-head')),brand=rect(v.brand),current=rect(v.stage.querySelector('.tv-current'));
      const stage=rect(v.stage),sheet=v.originalSheetBox;
      const before=v.schedules.innerHTML;
      v.update(snapshot,{preview:true,now:Date.parse(snapshot.at)+60000,theme});
      const steadyPreview=v.next.querySelector('.next-countdown')?.textContent;
      v.update(snapshot,{now:Date.parse(snapshot.at)+60000,theme,connection:'cached'});
      return {card,header,brand,current,stage,text:v.next.textContent,steadyPreview,
        warnings:v.warning,icons:v.next.querySelectorAll('img,svg').length,
        overflow:[...v.stage.querySelectorAll('.next-minyan,.tv-current,.board-zmanim,.board-dedication,.board-weekly,.board-shabbos,.announcement-group')].filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>({panel:e.className,height:e.scrollHeight-e.clientHeight,width:e.scrollWidth-e.clientWidth})),
        stable:sheet===v.originalSheetBox&&before===v.schedules.innerHTML,
        inHeader:v.next.parentElement.matches('.tv-head'),footerNext:v.stage.querySelectorAll('.tv-footer .next-minyan').length};
    },{snapshot,theme});
    results.push({date,theme,...result});
    if(['current','2026-10-15','2026-09-28'].includes(date)) {
      await page.evaluate(({snapshot,theme})=>window.testView.update(snapshot,{preview:true,now:Date.parse(snapshot.at),theme}),{snapshot,theme});
      await page.screenshot({path:path.join(output,`${date}-${theme}.png`)});
    }
    assert.equal(result.inHeader,true);assert.equal(result.footerNext,0);assert.equal(result.icons,0);
    assert.ok(Math.abs(result.card.x+result.card.width/2-(result.stage.x+result.stage.width/2))<1,'card centered on screen');
    assert.ok(result.brand.right<result.card.x&&result.card.right<result.current.x,'header areas separated');
    assert.ok(result.card.bottom<=result.header.bottom,'card fits header');
    assert.deepEqual(result.overflow,[],date+' '+theme);
    assert.deepEqual(result.warnings,[],date+' '+theme);
    assert.ok(result.stable,'clock/countdown ticks preserve mounted charts');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({cases:results.length,results},null,2));
}finally{
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
