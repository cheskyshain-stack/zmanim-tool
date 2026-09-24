import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';

// Run after `npm run build`. This serves only local built assets and injects
// calculated snapshots into a private preview; it never calls the live API.
const {chromium} = createRequire(import.meta.url)('playwright');
const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = {'.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.png':'image/png'};
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/display/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');
      return;
    }
    const file = path.resolve(dist, '.' + pathname);
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

const firstDate = '2026-09-24', lastDate = '2027-09-23';
const dates = Array.from({length:365}, (_, i) => new Date(Date.parse(firstDate + 'T16:00:00Z') + i * 86400000).toISOString().slice(0, 10));
assert.equal(dates.at(-1), lastDate);
// Keep all ten current public notices active throughout the private audit year.
const notices = JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''))
  .map(item => ({...item, startsAt:'2020-01-01T00:00:00.000Z', endsAt:null}));
assert.equal(notices.length, 10, 'The public fixture includes all ten announcements');
const screenshots = process.env.YEAR_LAYOUT_SCREENSHOT_DIR || process.env.BOARD_SCREENSHOT_DIR;
const scale = Number(process.env.DISPLAY_TEST_SCALE) || 1;
const results = [], failures = [], shapes = new Map(), capture = new Map();
const began = Date.now();
let browser;

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  browser = await chromium.launch({channel:'chrome', headless:true});
  const page = await browser.newPage({viewport:{width:1920 * scale, height:1080 * scale}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/display/`);
  await page.evaluate(async () => {
    await document.fonts.load('700 28px David');
    await document.fonts.ready;
    const {DisplayView} = await import('/display-assets/renderer.js');
    document.body.innerHTML = '<div id="year-audit" style="width:100vw;height:100vh"></div>';
    window.yearAudit = new DisplayView(document.querySelector('#year-audit'));
  });
  if (screenshots) await mkdir(screenshots, {recursive:true});

  async function inspect(date, schedule, theme) {
    const at = date + 'T16:00:00.000Z';
    const snapshot = {at, schedule, items:notices, upcoming:[], appearance:{mode:theme}};
    return page.evaluate(async ({snapshot, scale}) => {
      const view = window.yearAudit;
      view.update(snapshot, {preview:true, now:100000});
      await document.fonts.ready;
      const host = view.stage.querySelector('.original-sheet-host');
      if (host) await host.originalSheetReady;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const root = view.stage, issues = [];
      const normalize = text => String(text ?? '').replace(/[\s\uE000\uE001/]+/g, '');
      const rect = e => { const r = e.getBoundingClientRect(); return {left:r.left/scale, top:r.top/scale, right:r.right/scale, bottom:r.bottom/scale, width:r.width/scale, height:r.height/scale}; };
      const short = text => String(text ?? '').replace(/\s+/g, ' ').slice(0, 100);
      const rounded = r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, Math.round(v * 10) / 10]));
      const outside = (a, b) => a.left < b.left - 2 || a.right > b.right + 2 || a.top < b.top - 2 || a.bottom > b.bottom + 2;
      const add = (code, details = {}) => issues.push({code, ...details});
      const identify = e => e.dataset.sourceId || e.className || e.tagName;
      function auditPanel(panel, selector) {
        const bounds = rect(panel);
        if (outside(bounds, rect(root))) add('panel-outside-screen', {element:identify(panel), bounds:rounded(bounds)});
        if (panel.scrollHeight > panel.clientHeight + 2 || panel.scrollWidth > panel.clientWidth + 2)
          add('panel-overflow', {element:identify(panel), extraWidth:panel.scrollWidth-panel.clientWidth, extraHeight:panel.scrollHeight-panel.clientHeight});
        for (const el of panel.querySelectorAll(selector)) {
          if (!el.getClientRects().length) continue;
          const box = rect(el);
          if (outside(box, bounds)) add('box-outside-panel', {element:identify(el), text:short(el.textContent), box:rounded(box), panel:rounded(bounds)});
        }
        // Range rectangles expose text that overhangs a fitting element box.
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        for (let text; (text = walker.nextNode());) if (text.textContent.trim() && text.parentElement.getClientRects().length) {
          const range = document.createRange(); range.selectNodeContents(text);
          for (const r of range.getClientRects()) {
            const ink = {left:r.left/scale, right:r.right/scale, top:r.top/scale, bottom:r.bottom/scale};
            if (outside(ink, bounds)) add('text-outside-panel', {element:identify(text.parentElement), text:short(text.textContent), ink:rounded(ink), panel:rounded(bounds)});
            // Any clipping ancestor can hide ink even while the outer panel fits.
            for (let ancestor = text.parentElement; ancestor && ancestor !== panel; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor), clipsX = /hidden|clip|scroll|auto/.test(style.overflowX), clipsY = /hidden|clip|scroll|auto/.test(style.overflowY);
              if (!clipsX && !clipsY) continue;
              const a = rect(ancestor);
              if ((clipsX && (ink.left < a.left-2 || ink.right > a.right+2)) || (clipsY && (ink.top < a.top-2 || ink.bottom > a.bottom+2)))
                add('text-clipped-by-ancestor', {element:identify(ancestor), text:short(text.textContent)});
            }
          }
        }
      }
      for (const panel of root.querySelectorAll('.board-weekly,.board-shabbos,.board-zmanim,.announcement-group,.tv-head,.tv-footer'))
        auditPanel(panel, '.board-service,.board-pattern,.board-schedule-row,.board-prayer-label,.board-times,.board-zmanim>div,.announcement-section,h2,h3,h4,p');
      if (view.warning.length) add('capacity-warning', {warnings:view.warning});
      if (root.dataset.theme !== snapshot.appearance.mode) add('wrong-theme');
      if (root.querySelector('.tv-preview-label').hidden) add('private-label-missing');

      const p = snapshot.schedule.presentation;
      const activeSheet = snapshot.schedule.specialSheet && snapshot.at >= snapshot.schedule.specialSheet.previewStartsAt && snapshot.at < snapshot.schedule.specialSheet.endsAt;
      const both = activeSheet && snapshot.at >= snapshot.schedule.specialSheet.coversBothAt;
      const expectedRows = [...(!both ? p.weekly.posterSections || [] : []), ...(!activeSheet ? p.special?.sections || [] : [])].flatMap(section => section.rows);
      const actualRows = [...root.querySelectorAll('.board-schedule-row')];
      const expectedIds = expectedRows.map(row => row.id).sort(), actualIds = actualRows.map(row => row.dataset.sourceId).sort();
      if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) add('source-ids', {expected:expectedIds, actual:actualIds});
      for (const row of expectedRows) {
        const actual = actualRows.find(el => el.dataset.sourceId === row.id), text = normalize(actual?.textContent);
        const fields = [row.label, ...(row.times || []).flatMap(t => [t.text, t.name, t.mark]), ...String(row.note || '').split('\n')].filter(Boolean);
        for (const field of fields) if (!text.includes(normalize(field)) && !(row.plagDetail && field === row.note)) add('source-text', {id:row.id, missing:short(field)});
      }
      if (!both) {
        // Check every source date/prayer independently of how it is visually
        // grouped. A date may appear in a shared line or a separate full day.
        const patterns = [...root.querySelectorAll('[data-weekday-service]')];
        for (const service of p.weekly.services) {
          for (const group of service.groups.filter(group => group.events.length)) for (const day of group.days) {
            const matches = patterns.filter(el => el.dataset.weekdayService === service.name && el.dataset.weekdayDates.split(',').includes(day.date));
            if (matches.length !== 1) add('weekday-date-coverage', {service:service.name,date:day.date,count:matches.length});
            const text = normalize(matches[0]?.textContent), source = group.events.find(event => event.sourceText);
            const fields = source ? [source.sourceText] : group.events.flatMap(event => [event.time, event.note]);
            for (const field of fields.filter(Boolean)) if (!text.includes(normalize(field))) add('weekday-time', {service:service.name,date:day.date,missing:short(field)});
          }
        }
      }
      const sections = [...view.notices.querySelectorAll('.announcement-section')], seen = sections.map(section => section.dataset.sourceId).sort();
      if (JSON.stringify(seen) !== JSON.stringify(snapshot.items.map(item => item.id).sort())) add('announcement-ids', {seen});
      if (Number(view.notices.dataset.pages) !== 1) add('announcements-paginated');
      for (const item of snapshot.items) {
        const section = sections.find(el => el.dataset.sourceId === item.id);
        if (!section?.getClientRects().length || !section.clientHeight || getComputedStyle(section).visibility !== 'visible') add('announcement-hidden', {id:item.id});
        for (const field of [item.title, item.data.message, item.data.contact, item.data.phone].filter(Boolean))
          if (!section?.textContent.includes(field)) add('announcement-text', {id:item.id, missing:short(field)});
      }
      const exceptions = [...root.querySelectorAll('.board-exception')];
      for (const exception of exceptions) {
        const previous = exception.previousElementSibling;
        if (previous && rect(exception).top - rect(previous).bottom < 13)
          add('exception-too-close', {label:short(exception.textContent),gap:rect(exception).top-rect(previous).bottom});
      }
      for (const exception of exceptions) {
        const heading = rect(exception.querySelector('h4')), times = exception.querySelector('.board-times'), timeBox = rect(times);
        if (heading.bottom > timeBox.top + 2) add('exception-label-not-above', {label:short(exception.querySelector('h4').textContent), heading:rounded(heading), times:rounded(timeBox)});
        const lines = new Map();
        for (const child of times.children) {
          const b = rect(child), key = Math.round(b.bottom/3)*3;
          const line = lines.get(key) || {left:Infinity, right:-Infinity};
          line.left = Math.min(line.left,b.left); line.right = Math.max(line.right,b.right); lines.set(key,line);
        }
        for (const line of lines.values()) if (Math.abs((line.left+line.right-timeBox.left-timeBox.right)/2) > 3)
          add('exception-times-not-centered', {label:short(exception.querySelector('h4').textContent), centerOffset:Math.round((line.left+line.right-timeBox.left-timeBox.right)/2)});
      }
      for (const section of root.querySelectorAll('.board-day-section')) {
        const previous=section.previousElementSibling;
        if(previous && rect(section).top-rect(previous).bottom<15)add('day-section-too-close');
        for(const service of section.querySelectorAll('.board-day-service')) {
          if(rect(service.querySelector('h4')).bottom>rect(service.querySelector('.board-times')).top)add('day-prayer-label-not-above');
        }
      }
      const zmanim = [...root.querySelectorAll('.board-zmanim>div')];
      if (zmanim.length !== snapshot.schedule.zmanim.length) add('zmanim-count');
      for (const [i, zman] of snapshot.schedule.zmanim.entries()) {
        const el = zmanim[i];
        if (!normalize(el?.textContent).includes(normalize(zman.time)) || !normalize(el?.textContent).includes(normalize(zman.label))) add('zmanim-source-text', {index:i, expected:zman});
        if (/\d:\d{2}:\d{2}/.test(zman.time) && !el?.querySelector('.zman-seconds')) add('seconds-style-missing', {time:zman.time});
      }
      for (const seconds of root.querySelectorAll('.time-seconds,.board-seconds,.zman-seconds'))
        if (Number(getComputedStyle(seconds).fontWeight) > 400) add('seconds-bold', {text:seconds.textContent, weight:getComputedStyle(seconds).fontWeight});

      let sheetRows = 0, sheetColumns = 0;
      if (activeSheet) {
        if (!host || host.dataset.sheetReady !== 'true') add('special-sheet-not-ready');
        else {
          const {originalSheetHTML} = await import('/display-assets/original-sheet.js');
          const template = document.createElement('template'); template.innerHTML = originalSheetHTML(snapshot.schedule.specialSheet);
          const signature = row => JSON.stringify({label:normalize(row.querySelector('.onepage-label')?.textContent), times:normalize(row.querySelector('.onepage-times')?.textContent), underlines:[...row.querySelectorAll('u')].map(u => normalize(u.textContent))});
          const expected = [...template.content.querySelector('template').content.querySelectorAll('.onepage-row')].map(signature).sort();
          const shadow = host.shadowRoot, actual = [...shadow.querySelectorAll('.onepage-row')].map(signature).sort();
          if (getComputedStyle(shadow.querySelector('.original-page')).visibility !== 'visible') add('special-sheet-hidden');
          sheetRows = actual.length; sheetColumns = shadow.querySelectorAll('.onepage-col').length;
          if (JSON.stringify(expected) !== JSON.stringify(actual)) add('special-source-rows', {expected:expected.length, actual:actual.length});
          if (sheetColumns !== 2) add('special-columns', {actual:sheetColumns});
          if (shadow.querySelectorAll('.onepage-sec:not(:has(.onepage-sec-head))').length) add('special-orphaned-days');
          // The shadow page, including every actual text line, must fit its host.
          const bounds = rect(host), poster = shadow.querySelector('.poster');
          for (const el of shadow.querySelectorAll('.onepage-row,.onepage-title,.onepage-sec-head,.onepage-label,.onepage-times,.onepage-note')) {
            const box = rect(el);
            if (outside(box,bounds) || el.scrollWidth > el.clientWidth+2 || el.scrollHeight > el.clientHeight+2)
              add('special-box-overflow', {element:identify(el), text:short(el.textContent), box:rounded(box), host:rounded(bounds)});
          }
          const walker = document.createTreeWalker(poster,NodeFilter.SHOW_TEXT);
          for (let text; (text = walker.nextNode());) if (text.textContent.trim()) {
            const range = document.createRange(); range.selectNodeContents(text);
            for (const r of range.getClientRects()) {
              const ink = {left:r.left/scale,right:r.right/scale,top:r.top/scale,bottom:r.bottom/scale};
              if (outside(ink,bounds)) add('special-text-overflow', {text:short(text.textContent), ink:rounded(ink), host:rounded(bounds)});
            }
          }
        }
      }
      const shabbos = root.querySelector('.board-shabbos'), body = shabbos?.querySelector('.board-shabbos-body');
      const shabbosRows = [...(body?.querySelectorAll('.board-schedule-row') || [])];
      let trailingSpace = null;
      if (shabbosRows.length >= 5) {
        trailingSpace = rect(body).bottom - rect(shabbosRows.at(-1)).bottom;
        const average = shabbosRows.reduce((sum,row) => sum + rect(row).height,0)/shabbosRows.length;
        if (trailingSpace > Math.max(48,average)) add('shabbos-unused-height', {trailingSpace:Math.round(trailingSpace), bodyHeight:Math.round(rect(body).height), rows:shabbosRows.length});
      }
      if (root.querySelectorAll('.board-static-column').length) add('shabbos-split-columns');
      const footer = root.querySelector('.tv-footer'), noticeBox = rect(view.notices);
      const right = root.querySelector('.board-shabbos,.original-sheet-box');
      if (right && rect(right).bottom > rect(footer).top+2) add('right-overlaps-footer');
      if (right && rect(right).bottom > noticeBox.top+2 && rect(right).left < noticeBox.right-2) add('right-overlaps-notices');
      // Theme changes are tested for each distinct layout, not all repetitions
      // of a week. Content is nevertheless measured on every date in dark mode.
      const geometry = JSON.stringify({
        classes:root.className, sheet:activeSheet ? snapshot.schedule.specialSheet.sourceId : null,
        panels:[...root.querySelectorAll('.board-weekly,.board-shabbos,.board-zmanim,.original-sheet-box,.announcement-group')].map(e => [identify(e),Math.round(rect(e).width),Math.round(rect(e).height)]),
        rowHeights:actualRows.map(e => Math.round(rect(e).height)),
        serviceHeights:[...root.querySelectorAll('.board-service')].map(e => Math.round(rect(e).height)),
        exceptionHeights:exceptions.map(e => Math.round(rect(e).height)), sheetRows,
      });
      return {issues,geometry,special:activeSheet ? snapshot.schedule.specialSheet.sourceId : null,placement:both?'both':'shabbos',rows:actualRows.length,sourceGaps:expectedIds.filter(id => id.startsWith('missing:')),sheetRows,sheetColumns,exceptions:exceptions.length,shabbosRows:shabbosRows.length,trailingSpace:trailingSpace===null?null:Math.round(trailingSpace),pages:Number(view.notices.dataset.pages),notices:seen.length};
    }, {snapshot, scale});
  }

  function record(date, theme, result) {
    const {geometry, issues, ...metrics} = result;
    results.push({date, theme, ...metrics});
    if (issues.length) failures.push({date, theme, issues});
  }
  let densest = null;
  for (const date of dates) {
    const schedule = scheduleSnapshot(date+'T16:00:00.000Z');
    const result = await inspect(date, schedule, 'dark');
    record(date, 'dark', result);
    if (!shapes.has(result.geometry)) shapes.set(result.geometry, {date,schedule});
    const representative = result.special ? `special-${result.special}-${result.placement}` : 'ordinary';
    if (!capture.has(representative)) capture.set(representative,{date,schedule,theme:'dark'});
    const density = result.rows + result.sheetRows + result.exceptions*3;
    if (!densest || density > densest.density) densest = {date,schedule,theme:'dark',density};
    if (result.issues.length && [...capture.keys()].filter(key => key.startsWith('failure-')).length < 4) {
      const key = 'failure-' + result.issues[0].code;
      if (!capture.has(key)) capture.set(key,{date,schedule,theme:'dark'});
    }
    if (results.length % 60 === 0) console.error(`Year layout audit: ${results.length}/365 dates checked (${Math.round((Date.now()-began)/1000)}s).`);
  }
  for (const [geometry,{date,schedule}] of shapes) {
    const result = await inspect(date,schedule,'light');
    if (result.geometry !== geometry) result.issues.push({code:'theme-changed-geometry'});
    record(date,'light',result);
  }
  // Tzom Gedalya this year precedes the rolling annual window; include short
  // future weeks where the fast and ordinary patterns are tied in frequency.
  const extraDates=['2026-09-14','2026-09-17','2029-09-12','2029-09-13','2032-09-08','2032-09-09','2028-04-26'];
  for (const date of extraDates) for (const theme of ['dark','light']) {
    const schedule=scheduleSnapshot(date+'T16:00:00.000Z');
    record(date,theme,await inspect(date,schedule,theme));
    if(theme==='dark')capture.set('weekday-exceptions-'+date,{date,schedule,theme});
  }
  if (densest) capture.set('densest',densest);
  if (screenshots) for (const [label,{date,schedule,theme}] of capture) {
    await inspect(date,schedule,theme);
    await page.screenshot({path:path.join(screenshots,`year-${label.replace(/[^\w-]/g,'-')}-${date}-${theme}.png`)});
  }
  const grouped = new Map();
  for (const failure of failures) for (const issue of failure.issues) {
    const key = issue.code;
    if (!grouped.has(key)) grouped.set(key,{code:key,cases:new Set(),sample:{date:failure.date,theme:failure.theme,...issue}});
    grouped.get(key).cases.add(failure.date+' '+failure.theme);
  }
  const report = {
    from:firstDate,to:lastDate,days:dates.length,darkChecks:dates.length,lightChecks:shapes.size,extraDates,
    elapsedSeconds:Math.round((Date.now()-began)/1000),
    specialDays:results.filter(r => r.theme==='dark' && r.special).length,
    maximumSourceRows:Math.max(...results.map(r => r.rows+r.sheetRows)),
    maximumExceptions:Math.max(...results.map(r => r.exceptions)),
    noticesPerScreen:[...new Set(results.map(r => r.notices))],
    publishedSourceGapDates:results.filter(r => r.theme==='dark' && r.sourceGaps.length).map(r => r.date),
    screenshots:screenshots ? [...capture].map(([kind,value]) => ({kind,date:value.date})) : [],
    failingCases:failures.length,
    failures:[...grouped.values()].map(({code,cases,sample}) => ({code,count:cases.size,first:[...cases][0],last:[...cases].at(-1),sample})),
    browserErrors:errors,
  };
  if (process.env.YEAR_LAYOUT_REPORT) await writeFile(process.env.YEAR_LAYOUT_REPORT,JSON.stringify({summary:report,results,failures},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  assert.deepEqual(errors,[], 'No browser errors during the annual audit');
  assert.equal(failures.length,0, 'Year layout failures are summarized above');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
