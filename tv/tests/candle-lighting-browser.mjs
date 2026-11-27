// Local renderer and synthetic empty content only. No production writes or sign-in.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleSnapshot } from '../src/schedules.js';
import { createOfflineSeed } from '../src/offline-seed.js';
import { offlineSnapshot } from '../public/display-assets/offline-engine.js';
import { candleLightingForScreen, CANDLE_HOLD_MS } from '../public/display-assets/candle-lighting.js';
import { localToISO } from '../public/display-assets/time.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const output = process.env.CANDLE_SCREENSHOTS || '/tmp/tv-candle-layout';
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/display-assets/display.css"><div id="screen" style="position:relative;width:100vw;height:100vh;overflow:hidden"></div>'); }
    const file = path.resolve(dist, '.' + pathname);
    if (!file.startsWith(dist + path.sep)) return res.writeHead(403).end();
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium', headless:true});
const errors = [], checks = [];
try {
  await mkdir(output, {recursive:true});
  const page = await browser.newPage();page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  for (const viewport of [{width:1920,height:1080},{width:655,height:369},{width:375,height:812}]) {
    await page.setViewportSize(viewport);await page.goto(origin);
    await page.evaluate(async () => {
      const {DisplayView} = await import('/display-assets/renderer.js');
      window.candleView = new DisplayView(document.querySelector('#screen'));
    });
    for (const [label, local] of [['weekday','2026-11-26T12:00'],['friday','2026-11-27T15:38'],['rosh-hashana','2026-09-11T12:00'],['yom-kippur','2026-09-20T12:00'],['pesach','2027-04-21T12:00']]) {
      const at = localToISO(local), schedule = scheduleSnapshot(at), candle = candleLightingForScreen(schedule, at);
      for (const theme of ['light','dark']) {
        const snapshot = {at,schedule,items:[],appearance:{mode:theme}};
        const result = await page.evaluate(async ({snapshot, theme}) => {
          const view=window.candleView;view.update(snapshot,{now:Date.parse(snapshot.at),theme});
          await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const box=element=>element.getBoundingClientRect().toJSON(), overflow=[];
          for (const pane of view.next.querySelectorAll('.next-minyan-pane,.next-candle-pane')) {
            const p=box(pane);
            for(const child of pane.children){const c=box(child);if(c.x<p.x-1||c.right>p.right+1||c.y<p.y-1||c.bottom>p.bottom+1)overflow.push(child.className);}
          }
          const title=view.next.querySelector('.candle-title'),service=view.next.querySelector('.candle-service');
          const times=[...view.next.querySelectorAll('.next-time')].map(box);
          const card=view.next.innerHTML;
          view.update(snapshot,{now:Date.parse(snapshot.at),theme,preview:true});
          return {split:view.next.classList.contains('has-candles'),text:view.next.textContent,card:box(view.next),overflow,
            titleBefore:!title||box(title).bottom<=box(service).top+1,
            title: title?.textContent, alignedTimes:times.length<2||Math.abs(times[0].y-times[1].y)<1,
            duplicate: [...view.stage.querySelectorAll('.quarter-prayers h4')].some(node=>node.textContent.includes('הדלקת נרות')),
            cardOverflow:view.next.scrollHeight>view.next.clientHeight+1||view.next.scrollWidth>view.next.clientWidth+1,
            previewSame:card===view.next.innerHTML,warning:view.warning};
        },{snapshot,theme});
        assert.equal(result.split, Boolean(candle), label);assert.equal(result.duplicate,false,label);assert.equal(result.previewSame,true,label);
        assert(!result.text.includes('Location'));assert.deepEqual(result.overflow,[],label+': '+JSON.stringify(result));assert.equal(result.cardOverflow,false,label);
        assert.equal(result.titleBefore,true);assert.equal(result.alignedTimes,true,label);if(candle){assert.equal(result.title,candle.title);assert(result.text.includes(candle.time));}
        assert(result.card.bottom<=viewport.height+1);
        if(viewport.width===1920&&theme==='dark')await page.screenshot({path:path.join(output,label+'.png')});
        checks.push({label,theme,width:viewport.width,split:result.split});
      }
    }
    // The cached/offline calendar uses the same card and expiry boundary.
    const at=localToISO('2026-11-27T15:38'),seed=createOfflineSeed([],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},at);
    const snapshot=offlineSnapshot(seed,Date.parse(at)),candle=candleLightingForScreen(snapshot.schedule,at);
    await page.evaluate(snapshot=>window.candleView.update(snapshot,{now:Date.parse(snapshot.at)}),snapshot);
    assert.equal(await page.locator('.next-candle-pane').count(),1);
    for(const elapsed of [CANDLE_HOLD_MS-1,CANDLE_HOLD_MS]) {
      const now=Date.parse(candle.at)+elapsed,next=offlineSnapshot(seed,now);
      await page.evaluate(({next,now})=>window.candleView.update(next,{now}),{next,now});
      assert.equal(await page.locator('.next-candle-pane').count(),elapsed<CANDLE_HOLD_MS?1:0);
    }
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({cases:checks.length,errors,screenshots:output}));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
