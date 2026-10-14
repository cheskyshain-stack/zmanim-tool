// Crowded charts keep their page breaks and print larger text without clipping.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.DENSE_CHART_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.DENSE_CHART_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], checks = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 375 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/admin/#charts', { waitUntil: 'domcontentloaded' });
      await page.locator('#main').waitFor();
      for (const fixture of [
        { year: 5787, season: 'choref', count: 2, molad: 'compact' },
        { year: 5785, season: 'choref', count: 2, molad: 'yiddish', dst: true },
        { year: 5787, season: 'kayitz', count: 2, molad: 'compact' },
        { year: 5787, season: 'choref', count: 1, molad: 'compact' },
      ]) {
        const original = await page.evaluate(async fixture => {
          const { loadTables } = await import('/js/data-loader.js');
          const { buildAutomaticCharts } = await import('/js/publish.js');
          const { alignPageSizesTo, defaultPageSizes } = await import('/js/pagination.js');
          const { renderSheet } = await import('/js/ui/sheet-view.js');
          const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), new Date('2026-10-14T12:00:00Z'));
          state.settings.showMolad = true;
          state.settings.moladFormat = fixture.molad;
          const sheet = state.sheets.find(sheet => sheet.id === `auto-${fixture.season}-${fixture.year}`);
          const companion = state.sheets.find(candidate => candidate.linkedSheetId === sheet.id);
          sheet.columnWidths = {};
          companion.columnWidths = {};
          sheet.style.splitSpringDst = Boolean(fixture.dst);
          sheet.pageSizes = defaultPageSizes(sheet.weeks.length, fixture.count, fixture.season);
          companion.pageSizes = alignPageSizesTo(sheet.weeks, sheet.pageSizes, companion.weeks);
          const saved = JSON.stringify(state);
          window.denseFixture = { state, sheet, redraw: () => renderSheet(document.querySelector('#main'), state, sheet, () => {}) };
          denseFixture.redraw();
          return { saved, weeks: [sheet.weeks.length, companion.weeks.length] };
        }, fixture);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const notice = await page.locator('#page-fit-notice').textContent();
        assert(await page.locator('#page-overflow-warning').isHidden(), 'The crowded job fits');
        assert.equal(await page.evaluate(() => JSON.stringify(denseFixture.state)), original.saved, 'Fitting preserves saved styles, weeks, overrides and page breaks');
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        // The mobile viewport's print fallback zoom is not the physical Letter box.
        const paperZoom = await page.addStyleTag({ content: '#pages .page { zoom: 1 !important; }' });
        const geometry = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => {
          const box = page.getBoundingClientRect(), tables = [...page.querySelectorAll('table')];
          const footer = page.querySelector('.page-footer').getBoundingClientRect();
          const fits = tables[0].getBoundingClientRect().top >= page.querySelector('.page-header').getBoundingClientRect().bottom - .5
            && tables.at(-1).getBoundingClientRect().bottom <= footer.top + .5
            && footer.bottom <= box.bottom - parseFloat(getComputedStyle(page).paddingBottom) + .5;
          const panelFits = [...page.querySelectorAll('.shacharis-panel')].every(panel => {
            const card = panel.getBoundingClientRect(), content = panel.firstElementChild.getBoundingClientRect(), body = panel.closest('tbody').getBoundingClientRect();
            return card.top >= body.top - .5 && card.bottom <= body.bottom + .5
              && content.top >= card.top - .5 && content.bottom <= card.bottom + .5
              && content.left >= card.left - .5 && content.right <= card.right + .5;
          });
          const textFits = [...page.querySelectorAll('td .cell,th')].every(node => {
            const range = document.createRange(); range.selectNodeContents(node);
            const cell = node.closest('td,th').getBoundingClientRect();
            return [...range.getClientRects()].every(rect => rect.width < .1 || rect.height < .1
              || (rect.left >= cell.left - .5 && rect.right <= cell.right + .5 && rect.top >= cell.top - .5 && rect.bottom <= cell.bottom + .5));
          });
          return { rows: page.querySelectorAll('tbody tr').length, height: box.height,
            font: parseFloat(getComputedStyle(page).getPropertyValue('--sheet-font-size')),
            fits, panelFits, textFits, times: (page.innerText.match(/\b\d{1,2}:\d{2}\b/g) || []).sort() };
        }));
        assert(geometry.every(p => p.height <= 816.004 && p.fits && p.panelFits && p.textFits), JSON.stringify({ fixture, width, geometry: geometry.map(({ times, ...p }) => p) }));
        assert.deepEqual([geometry.filter((_, i) => i % 2 === 0).reduce((sum, p) => sum + p.rows, 0), geometry.filter((_, i) => i % 2).reduce((sum, p) => sum + p.rows, 0)], original.weeks, 'Every original week still appears once');
        if (fixture.year === 5787 && fixture.season === 'choref' && fixture.count === 2)
          assert(geometry.every(p => p.font >= 8.5 - .000001), 'The approved dense chart uses at least 85% of its chosen 10pt size');
        await paperZoom.evaluate(node => node.remove());
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, fixture.count * 2, 'The original physical page count is preserved');
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 792 612]'), 'Each sheet is landscape Letter');
        const texts = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(text => text.trim());
        assert.deepEqual(texts.map(text => (text.match(/\b\d{1,2}:\d{2}\b/g) || []).sort()), geometry.map(p => p.times), 'Every time stays on its original printed page');
        const bounds = execFileSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
        const addresses = [...bounds.matchAll(/<word\b[^>]*yMin="([\d.]+)"[^>]*>Bais<\/word>/g)].map(match => Number(match[1]));
        assert.equal(addresses.length, fixture.count * 2, 'Every physical sheet has its own footer');
        assert(addresses.every(y => y > 459 && y < 587) && Math.max(...addresses) - Math.min(...addresses) < .01, 'The printed footers remain aligned at the bottom');
        assert.equal(await page.evaluate(() => JSON.stringify(denseFixture.state)), original.saved);
        if (output) fs.writeFileSync(path.join(output, `${width}-${fixture.season}-${fixture.year}-${fixture.count}.pdf`), pdf);
        checks.push({ width, fixture, notice, fonts: geometry.map(p => p.font) });
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(() => denseFixture.redraw());
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('#page-fit-notice').textContent(), notice, 'Reopening does not shrink text again');
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
