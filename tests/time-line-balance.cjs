// Run after build-offline.py, with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.TIME_LINES_OUTPUT;
if (output) fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
  const results = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const check = async label => {
      await page.evaluate(() => document.fonts.ready);
      for (const media of ['screen', 'print']) {
        await page.emulateMedia({ media });
        if (media === 'print') await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        const lists = await page.locator('.chart-time-list').evaluateAll(elements => {
          const frames = [...new Set(elements.flatMap(list => [list.closest('.page'), list.closest('.pages')]))].filter(Boolean);
          const styles = frames.flatMap(el => ['zoom', 'transform'].map(name => ({ el, name,
            value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) })));
          styles.forEach(({ el, name }) => el.style.setProperty(name, name === 'zoom' ? '1' : 'none', 'important'));
          // Measure printed widths before the phone preview applies its zoom.
          try {
            return elements.map(list => {
              const lines = [...list.children].map(line => {
                const items = [...line.children], first = items[0].getBoundingClientRect(), last = items.at(-1).getBoundingClientRect();
                return { width: last.right - first.left, times: line.textContent.match(/\d{1,2}:\d{2}/g) || [] };
              });
              const cell = list.closest('.cell').getBoundingClientRect();
              const fits = [...list.querySelectorAll('.chart-time-item')].every(item => {
                const r = item.getBoundingClientRect(); return r.left >= cell.left - 1 && r.right <= cell.right + 1;
              });
              const rows = [...list.children], contents = rows.map(row => [...row.children]);
              const items = contents.flat(), first = rows[0];
              first.replaceChildren(...items);
              const widths = items.map(item => item.getBoundingClientRect().width);
              const spacer = document.createElement('span');
              spacer.className = 'chart-time-item'; first.append(spacer);
              const separator = spacer.getBoundingClientRect().width; spacer.remove();
              const fullWidth = widths.reduce((sum, width) => sum + width, 0);
              let bestDifference = Infinity;
              for (let cut = 1; cut < widths.length; cut++) {
                const top = widths.slice(0, cut).reduce((sum, width) => sum + width, 0);
                const bottom = widths.slice(cut).reduce((sum, width) => sum + width, 0) - separator;
                bestDifference = Math.min(bestDifference, Math.abs(top - bottom));
              }
              rows.forEach((row, i) => row.replaceChildren(...contents[i]));
              return { lines, fits, fullWidth, available: list.getBoundingClientRect().width, bestDifference,
                tag: list.querySelector('.tag-word')?.textContent || '' };
            });
          } finally {
            styles.forEach(({ el, name, value, priority }) => value
              ? el.style.setProperty(name, value, priority) : el.style.removeProperty(name));
          }
        });
        assert(lists.length > 0, label + ': real automatic lists');
        assert(lists.every(list => list.fits), label + ': every time fits within its cell');
        assert(lists.every(list => Math.abs(list.fullWidth - list.available) < 0.1
          || list.lines.length === (list.fullWidth <= list.available ? 1 : 2)),
          label + ': split only when the full list cannot fit: ' + JSON.stringify(lists.filter(list =>
            Math.abs(list.fullWidth - list.available) >= 0.1
              && list.lines.length !== (list.fullWidth <= list.available ? 1 : 2))));
        assert(lists.filter(list => list.lines.length === 2).every(list =>
          Math.abs(list.lines[1].width - list.lines[0].width) <= list.bestDifference + 1),
          label + ': choose the most even actual printed widths');
        assert(lists.filter(list => list.lines.flatMap(line => line.times).length <= 3).every(list => list.lines.length === 1),
          label + ': short Mincha and Maariv lists stay on one line');
        results.push({ label, media, lists: lists.length, single: lists.filter(list => list.lines.length === 1).length,
          wrapped: lists.filter(list => list.lines.length > 1).length,
          tags: lists.filter(list => list.tag).map(list => ({ tag: list.tag, lines: list.lines })) });
      }
      const pageSelector = label === 'Public' ? '.pages .page' : '#pages .page';
      const expectedPages = await page.locator(pageSelector).count();
      // The existing phone print fallback scales the whole page. Check its unchanged
      // paper frame before that zoom, and the actual physical page count below.
      const boxes = await page.locator(pageSelector).evaluateAll(elements => elements.map(el => [el.offsetWidth, el.offsetHeight]));
      assert(boxes.every(([w, h]) => w === 1056 && h === 816), label + ': unchanged paper dimensions: ' + JSON.stringify(boxes));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, expectedPages, label + ': one physical sheet per chart');
      if (output && label === 'Winter Times New Roman') {
        fs.writeFileSync(path.join(output, 'winter.pdf'), pdf);
        await page.locator('#pages .page').first().screenshot({ path: path.join(output, 'winter-chart.png') });
        const tag = page.locator('.weekday-table .cell[data-col=C] .chanukah-tag').first();
        await tag.locator('..').locator('..').locator('..').screenshot({ path: path.join(output, 'chanukah-mincha.png') });
      }
      await page.emulateMedia({ media: 'screen' });
    };
    await page.goto(origin + '/chart/?count=off');
    await page.locator('.pages .page').first().waitFor();
    await check('Public');
    for (const [season, year, width] of [['choref', 5787, 1440], ['choref', 5804, 375], ['kayitz', 5787, 375]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + `/admin/?case=${season}-${year}#generate`);
      if (season === 'kayitz') {
        await page.evaluate(async () => {
          const { loadState, saveState } = await import('/js/storage.js');
          const state = loadState(); state.settings.newMinyanBadge = { on: true, firstSerial: 0, lastSerial: 999999 }; saveState(state);
        });
        await page.reload();
      }
      await page.locator(`label[for=season-${season}]`).click();
      await page.locator('input[name=hebrewYear]').fill(String(year));
      await page.locator('#gen-form button[type=submit]').click();
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page').first().waitFor();
      const fonts = width === 1440 ? ['Times New Roman', 'David', 'Arial'] : ['Times New Roman'];
      for (const font of fonts) {
        await page.evaluate(async font => {
          const { fontStackFor, syncPageHeights } = await import('/js/ui/sheet-view.js');
          document.querySelectorAll('#pages .page').forEach(el => el.style.setProperty('--sheet-font-family', fontStackFor(font)));
          syncPageHeights(document.querySelector('#pages'));
          await document.fonts.ready; syncPageHeights(document.querySelector('#pages'));
        }, font);
        await check((width === 1440 ? 'Winter' : `${season} ${year} phone`) + ' ' + font);
      }
      if (season === 'kayitz') assert(await page.locator('.new-minyan-tag').count() > 0, 'The NEW label participates in real measured balancing');
      if (year === 5804) assert.equal(await page.locator('.weekday-table .cell[data-col=C] .chanukah-tag').count(), 2);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ results, errors }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
