// Run after build-offline.py. Set NODE_PATH to Playwright when it is not installed locally.
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
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chrome' }),
  });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/')
      || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const settled = async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
    };
    const generate = async (year, count = 3, season = 'choref') => {
      await page.goto(origin + `/admin/?year=${year}&pages=${count}&season=${season}#generate`);
      await page.locator(`label[for=season-${season}]`).click();
      await page.locator('input[name=hebrewYear]').fill(String(year));
      await page.locator('#gen-form button[type=submit]').click();
      if (count !== 3) {
        await page.locator('input[name=numPages]').fill(String(count));
        await page.locator('input[name=numPages]').dispatchEvent('change');
      }
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page').first().waitFor();
      await settled();
    };
    const cells = () => page.locator('#pages .page[data-sheet-label="שבת חורף"]').evaluateAll(pages =>
      Object.fromEntries(pages.flatMap(page => [...page.querySelectorAll('.cell')]
        .map(cell => [cell.dataset.serial + ':' + cell.dataset.col, cell.innerText]))));
    const verify = async (count, label) => {
      const measurements = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => {
        const box = page.getBoundingClientRect();
        const rows = [...page.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height);
        const body = [...page.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect().height);
        const headers = [...page.querySelectorAll('thead tr')].map(row => row.getBoundingClientRect().height);
        return { height: box.height, spread: Math.max(...body) - Math.min(...body),
          headerFits: Math.min(...headers) >= Math.max(...body) - 1,
          equalSections: !page.querySelector('.chart-sections') || Math.max(...rows) - Math.min(...rows) < 1,
          fits: page.querySelector('.page-footer').getBoundingClientRect().bottom <= box.bottom + 1,
          label: page.dataset.sheetLabel };
      }));
      assert.equal(measurements.length, count, label + ': page count');
      measurements.forEach((measurement, index) => {
        assert(Math.abs(measurement.height - 816) <= 2, label + ': sheet height ' + index);
        assert(measurement.spread < 1, label + ': equal rows ' + index + ' ' + measurement.spread);
        assert(measurement.headerFits && measurement.equalSections, label + ': header heights ' + index);
        assert(measurement.fits, label + ': footer fits ' + index);
        assert.equal(measurement.label, index % 2 ? 'Weekday' : 'שבת חורף', label + ': print order');
      });
      assert(await page.locator('#page-overflow-warning').isHidden(), label + ': overflow warning');
      return measurements;
    };

    await generate(5787);
    assert.equal(await page.locator('.chart-sections').count(), 0, 'Existing layouts start with one header');
    const menu = page.locator('#pages .page[data-sheet-label="שבת חורף"]').last().locator('.cell[data-col=L]').first();
    const serial = await menu.getAttribute('data-serial');
    await menu.fill('12:47');
    await page.locator('#chart-dst-headers-label').click();
    const original = await cells();
    await page.locator('label[for=chart-dst-headers-separate]').click();
    await settled();
    const separate = await cells();
    for (const [key, text] of Object.entries(separate)) assert.equal(text, original[key], 'Unchanged time ' + key);
    assert.equal(separate[serial + ':L'], '12:47', 'Existing Erev Shabbos edit stays in the winter section');
    const sections = await page.locator('.chart-sections table').evaluateAll(tables => tables.map(table => ({
      columns: table.rows[0].cells.length,
      names: [...table.tBodies[0].rows].map(row => row.querySelector('.parsha-cell').innerText),
    })));
    assert.deepEqual(sections.map(section => section.columns), [9, 12]);
    assert.deepEqual(sections[0].names, ['כי תשא', 'ויקהל · שקלים', 'פקודי']);
    assert.equal(sections[1].names[0], 'ויקרא · זכור');
    console.log('Separate headers:', JSON.stringify(await verify(6, '5787')));

    const edited = page.locator(`.chart-sections .cell[data-serial="${serial}"][data-col=L]`);
    await edited.fill('12:48');
    await page.locator('#chart-dst-headers-label').click();
    await page.locator('label[for=chart-dst-headers-one]').click();
    assert.equal(await page.locator('.chart-sections').count(), 0);
    assert.equal((await cells())[serial + ':L'], '12:48', 'Edits survive switching back');
    await page.locator('label[for=chart-dst-headers-separate]').click();
    await page.goto(origin + '/admin/#saved');
    await page.locator('.saved-list .open-btn').first().click();
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'Saved choice survives reload');
    assert.equal(await page.locator('.chart-sections').count(), 1);

    const publicTables = await page.evaluate(async () => {
      const { buildSheetPages } = await import('/js/ui/sheet-view.js');
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      return buildSheetPages(state.sheets.find(sheet => sheet.season === 'choref'), state, () => {}, { readOnly: true })
        .map(page => page.querySelectorAll('table').length);
    });
    assert.deepEqual(publicTables, [1, 1, 1], 'Public charts keep their existing layout');
    await page.locator('label[for=chart-molad-on]').click();
    await settled();
    await verify(6, 'Compact molad');
    const offsets = await page.locator('.chart-sections .parsha-cell-centered').evaluateAll(cells => cells.map(cell => {
      const td = cell.getBoundingClientRect(), name = cell.querySelector('.parsha-cell-name').getBoundingClientRect();
      return Math.abs((td.top + td.bottom - name.top - name.bottom) / 2);
    }));
    assert(offsets.length > 0 && offsets.every(offset => offset < 1), 'Compact molad names stay centered');
    await page.locator('label[for=chart-molad-format-yiddish]').click();
    await settled();
    await verify(6, 'Yiddish molad');
    assert.equal(await page.locator('.chart-sections .parsha-cell-centered').count(), 0, 'Yiddish stays stacked');
    await page.locator('label[for=chart-molad-off]').click();

    await page.setViewportSize({ width: 375, height: 812 });
    await settled();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    const controls = await page.locator('[aria-labelledby=chart-dst-headers-label]').boundingBox();
    assert(controls.x >= 0 && controls.x + controls.width <= 375, 'Clock-change switch fits on mobile');
    await page.setViewportSize({ width: 1500, height: 1000 });
    await settled();
    await page.emulateMedia({ media: 'print' });
    await verify(6, 'Printed 5787');
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 6, 'PDF has six physical sheets');
    await page.emulateMedia({ media: 'screen' });

    await generate(5786);
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'New layouts remember the choice');
    await verify(6, '5786');
    await generate(5787, 1);
    await verify(2, 'Whole season');
    await page.emulateMedia({ media: 'print' });
    const compactPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    assert.equal((compactPdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2, 'Whole season PDF has two sheets');
    await page.emulateMedia({ media: 'screen' });

    // Open the Weekday companion with a page break exactly at the clock change.
    await page.evaluate(async () => {
      const { renderSheet } = await import('/js/ui/sheet-view.js');
      const { resolveSettings } = await import('/js/settings.js');
      const { inSpringDstWindow } = await import('/js/sheets/common.js');
      const { alignPageSizesTo } = await import('/js/pagination.js');
      const { saveState } = await import('/js/storage.js');
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      const sheet = state.sheets.find(sheet => sheet.season === 'choref' && sheet.pageSizes.length === 1);
      const at = sheet.weeks.findIndex(week => inSpringDstWindow(new Date(week.date), resolveSettings(state.settings)));
      sheet.pageSizes = [at, sheet.weeks.length - at];
      const weekday = state.sheets.find(candidate => candidate.linkedSheetId === sheet.id);
      weekday.pageSizes = alignPageSizesTo(sheet.weeks, sheet.pageSizes, weekday.weeks);
      const draw = () => renderSheet(document.querySelector('main'), state, weekday, event => {
        if (event.save) { saveState(state); draw(); }
      });
      draw();
    });
    await settled();
    assert.equal(await page.locator('.chart-sections').count(), 0, 'A cutover page break needs no second header');
    await verify(4, 'Cutover boundary');
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'Companion shows its winter layout choice');
    await page.locator('label[for=chart-ink-mono]').click();
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-app-state-v1')).settings.sheetStyle.splitSpringDst),
      'Companion padding and ink controls preserve the winter preference');
    await page.locator('label[for=chart-dst-headers-one]').click();
    assert(await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      return state.sheets.filter(sheet => sheet.season === 'choref' && sheet.pageSizes.length === 2)
        .every(sheet => !sheet.style.splitSpringDst);
    }), 'Companion saves the choice on its winter chart');
    await generate(5787, 3, 'kayitz');
    assert.equal(await page.locator('#chart-dst-headers-label, .chart-sections').count(), 0, 'Summer has no winter option');
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('Verified edits, persistence, public charts, both molad formats, mobile controls and PDF pagination.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
