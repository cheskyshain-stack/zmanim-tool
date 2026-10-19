// A crowded seasonal chart must not print its footer over the next chart's header.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.BROWSER_FIT_OUTPUT;
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
  const origin = process.env.BROWSER_FIT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], checks = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) for (const view of ['public', 'admin']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width === 375 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + (view === 'public' ? '/chart/' : '/admin/#charts'));
      await page.locator('.pages .page').first().waitFor();
      for (const fixture of [
        { season: 'choref', count: 3, index: 0 },
        { season: 'choref', count: 2, index: 1 },
        { season: 'kayitz', count: 2, index: 0 },
      ]) {
        const original = await page.evaluate(async fixture => {
          const { loadTables } = await import('/js/data-loader.js');
          const { buildAutomaticCharts } = await import('/js/publish.js');
          const { defaultPageSizes, alignPageSizesTo } = await import('/js/pagination.js');
          const { renderChartBrowser } = await import('/js/ui/chart-view.js');
          const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), new Date('2026-10-19T12:00:00Z'));
          const sheet = state.sheets.find(s => s.id === `auto-${fixture.season}-5787`);
          const companion = state.sheets.find(s => s.linkedSheetId === sheet.id);
          sheet.pageSizes = defaultPageSizes(sheet.weeks.length, fixture.count, fixture.season);
          companion.pageSizes = alignPageSizesTo(sheet.weeks, sheet.pageSizes, companion.weeks);
          sheet.columnWidths = {}; companion.columnWidths = {};
          state.sheets = [sheet, companion];
          const host = document.querySelector('#chart-host') || document.querySelector('main');
          window.browserFitFixture = { state, redraw: () => renderChartBrowser(host, state) };
          const saved = JSON.stringify(state);
          browserFitFixture.redraw();
          for (let i = 0; i < fixture.index; i++) document.querySelector('.chart-next').click();
          return saved;
        }, fixture);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const before = await page.locator('.pages .page').evaluateAll(pages => pages.map(p => ({
          font: parseFloat(getComputedStyle(p).getPropertyValue('--sheet-font-size')),
          rows: p.querySelectorAll('tbody tr').length,
          times: (p.innerText.match(/\b\d{1,2}:\d{2}\b/g) || []).sort(),
        })));
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.deepEqual(await page.locator('.pages .page').evaluateAll(pages => pages.map(p =>
          parseFloat(getComputedStyle(p).getPropertyValue('--sheet-font-size')))), before.map(p => p.font), 'Refitting never shrinks the fitted size again');
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        const paperZoom = await page.addStyleTag({ content: '.pages .page { zoom: 1 !important; }' });
        const geometry = await page.locator('.pages .page').evaluateAll(pages => pages.map(p => {
          const box = p.getBoundingClientRect(), footer = p.querySelector('.page-footer').getBoundingClientRect();
          const table = p.querySelector('table').getBoundingClientRect(), style = getComputedStyle(p);
          return { height: box.height, footerBottom: footer.bottom - box.top,
            font: parseFloat(style.getPropertyValue('--sheet-font-size')),
            fits: table.bottom <= footer.top + .5 && footer.bottom <= box.bottom - parseFloat(style.paddingBottom) + .5 };
        }));
        assert(geometry.every(p => p.height <= 816.004 && p.fits), JSON.stringify({ width, view, fixture, geometry }));
        assert.deepEqual(geometry.map(p => p.font), before.map(p => p.font), 'Screen and print use the same fitted type');
        if (fixture.count === 3) assert(before.every(p => p.font === 10), 'Roomy charts keep their chosen size');
        await paperZoom.evaluate(node => node.remove());
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2, 'The pair prints on exactly two sheets');
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 792 612]'));
        const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(s => s.trim());
        assert.deepEqual(text.map(s => (s.match(/\b\d{1,2}:\d{2}\b/g) || []).sort()), before.map(p => p.times), 'Every time stays on its original sheet');
        assert(text.every(s => s.includes('Bais Medrash')), 'Each sheet contains its own address');
        const bounds = execFileSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
        const addresses = [...bounds.matchAll(/<word\b[^>]*yMin="([\d.]+)"[^>]*>Bais<\/word>/g)].map(m => Number(m[1]));
        assert.equal(addresses.length, 2);
        assert(addresses.every(y => y > 459 && y < 587) && Math.max(...addresses) - Math.min(...addresses) < .01, 'Both addresses remain aligned at the bottom');
        assert.equal(await page.evaluate(() => JSON.stringify(browserFitFixture.state)), original, 'Fitting preserves settings, rules and saved page splits');
        if (output) fs.writeFileSync(path.join(output, `${view}-${width}-${fixture.season}-${fixture.count}.pdf`), pdf);
        await page.emulateMedia({ media: 'screen' });
        if (output) await page.screenshot({ path: path.join(output, `${view}-${width}-${fixture.season}-${fixture.count}.png`), fullPage: true });
        checks.push({ width, view, fixture, geometry, rows: before.map(p => p.rows) });
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
