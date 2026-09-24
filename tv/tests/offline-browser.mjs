import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createOfflineSeed} from '../src/offline-seed.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const origin=process.env.DISPLAY_TEST_URL||'http://127.0.0.1:8795';
const start='2026-09-25T12:40:00.000Z';
const seed=createOfflineSeed([{id:'dev-offline-fixture',kind:'announcement',status:'published',title:'DEVELOPMENT OFFLINE TEST',startsAt:'2026-09-25T12:42:00.000Z',endsAt:'2026-09-25T12:50:00.000Z',data:{message:'Development-only public announcement.',placement:'left',behavior:'pinned',duration:25}}],{mode:'scheduled',darkStart:'09:00',lightStart:'07:00'},start);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(start)});
 await page.route(origin+'/api/display/offline',route=>route.fulfill({json:seed}));
 await page.goto(origin+'/display/');
 await page.waitForFunction(()=>document.querySelector('.board-zmanim'));
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>navigator.serviceWorker.controller);
 assert.equal(await page.locator('.tv-stage').getAttribute('data-theme'),'light');
 assert.equal(await page.getByText('DEVELOPMENT OFFLINE TEST',{exact:true}).count(),0);
 const firstClock=await page.locator('.tv-clock').textContent();
 await context.setOffline(true);
 await page.unroute(origin+'/api/display/offline');
 await page.clock.setSystemTime(new Date('2026-09-25T12:43:00.000Z'));await page.clock.runFor(1100);
 await page.waitForFunction(()=>document.body.textContent.includes('DEVELOPMENT OFFLINE TEST'));
 assert.notEqual(await page.locator('.tv-clock').textContent(),firstClock);
 assert.equal(await page.locator('.tv-stale').count(),0);
 await page.clock.setSystemTime(new Date('2026-09-25T13:01:00.000Z'));await page.clock.runFor(1100);
 assert.equal(await page.locator('.tv-stage').getAttribute('data-theme'),'dark');
 assert.equal(await page.getByText('DEVELOPMENT OFFLINE TEST',{exact:true}).count(),0);
 // Offline reload restores both shell and IndexedDB seed, and uses today's
 // actual date instead of retaining the old server snapshot.
 await page.clock.setSystemTime(new Date('2026-09-26T04:01:00.000Z'));await page.clock.runFor(1100);
 await page.waitForFunction(()=>document.querySelector('.tv-date').textContent.includes('Sep 26'));
 const dayHeader=await page.locator('.tv-date').textContent();
 await page.reload();await page.waitForFunction(()=>document.querySelector('.board-zmanim'));
 assert.equal(await page.locator('.tv-date').textContent(),dayHeader);
 const data=await page.evaluate(async()=>{
  const {readOfflineCache}=await import('/display-assets/offline-cache.js');
  const {offlineSnapshot}=await import('/display-assets/offline-engine.js');
  const cached=await readOfflineCache(),snapshot=offlineSnapshot(cached.seed,'2026-09-26T04:01:00.000Z');
  const paths=[];for(const name of await caches.keys())for(const req of await (await caches.open(name)).keys())paths.push(new URL(req.url).pathname);
  return {date:snapshot.schedule.date,placement:snapshot.schedule.specialSheet.placement,next:snapshot.schedule.next,paths,scope:(await navigator.serviceWorker.ready).scope};
 });
 assert.equal(data.date,'2026-09-26');assert.equal(data.placement,'both');assert.ok(data.next.at);assert.ok(data.scope.endsWith('/display/'));
 assert.ok(data.paths.length>10);assert.ok(data.paths.every(p=>p==='/display/'||p.startsWith('/display-assets/')));assert.ok(data.paths.every(p=>!p.includes('admin')&&!p.includes('/api/')));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({offlineReload:true,publishedTiming:true,themeTransition:true,midnight:true,sheetPlacement:true,publicFilesCached:data.paths.length,errors}));
 await context.close();
 // A first visit with no cache must recover without replacing the stable
 // renderer's nodes, even when the initial endpoint request fails.
 const fresh=await browser.newContext({viewport:{width:1920,height:1080}}),recovery=await fresh.newPage();
 let attempts=0;
 await recovery.route(origin+'/api/display/offline',route=>++attempts===1?route.fulfill({status:503,body:'temporarily unavailable'}):route.fulfill({json:seed}));
 await recovery.goto(origin+'/display/');
 await recovery.waitForFunction(()=>document.querySelector('.boot')&&!document.querySelector('.boot').hidden);
 await recovery.evaluate(()=>window.dispatchEvent(new Event('online')));
 await recovery.waitForFunction(()=>document.querySelector('.board-zmanim')?.textContent.includes('הנץ החמה'));
 assert.ok(await recovery.locator('.tv-clock').textContent());
 assert.equal(await recovery.locator('.boot').isVisible(),false);
 console.log(JSON.stringify({firstConnectionFailureRecovered:true,attempts}));await fresh.close();
}finally{await browser.close();}
