import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const output=fileURLToPath(new URL('../outputs/underline-alignment/',import.meta.url));
const phase=process.env.ALIGNMENT_PHASE==='before'?'before':'after';
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const items=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
  .map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');return;}
    const file=path.resolve(dist,'.'+pathname);
    if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
try{
  await mkdir(output,{recursive:true});
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.goto(origin);
  await page.evaluate(async()=>{
    const {DisplayView}=await import('/display-assets/renderer.js');
    document.body.innerHTML='<div id="screen" style="width:100vw;height:100vh"></div>';
    window.testView=new DisplayView(document.querySelector('#screen'));
  });
  // Reported Bereishis preview, a longer Shabbos, and summer plag entries.
  for(const at of ['2026-10-05T02:46:00Z','2027-04-11T22:23:00Z','2027-07-16T16:00:00Z'])
  for(const theme of ['light','dark'])for(const width of [1920,3840]){
    await page.setViewportSize({width,height:width*9/16});
    const snapshot={at,items,appearance:{mode:theme},schedule:scheduleSnapshot(at)};
    const result=await page.evaluate(async({snapshot,theme})=>{
      const v=window.testView;
      v.update(snapshot,{preview:true,now:Date.parse(snapshot.at),theme});
      await document.fonts.ready;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const panel=v.stage.querySelector('.board-shabbos');
      if(!panel)return {missing:true};
      const scale=v.stage.getBoundingClientRect().width/v.stage.offsetWidth;
      // Measure the printed digits, not element bottoms: an underline border
      // can align the boxes while lifting just the underlined clock's glyphs.
      const clockInk=bdi=>{
        const walker=document.createTreeWalker(bdi,NodeFilter.SHOW_TEXT);
        for(let node;(node=walker.nextNode());){
          const match=node.textContent.match(/\d{1,2}:\d{2}/);if(!match)continue;
          const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
          const rect=range.getBoundingClientRect();
          return {time:match[0],bottom:rect.bottom/scale,left:rect.left/scale,underlined:!!node.parentElement.closest('u')};
        }
      };
      const lines=[...panel.querySelectorAll('.board-time-line')].map(line=>{
        const times=[...line.querySelectorAll('.board-time>bdi')].map(clockInk).filter(Boolean);
        return {times,spread:times.length?Math.max(...times.map(t=>t.bottom))-Math.min(...times.map(t=>t.bottom)):0};
      });
      const starts=[...panel.querySelectorAll('.board-schedule-row .board-times')].map(times=>times.querySelector('.board-time>bdi')).filter(Boolean).map(clockInk).filter(Boolean).map(t=>t.left);
      const rows=[...panel.querySelectorAll('.board-schedule-row')].map(row=>({id:row.dataset.sourceId,text:row.textContent}));
      return {lines,rows,underlines:panel.querySelectorAll('u').length,namedTimes:panel.querySelectorAll('.board-time>small').length,
        mixedLines:lines.filter(line=>line.times.some(t=>t.underlined)&&line.times.some(t=>!t.underlined)).length,
        maximumSpread:Math.max(...lines.map(line=>line.spread)),leftSpread:Math.max(...starts)-Math.min(...starts),
        overflow:panel.scrollHeight>panel.clientHeight+2||panel.scrollWidth>panel.clientWidth+2};
    },{snapshot,theme});
    results.push({at,theme,width,...result});
    if(width===1920&&theme==='dark')await page.screenshot({path:path.join(output,`${phase}-${at.slice(0,10)}.png`)});
  }
  await writeFile(path.join(output,`${phase}.json`),JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify(results.map(({at,theme,width,maximumSpread,leftSpread,mixedLines,namedTimes,overflow})=>({at,theme,width,maximumSpread,leftSpread,mixedLines,namedTimes,overflow})),null,2));
  assert.deepEqual(errors,[]);
  for(const result of results){
    assert.ok(!result.missing,'Shabbos is rendered');
    assert.ok(result.mixedLines>0,'fixture covers mixed underlining');
    assert.ok(result.namedTimes>0,'fixture covers labels above times');
    assert.ok(result.maximumSpread<=1,`${result.at} ${result.theme}: clock baselines differ by ${result.maximumSpread}px`);
    assert.ok(result.leftSpread<=1,'shared time column keeps its left edge');
    assert.ok(!result.overflow,'complete Shabbos fits the panel');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
