import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createOfflineSeed} from '../src/offline-seed.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const output=fileURLToPath(new URL('../test-output/mobile-viewport/',import.meta.url));
const at='2026-09-29T16:21:00.000Z';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));
  if(!file.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir(output,{recursive:true});
const results=[];
async function open(options,theme='light'){
  const context=await browser.newContext({...options,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(at));
  const seed=createOfflineSeed([{id:'development-phone-notice',kind:'announcement',status:'published',title:'DEVELOPMENT PHONE PREVIEW',startsAt:'2026-01-01T00:00:00Z',endsAt:null,data:{message:'Scroll to the bottom to read the complete announcement and the end of the saved special schedule.',placement:'left',behavior:'pinned',duration:25}}],{mode:theme,darkStart:'19:00',lightStart:'07:00'},at);
  await page.route(origin+'/api/display/offline',route=>route.fulfill({json:seed}));
  await page.goto(origin+'/tv/');
  await page.locator('.original-sheet-host[data-sheet-ready="true"]').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  return {context,page,errors};
}
async function metrics(page){
  return page.evaluate(()=>{
    const r=node=>{const b=node.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
    return {width:innerWidth,height:innerHeight,scrollY,scrollWidth:document.scrollingElement.scrollWidth,scrollHeight:document.scrollingElement.scrollHeight,stage:r(document.querySelector('.tv-stage')),footer:r(document.querySelector('.tv-footer')),host:r(document.querySelector('#screen')),coarse:matchMedia('(pointer:coarse)').matches};
  });
}
async function swipeToBottom(page){
  const client=await page.context().newCDPSession(page);
  const viewport=page.viewportSize();
  const x=Math.round(viewport.width*.5),startY=Math.round(viewport.height*.85),endY=30;
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:startY}]});
  for(let step=1;step<=12;step++){
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:startY+(endY-startY)*step/12}]});
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await client.detach();
  await page.waitForFunction(()=>scrollY>0,{},{timeout:5000});
}
try{
  for(const theme of ['light','dark']){
    const {context,page,errors}=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2},theme);
    let m=await metrics(page);
    assert.ok(m.coarse);assert.ok(m.stage.bottom<=m.height+1);assert.ok(m.scrollWidth<=m.width+1);assert.ok(m.scrollHeight<=m.height+1);
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(()=>Math.abs(document.querySelector('.tv-stage').getBoundingClientRect().width-innerWidth)<1);
    m=await metrics(page);
    assert.ok(m.scrollHeight>m.height,'Landscape board has a reachable scroll range');
    assert.ok(m.scrollWidth<=m.width+1,'No unscaled 1920px footprint');
    assert.ok(m.stage.top>=-1,'Top is reachable before swiping');
    await page.screenshot({path:join(output,`landscape-${theme}-top.png`)});
    await swipeToBottom(page);m=await metrics(page);
    assert.ok(m.footer.bottom<=m.height+1&&m.footer.top>=0,'Native touch swipe reaches the footer');
    await page.screenshot({path:join(output,`landscape-${theme}-bottom.png`)});
    results.push({theme,landscape:m});
    await page.setViewportSize({width:844,height:300});
    await swipeToBottom(page);m=await metrics(page);
    assert.ok(m.footer.bottom<=m.height+1,'Bottom stays reachable with less browser space');
    assert.ok(Math.abs(m.stage.width-844)<1,'Toolbar changes keep phone width readable');
    const client=await context.newCDPSession(page);
    await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});
    assert.ok(Math.abs(await page.evaluate(()=>visualViewport.scale)-1.5)<.01,'Browser zoom is applied');
    assert.ok(Math.abs((await metrics(page)).stage.width-844)<1,'Pinch zoom does not resize the board');
    await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await client.detach();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.tv-stage').getBoundingClientRect().bottom<=innerHeight+1&&scrollY===0);
    m=await metrics(page);assert.ok(m.scrollHeight<=m.height+1);assert.deepEqual(errors,[]);
    await context.close();
  }
  for(const [width,height] of [[1920,1080],[3840,2160],[1366,768]]){
    const {context,page,errors}=await open({viewport:{width,height}});
    const m=await metrics(page);
    assert.ok(m.stage.bottom<=height+1&&m.stage.right<=width+1);
    assert.ok(m.scrollHeight<=height+1&&m.scrollWidth<=width+1,'TV viewport has no scrollbars');
    results.push({desktop:{width,height},stage:m.stage});assert.deepEqual(errors,[]);
    // Same shared renderer in an embedded admin-sized preview stays contained.
    await page.evaluate(async()=>{
      const {DisplayView}=await import('/display-assets/renderer.js');
      document.body.className='';document.body.innerHTML='<div id="preview-host" style="position:relative;width:600px;height:337.5px;overflow:hidden"></div>';
      window.preview=new DisplayView(document.querySelector('#preview-host'));
    });
    const preview=await page.locator('.tv-stage').boundingBox();assert.equal(preview.width,600);assert.equal(preview.height,337.5);
    await context.close();
  }
  console.log(JSON.stringify({results,errors:[],screenshots:output},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
