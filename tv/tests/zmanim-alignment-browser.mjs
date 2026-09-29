import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const output=fileURLToPath(new URL('../outputs/zmanim-colon/',import.meta.url));
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
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
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.goto(origin);
  await page.evaluate(async()=>{
    const {DisplayView}=await import('/display-assets/renderer.js');
    document.body.innerHTML='<div id="screen" style="width:100vw;height:100vh"></div>';
    window.testView=new DisplayView(document.querySelector('#screen'));
  });
  for(const date of ['2026-09-28','2026-10-15','2027-04-11'])for(const theme of ['light','dark'])for(const seconds of [true,false]){
    const at=date+'T16:00:00Z',schedule=scheduleSnapshot(at);
    if(!seconds)schedule.zmanim=schedule.zmanim.map(z=>({...z,time:z.time.replace(/:\d{2}$/,'')}));
    const snapshot={at,items:[],appearance:{mode:theme},schedule};
    const result=await page.evaluate(async({snapshot,theme})=>{
      const v=window.testView;
      v.update(snapshot,{preview:true,now:Date.parse(snapshot.at),theme});
      const host=v.stage.querySelector('.original-sheet-host');if(host)await host.originalSheetReady;
      await document.fonts.ready;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const panel=v.zmanim,scale=v.stage.getBoundingClientRect().width/v.stage.offsetWidth;
      const rows=[...panel.querySelectorAll(':scope > div')].map(row=>{
        const time=row.querySelector('bdi'),colon=row.querySelector('.zman-colon'),seconds=row.querySelector('.zman-seconds');
        const range=document.createRange();range.selectNodeContents(colon);
        const style=getComputedStyle(row.querySelector('.zman-hours'));
        return {time:time.textContent,label:row.querySelector(':scope > span').textContent,
          colon:range.getBoundingClientRect().left/scale,font:+parseFloat(style.fontSize),
          seconds:seconds?{font:parseFloat(getComputedStyle(seconds).fontSize),weight:+getComputedStyle(seconds).fontWeight}:null};
      });
      return {rows,spread:Math.max(...rows.map(r=>r.colon))-Math.min(...rows.map(r=>r.colon)),
        overflow:panel.scrollWidth>panel.clientWidth+2||panel.scrollHeight>panel.clientHeight+2};
    },{snapshot,theme});
    results.push({date,theme,seconds,...result});
    assert.deepEqual(result.rows.map(({time,label})=>({time,label})),schedule.zmanim,'source times and labels preserved');
    assert.ok(result.spread<=.1,'every first colon shares the same position');
    assert.ok(!result.overflow,'daily zmanim fits its single column');
    for(const row of result.rows){
      assert.equal(!!row.seconds,seconds);
      if(seconds)assert.ok(row.seconds.weight===400&&row.seconds.font<row.font,'seconds stay smaller and normal weight');
    }
    if(date==='2026-09-28'&&seconds)await page.locator('.board-left-rail').screenshot({path:path.join(output,`${theme}.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({cases:results.length,maximumColonDifference:Math.max(...results.map(r=>r.spread)),errors}));
}finally{
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
