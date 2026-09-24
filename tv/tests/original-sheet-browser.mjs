import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scheduleSnapshot, settings } from '../src/schedules.js';
import { publicPosterSections } from '../../js/ui/posters-view.js';
import { buildRoshHashanaPoster } from '../../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../../js/posters/yomkippur.js';
import { buildSukkosPoster } from '../../js/posters/sukkos.js';
import { buildPesachPoster } from '../../js/posters/pesach.js';
import { buildTzomGedaliaPoster } from '../../js/posters/tzomgedalia.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2' };
const server = createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><body style="margin:0"></body></html>'); return; }
    const file = path.resolve(dist, '.' + pathname);
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const screenshots = process.env.SHEET_SCREENSHOT_DIR;
// Select calendar content extrema rather than exercising the same shape twenty
// times. Include each source's first/last year and most rows/longest text.
const cases = ['2026-09-12','2026-09-14','2026-09-21','2026-09-26','2027-04-22','2028-10-07']
  .map(date => ({date,sheet:scheduleSnapshot(date+'T16:00:00Z').specialSheet,sizes:[[764,555],[1544,555]],themes:['dark','light']}));
for (const [key,title,build] of [
  ['rh','ראש השנה',buildRoshHashanaPoster], ['yk','יום כיפור',buildYomKippurPoster],
  ['sukkos','סוכות',buildSukkosPoster], ['pesach','פסח',buildPesachPoster],
  ['gedalia','צום גדליה',buildTzomGedaliaPoster],
]) {
  const years=Array.from({length:20},(_,i)=>5787+i).map(year=>({
    sourceId:`${key}:${year}`,title,year,sections:publicPosterSections(key,build(year,settings)),
  }));
  const rows=s=>s.sections.flatMap(section=>section.rows);
  const scores=[s=>rows(s).reduce((n,r)=>n+1+(r.extra?1:0),0),s=>JSON.stringify(s.sections).length,s=>Math.max(...rows(s).map(r=>JSON.stringify(r).length))];
  const selected=new Set([years[0],years.at(-1),...scores.map(score=>years.reduce((best,s)=>score(s)>score(best)?s:best))]);
  for(const sheet of selected)cases.push({date:sheet.sourceId,sheet,sizes:[[704,884],[764,884],[1424,884],[764,900],[988,900]],themes:['dark']});
}
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const page = await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto(origin);
  if (screenshots) await mkdir(screenshots,{recursive:true});
  for (const {date,sheet,sizes,themes} of cases) {
    assert.ok(sheet, date);
    for (const [width,height] of sizes) {
      for (const theme of themes) {
        const result = await page.evaluate(async ({sheet,width,height,theme}) => {
          const {originalSheetHTML,fitOriginalSheet} = await import('/display-assets/original-sheet.js');
          document.body.innerHTML='<main class="tv-stage" style="padding:20px"></main>';
          const stage=document.querySelector('main'); stage.dataset.theme=theme;
          stage.style.background=theme==='dark'?'#0b1423':'#faf7ef';
          const box=document.createElement('section');box.style.cssText=`width:${width}px;height:${height}px;position:relative`;
          box.innerHTML=originalSheetHTML(sheet);stage.append(box);
          const host=box.querySelector('.original-sheet-host');
          const template=host.querySelector('template').content;
          const normalize=text=>String(text||'').replace(/[\s/]+/g,'');
          const signature=row=>JSON.stringify({text:normalize(row.textContent),label:normalize(row.querySelector('.onepage-label')?.textContent),times:normalize(row.querySelector('.onepage-times')?.textContent),underlines:[...row.querySelectorAll('u')].map(u=>normalize(u.textContent))});
          const originalRows=[...template.querySelectorAll('.onepage-row')].map(signature).sort();
          const ready=fitOriginalSheet(box),shadow=host.shadowRoot;
          const beforeReady=getComputedStyle(shadow.querySelector('.original-page')).visibility;
          await ready;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const fittedRows=[...shadow.querySelectorAll('.onepage-row')].map(signature).sort();
          const firstRow=shadow.querySelector('.onepage-row'),firstMarkup=shadow.querySelector('.poster').outerHTML;
          const fitCount=host.originalSheetFitCount;
          for(let minute=1;minute<=3;minute++) {
            stage.dataset.theme=minute%2?theme==='dark'?'light':'dark':theme;
            await fitOriginalSheet(box);
          }
          stage.dataset.theme=theme;
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const sameNode=firstRow===shadow.querySelector('.onepage-row'),sameMarkup=firstMarkup===shadow.querySelector('.poster').outerHTML;
          const checkInk=()=>{
            const bounds=host.getBoundingClientRect(),overflow=[];
            const outside=r=>r.left<bounds.left-2||r.right>bounds.right+2||r.top<bounds.top-2||r.bottom>bounds.bottom+2;
            for(const el of shadow.querySelectorAll('.onepage-row,.onepage-title,.onepage-sec-head,.onepage-label,.onepage-times,.onepage-note')) {
              const r=el.getBoundingClientRect();
              if(outside(r)||el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2)overflow.push({tag:el.className,text:el.textContent,rect:[r.left,r.top,r.right,r.bottom],bounds:[bounds.left,bounds.top,bounds.right,bounds.bottom]});
            }
            // An element's box can fit while an unbreakable note or a font's
            // text line extends outside it. Measure the actual text as well.
            const walker=document.createTreeWalker(shadow.querySelector('.poster'),NodeFilter.SHOW_TEXT);
            for(let text; (text=walker.nextNode());)if(text.textContent.trim()){
              const range=document.createRange();range.selectNodeContents(text);
              for(const r of range.getClientRects())if(outside(r))overflow.push({text:text.textContent,rect:[r.left,r.top,r.right,r.bottom]});
            }
            return overflow;
          };
          const overflow=checkInk();
          const reversedTimes=[];
          for(const row of shadow.querySelectorAll('.onepage-times')) {
            const times=[...row.querySelectorAll('.onepage-t')];
            for(let i=1;i<times.length;i++) {
              const a=times[i-1].getBoundingClientRect(),b=times[i].getBoundingClientRect();
              if(Math.abs(a.top-b.top)<2&&b.left<a.left-1)reversedTimes.push(row.textContent);
            }
          }
          const color=selector=>getComputedStyle(shadow.querySelector(selector)).color;
          const background=getComputedStyle(shadow.querySelector('.poster')).backgroundColor;
          const afterFitCount=host.originalSheetFitCount;
          box.style.width=(width===764?1544:764)+'px';
          await fitOriginalSheet(box);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const resizeCount=host.originalSheetFitCount;
          const resizedRows=[...shadow.querySelectorAll('.onepage-row')].map(signature).sort();
          const resizedOverflow=checkInk();
          box.style.width=width+'px';
          await fitOriginalSheet(box);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {originalRows,fittedRows,resizedRows,overflow,resizedOverflow,restoredOverflow:checkInk(),reversedTimes,beforeReady,ready:host.dataset.sheetReady,sameNode,sameMarkup,fitCount,afterFitCount,resizeCount,columns:shadow.querySelectorAll('.onepage-col').length,unheadedSections:shadow.querySelectorAll('.onepage-sec:not(:has(.onepage-sec-head))').length,columnHeadings:[...shadow.querySelectorAll('.onepage-col')].map(c=>[...c.querySelectorAll('.onepage-sec-head')].map(h=>h.textContent)),background,heading:color('.onepage-title'),dayHeading:color('.onepage-sec-head'),label:color('.onepage-label'),times:color('.onepage-times'),fontSize:getComputedStyle(firstRow).fontSize,scale:shadow.querySelector('.poster').style.getPropertyValue('--op-scale')};
        },{sheet,width,height,theme});
        const label=`${date} ${width}x${height}px ${theme}`;
        assert.equal(result.beforeReady,'hidden',`${label}: only reveal fitted sheet`);
        assert.equal(result.ready,'true',`${label}: full sheet is visible`);
        assert.equal(result.columns,2,`${label}: original two-column shape`);
        assert.equal(result.unheadedSections,0,`${label}: complete days stay with their headings in one column`);
        if(sheet.sourceId==='sukkos:5787') {
          assert.match(result.columnHeadings[0].at(-1),/הושענא רבה/,`${label}: Hoshana Rabbah ends the right column`);
          assert.match(result.columnHeadings[1][0],/שמיני עצרת/,`${label}: Shemini Atzeres starts the left column`);
        }
        assert.deepEqual(result.fittedRows,result.originalRows,`${label}: every source row retained exactly once`);
        assert.deepEqual(result.overflow,[],`${label}: actual text bounds fit`);
        assert.deepEqual(result.resizedOverflow,[],`${label}: all text fits after placement resize`);
        assert.deepEqual(result.restoredOverflow,[],`${label}: all text fits after restoring placement`);
        assert.deepEqual(result.reversedTimes,[],`${label}: times keep their left-to-right source order`);
        assert.ok(result.sameNode&&result.sameMarkup,`${label}: polls and themes never replace or repartition the sheet`);
        assert.equal(result.afterFitCount,result.fitCount,`${label}: unchanged geometry never refits`);
        assert.equal(result.resizeCount,result.fitCount+1,`${label}: placement width change fits exactly once`);
        assert.deepEqual(result.resizedRows,result.originalRows,`${label}: changing from one box to both keeps every row`);
        assert.equal(result.background,theme==='dark'?'rgb(11, 20, 35)':'rgb(250, 247, 239)',`${label}: sheet background matches theme`);
        assert.equal(result.times,theme==='dark'?'rgb(245, 242, 234)':'rgb(20, 42, 66)',`${label}: schedule times match theme`);
        assert.equal(result.heading,theme==='dark'?'rgb(216, 183, 106)':'rgb(146, 118, 56)',`${label}: title is gold`);
        assert.equal(result.label,result.heading,`${label}: prayer names are gold`);
        assert.equal(result.dayHeading,result.heading,`${label}: day headings are gold`);
        if(screenshots&&date==='2026-09-26')await page.screenshot({path:path.join(screenshots,`sheet-${width}-${theme}.png`)});
        console.log(`${label}: complete and stable (${result.fontSize}, scale ${result.scale})`);
      }
    }
  }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
