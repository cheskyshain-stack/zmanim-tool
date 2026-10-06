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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/admin/#charts');
    await page.locator('#main').waitFor();
    const result = await page.evaluate(async () => {
      const { loadTables } = await import('/js/data-loader.js');
      const { buildAutomaticCharts } = await import('/js/publish.js');
      const { resolveSettings } = await import('/js/settings.js');
      const { buildChanukahPoster } = await import('/js/posters/chanukah.js');
      const { buildChorefRow, CHOREF_COLUMNS } = await import('/js/sheets/choref.js');
      const { buildKayitzRow } = await import('/js/sheets/kayitz.js');
      const { weeklyReaderData, readerWeekIndex } = await import('/js/ui/weekly-reader.js');
      const { weeklyAgenda } = await import('/js/ui/weekly-agenda.js');
      const { erevShabbosText } = await import('/js/erev-text.js');
      const { renderSheet } = await import('/js/ui/sheet-view.js');
      const { dateFromSerial } = await import('/js/zmanim/solar.js');
      const tables = await loadTables();
      const config = await (await fetch('/data/published.json')).json();
      const state = buildAutomaticCharts(config, tables, new Date('2026-10-06T12:00:00Z'));
      const settings = resolveSettings(state.settings), index = readerWeekIndex(state);
      const expected = ['12:30', '1:00', '1:15', '1:35', '1:50', '2:15', '3:00'];
      const clocks = text => text.match(/\d{1,2}:\d{2}/g) || [];
      const check = (value, message) => { if (!value) throw Error(message); };
      const years = [...new Set(state.sheets.map(sheet => sheet.hebrewYear))].sort();
      const checked = [];
      for (const year of years) {
        const poster = buildChanukahPoster(year, settings, tables);
        for (const friday of poster.erevShabbosList) {
          const week = index.get(friday.shabbosSerial).week;
          const winter = buildChorefRow(week, settings), summer = buildKayitzRow(week, settings);
          for (const menu of [winter.I, summer.L, friday.times.slice(0, -1).map(time => time.text()).join(' / ')]) {
            check(JSON.stringify(clocks(menu)) === JSON.stringify(expected), 'Friday menu changed in ' + year + ': ' + menu);
          }
          check(!winter.printOverrides?.I && !summer.printOverrides?.L, 'Retired Friday badge remains');
          check(!/12:15|12:20/.test(erevShabbosText(CHOREF_COLUMNS, winter, 'Chanukah')), 'Retired time remains in the Friday message');
          const data = weeklyReaderData(friday.shabbosSerial, index, state, settings);
          const agenda = weeklyAgenda(data, friday.shabbosSerial, state, settings, dateFromSerial(friday.shabbosSerial - 6));
          const mincha = agenda.sections.flatMap(section => section.events).filter(event => event.serial === friday.serial && /מנחה/.test(event.name) && !event.auxiliary);
          check(!mincha.some(event => event.mins === 735 || event.mins === 740), 'Retired minyan remains in the weekly agenda');
          check(expected.every(time => mincha.some(event => {
            const [hour, minute] = time.split(':').map(Number);
            return event.mins === (hour === 12 ? 12 : hour + 12) * 60 + minute;
          })), 'Regular Friday minyanim missing from the weekly agenda');
          checked.push({ year, friday: dateFromSerial(friday.serial).toISOString().slice(0, 10) });
        }
      }
      const sheet = state.sheets.find(sheet => sheet.hebrewYear === 5787 && sheet.season === 'choref');
      renderSheet(document.querySelector('#main'), state, sheet, () => {});
      return { checked, expected };
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const menus = await page.locator('#pages .page[data-sheet-label="שבת חורף"] tr').filter({ hasText: /חנוכה/ }).locator('.cell[data-col=I]').allTextContents();
    assert.equal(menus.length, 2, 'Both Chanukah Fridays in the screenshot are printed');
    for (const menu of menus) assert.deepEqual(menu.match(/\d{1,2}:\d{2}/g), result.expected);
    await page.emulateMedia({ media: 'print' });
    const sizes = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => page.getBoundingClientRect().height));
    assert(sizes.every(height => Math.abs(height - 816) < 1), 'Every printed page still fits Letter landscape: ' + JSON.stringify(sizes));
    if (process.env.CHANUKAH_CHART_SCREENSHOT) await page.locator('#pages .page').first().screenshot({ path: process.env.CHANUKAH_CHART_SCREENSHOT });
    await page.pdf({ path: process.env.CHANUKAH_CHART_PDF || undefined, preferCSSPageSize: true, printBackground: true });
    assert.deepEqual(errors, [], 'No browser errors');
    console.log(JSON.stringify({ ...result, printedChanukahRows: menus.length, pageHeights: sizes, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
