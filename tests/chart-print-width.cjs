// Seasonal charts must print their complete right edge, including actual visible ink.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.CHART_WIDTH_OUTPUT;
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
  const origin = process.env.CHART_WIDTH_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], checks = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) for (const view of ['admin', 'public']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 375 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + (view === 'admin' ? '/admin/#charts' : '/chart/?count=off'), { waitUntil: 'domcontentloaded' });
      await page.locator('main .pages .page').first().waitFor();
      await page.evaluate(async () => {
        const { loadTables } = await import('/js/data-loader.js');
        const { buildAutomaticCharts } = await import('/js/publish.js');
        const { renderChartBrowser } = await import('/js/ui/chart-view.js');
        const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), new Date('2026-10-14T12:00:00Z'));
        const sheet = state.sheets.find(sheet => sheet.id === 'auto-kayitz-5787');
        const companion = state.sheets.find(candidate => candidate.linkedSheetId === sheet.id);
        state.sheets = [sheet, companion];
        for (const current of state.sheets) {
          current.weeks = current.weeks.slice(0, 11);
          current.pageSizes = [current.weeks.length];
          Object.assign(current.style, { paddingX: .5, paddingY: .35, fontSizePt: 10 });
        }
        const main = document.querySelector('main');
        if (main.classList.contains('is-sheet-view')) throw Error('Exercise the seasonal browser, not the exempt saved-chart view');
        renderChartBrowser(main, state);
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const fonts = await page.locator('.pages .page').evaluateAll(pages => pages.map(page => getComputedStyle(page).getPropertyValue('--sheet-font-size')));
      const times = await page.locator('.pages .page').evaluateAll(pages => pages.map(page => (page.innerText.match(/\b\d{1,2}:\d{2}\b/g) || []).sort()));
      await page.emulateMedia({ media: 'print' });
      const clipping = await page.locator('.pages .parsha-cell,.pages .header-rabbi').evaluateAll(nodes => nodes.flatMap(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const ink = [...range.getClientRects()].filter(rect => rect.width > .1);
        const clipped = [];
        for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
          if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)
            && ink.some(rect => rect.left < box.left - .5 || rect.right > box.right + .5))
            clipped.push({ text: node.textContent, ancestor: parent.className, width: box.width });
        }
        return clipped;
      }));
      assert.deepEqual(clipping, [], 'No screen scrollport may clip printed Hebrew');
      for (const margin of [0, .25]) {
        const printerMargin = await page.addStyleTag({ content: `@page { size: letter landscape; margin: ${margin}in; }` });
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2, 'Both original sheets print without fragments');
        const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(text => text.trim());
        assert.deepEqual(text.map(text => (text.match(/\b\d{1,2}:\d{2}\b/g) || []).sort()), times, 'Every time stays on its printed page');
        let rightEdgePixels = null;
        if (margin === 0) {
          rightEdgePixels = [];
          for (let index = 0; index < 2; index++) {
            const ppm = execFileSync('pdftoppm', ['-f', String(index + 1), '-singlefile', '-r', '96', '-'], { input: pdf, maxBuffer: 8 * 1024 * 1024 });
            const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('latin1', 0, 100));
            assert(header && Number(header[1]) === 1056 && Number(header[2]) === 816, 'The physical sheet remains landscape Letter');
            const pixels = ppm.subarray(header[0].length);
            let ink = 0;
            // The old 992px screen cap erased these last 12px of the chart. PDF text
            // coordinates still contained its letters, so count the visible raster.
            for (let y = 150; y < 650; y++) for (let x = 995; x < 1007; x++) {
              const at = (y * 1056 + x) * 3;
              if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) < 252) ink++;
            }
            assert(ink > 500, `${view}/${width}: the right edge must actually be visible on sheet ${index + 1}, pixels=${ink}`);
            rightEdgePixels.push(ink);
          }
        }
        if (output) fs.writeFileSync(path.join(output, `${view}-${width}-margin-${margin}.pdf`), pdf);
        checks.push({ view, width, margin, pages: 2, rightEdgePixels });
        await printerMargin.evaluate(node => node.remove());
      }
      assert.deepEqual(await page.locator('.pages .page').evaluateAll(pages => pages.map(page => getComputedStyle(page).getPropertyValue('--sheet-font-size'))), fonts, 'The clipping repair preserves the larger text');
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
