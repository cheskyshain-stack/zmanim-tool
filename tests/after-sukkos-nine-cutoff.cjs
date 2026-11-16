// Run after build-offline.py with Playwright on NODE_PATH.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const points = [
      { at: '2026-10-09T00:00:00Z', present: true, label: 'Thursday evening in Lakewood, already Friday in UTC' },
      { at: '2026-10-09T03:59:59.999Z', present: true, label: 'Last instant of Thursday in Lakewood' },
      { at: '2026-10-09T04:00:00Z', present: false, label: 'Friday midnight in Lakewood' },
    ];
    const results = [];
    for (const point of points) {
      await page.clock.setFixedTime(new Date(point.at));
      await page.goto(origin + '/admin/#posters/sukkos');
      await page.locator('#poster-sheet .poster-block').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const afterBlock = page.locator('#poster-sheet .poster-block').filter({ has: page.locator('h3', { hasText: 'זמני תפילה אחר סוכות' }) });
      const row = afterBlock.locator('.poster-row').filter({ has: page.locator('.poster-row-label', { hasText: 'מעריב' }) });
      const times = (await row.textContent()).match(/\d{1,2}:\d{2}/g);
      const expected = ['7:30', '8:00', '8:30', '8:45', ...(point.present ? ['9:00'] : []), '9:30', '10:00', '10:30', '11:00', '11:30', '12:00'];
      assert.deepEqual(times, expected, point.label + ': printed after-Sukkos schedule');
      const model = await page.evaluate(async ({ present }) => {
        const { buildSukkosAfter, buildSukkosPoster } = await import('/js/posters/sukkos.js');
        const { buildAfterYomKippur } = await import('/js/posters/yomkippur.js');
        const { roshHashana } = await import('/js/hebrew-calendar.js');
        const { resolveSettings } = await import('/js/settings.js');
        const { buildWeekdayRow } = await import('/js/sheets/weekday.js');
        const { loadTables } = await import('/js/data-loader.js');
        const { buildAutomaticCharts } = await import('/js/publish.js');
        const { minyanimForDay } = await import('/js/upcoming.js');
        const { excelSerial } = await import('/js/zmanim/solar.js');
        const config = await (await fetch('/data/published.json')).json();
        const settings = resolveSettings(config.settings);
        const hasNine = schedule => schedule.maariv.some(time => time.text === '9:00');
        const check = (value, message) => { if (!value) throw Error(message); };
        check(hasNine(buildSukkosAfter(roshHashana(5787 - 3761), settings)) === present, 'Shared source cutoff differs from the poster');
        const futureYears = [5788, 5789, 5790];
        for (const year of futureYears) check(!hasNine(buildSukkosAfter(roshHashana(year - 3761), settings)), 'Future after-Sukkos schedule still carries 9:00 in ' + year);
        check(hasNine(buildAfterYomKippur(5787, settings)), 'After-Yom-Kippur 9:00 was removed');
        const poster = buildSukkosPoster(5787, settings);
        const chol = poster.blocks.find(block => block.heading === 'חול המועד');
        check(chol.lines.find(line => line.label === 'מעריב').times.some(time => time.text === '9:00'), 'Chol Hamoed 9:00 was removed');
        const week = { serial: excelSerial(new Date('2026-10-10T00:00:00Z')) };
        const winter = buildWeekdayRow(week, settings);
        check(/\b9:00\b/.test(winter.B) === present, 'Weekday chart disagrees with the poster cutoff');
        const state = buildAutomaticCharts(config, await loadTables(), new Date('2026-10-06T12:00:00Z'));
        const events = date => minyanimForDay(excelSerial(new Date(date + 'T00:00:00Z')), state, settings);
        const nine = event => /מעריב/.test(event.name) && event.mins === 21 * 60;
        check(events('2026-10-08').some(nine) === present, 'Thursday minyan data disagrees with the cutoff');
        check(!events('2026-10-09').some(nine), 'Friday offers the expired 9:00');
        check(!events('2026-10-11').some(nine), 'The next week offers the expired 9:00');
        return { futureYears, currentChartHasNine: /\b9:00\b/.test(winter.B) };
      }, point);
      await page.emulateMedia({ media: 'print' });
      const bounds = await page.locator('#poster-sheet .poster').evaluateAll(pages => pages.map(page => {
        const box = page.getBoundingClientRect();
        return { width: box.width, height: box.height, overflow: page.scrollHeight > page.clientHeight + 1 };
      }));
      assert(bounds.length && bounds.every(box => Math.abs(box.height - 1056) < 1 && !box.overflow), 'Sukkos poster fits Letter portrait: ' + JSON.stringify(bounds));
      await page.pdf({ preferCSSPageSize: true, printBackground: true });
      await page.emulateMedia({ media: 'screen' });
      if (process.env.AFTER_SUKKOS_SCREENSHOT_PREFIX) await page.locator('#poster-sheet').screenshot({ path: process.env.AFTER_SUKKOS_SCREENSHOT_PREFIX + (point.present ? '-before.png' : '-after.png') });
      await page.locator('label[for=poster-sheets-all]').click();
      await page.locator('#poster-sheet .onepage-row').first().waitFor();
      const combined = page.locator('#poster-sheet .onepage-row').filter({ hasText: 'מעריב' }).filter({ has: page.locator('.onepage-line') });
      assert(await combined.count(), 'Combined Sukkos poster is rendered');
      const afterCombined = await page.locator('#poster-sheet').evaluate(sheet => {
        const heading = [...sheet.querySelectorAll('h3')].find(el => el.textContent.includes('זמני תפילה אחר סוכות'));
        if (!heading) return null;
        return heading.parentElement.textContent;
      });
      assert(afterCombined !== null, 'Combined poster includes the after-Sukkos block');
      assert.equal(afterCombined.includes('9:00'), point.present, 'Combined poster follows the cutoff: ' + afterCombined);
      if (!point.present) {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.waitForTimeout(100);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Combined poster has no phone overflow');
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('#poster-sheet .poster').evaluate(el => el.offsetHeight), 1056, 'Phone poster retains its full Letter portrait layout');
        await page.pdf({ path: process.env.AFTER_SUKKOS_PHONE_PDF || undefined, preferCSSPageSize: true, printBackground: true });
      }
      results.push({ ...point, times, ...model, bounds });
    }
    assert.deepEqual(errors, [], 'No browser errors');
    console.log(JSON.stringify({ results, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
