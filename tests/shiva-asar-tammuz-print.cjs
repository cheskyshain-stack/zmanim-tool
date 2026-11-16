const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.TAMMUZ_OUTPUT;
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
  const origin = process.env.TAMMUZ_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year: 5787, sheet: 'shivaasartammuz', group: 'שבעה עשר בתמוז', design: 'new',
          printPages: [{ id: 'tammuz-test', left: 'shivaasartammuz', right: '' }],
        }));
      });
      if (!process.env.TAMMUZ_ORIGIN) await context.route('**/*', route =>
        route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(45000);
      page.on('pageerror', error => errors.push(error.message));
      const settle = async () => {
        await page.locator('.poster').first().waitFor({ state: 'attached' });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      };
      await page.goto(origin + '/admin/#posters/shivaasartammuz', { waitUntil: 'domcontentloaded' }); await settle();
      assert(await page.locator('#poster-design-new').isChecked());
      const print = async (year, design, paired = false) => {
        await settle();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The phone preview fits');
        const expected = await page.evaluate(async year => {
          const { buildShivaAsarTammuzPoster } = await import('/js/posters/shiva-asar-tammuz.js');
          const { resolveSettings } = await import('/js/settings.js');
          const config = await (await fetch('/data/published.json')).json();
          const poster = buildShivaAsarTammuzPoster(year, resolveSettings(config.settings));
          return poster.sets.flatMap(set => set.note ? [set.note.text] : set.lines.flat().map(time => time.text));
        }, year);
        const posters = page.locator('[data-job-frame] .poster');
        assert.equal(await posters.count(), paired ? 2 : 1);
        for (const text of await posters.allTextContents()) {
          assert(text.includes('שבעה עשר בתמוז'));
          for (const time of expected) assert(text.includes(time), 'A poster retains time ' + time);
          assert(!text.includes('12:45'), 'An invalid winter Mincha is omitted');
        }
        if (!process.env.TAMMUZ_ORIGIN) {
          await page.emulateMedia({ media: 'print' });
          const geometry = await posters.evaluateAll(nodes => nodes.map(poster => {
            const r = poster.getBoundingClientRect(), frame = poster.closest('[data-job-frame]').getBoundingClientRect();
            const contents = [...poster.querySelectorAll('.onepage-sec-head,.onepage-row,.halfpage-zman,.poster-legend')].map(node => node.getBoundingClientRect());
            return poster.scrollHeight <= poster.clientHeight + 1 && poster.scrollWidth <= poster.clientWidth + 1
              && r.left >= frame.left - 1 && r.right <= frame.right + 1 && r.bottom <= frame.bottom + 1
              && contents.every(box => box.top >= r.top - 1 && box.bottom <= r.bottom + 1 && box.left >= r.left - 1 && box.right <= r.right + 1);
          }));
          assert(geometry.every(Boolean), 'The content and footer fit the printed paper');
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
          assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
          const paper = design === 'new' ? '/MediaBox [0 0 792 612]' : '/MediaBox [0 0 612 792]';
          assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === paper));
          const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
          for (const time of expected) assert(text.includes(time), 'Native PDF retains ' + time);
          if (output) fs.writeFileSync(path.join(output, `${width}-${year}-${design}${paired ? '-paired' : ''}.pdf`), pdf);
          await page.emulateMedia({ media: 'screen' }); await settle();
        }
        checks.push({ width, year, design, paired });
      };
      for (const year of [5787, 5789]) {
        await page.locator('#poster-year').selectOption(String(year)); await settle();
        await page.locator('label[for=poster-design-new]').click(); await settle();
        await print(year, 'new');
        if (await page.locator('.special-print-settings').getAttribute('open') === null) {
          await page.locator('.special-print-settings summary').click();
        }
        await page.locator('#poster-margin').selectOption('0.75'); await settle();
        await print(year, 'new');
        await page.locator('#poster-margin').selectOption('0.15'); await settle();
        await page.locator('label[for=poster-design-old]').click(); await settle();
        await print(year, 'old');
      }
      await page.locator('label[for=poster-design-new]').click(); await settle();
      await page.locator('[data-job-action=half]').click();
      await page.locator('[data-add-group]').selectOption('שבעה עשר בתמוז');
      await page.locator('.special-add-page button[type=submit]').click(); await settle();
      await print(5789, 'new', true);
      if (output) await page.screenshot({ path: path.join(output, `${width}-tammuz.png`), fullPage: true });
      await page.clock.setFixedTime(new Date('2027-07-21T16:00:00Z'));
      await page.goto(origin + '/texts/', { waitUntil: 'domcontentloaded' });
      const message = await page.evaluate(async () => {
        const { buildShivaAsarTammuzPoster } = await import('/js/posters/shiva-asar-tammuz.js');
        const { shivaAsarTammuzText } = await import('/js/taanis-text.js');
        const { resolveSettings } = await import('/js/settings.js');
        const { buildAutomaticCharts } = await import('/js/publish.js');
        const { loadTables } = await import('/js/data-loader.js');
        const { currentOnePageSheets } = await import('/js/ui/posters-view.js');
        const config = await (await fetch('/data/published.json')).json(), tables = await loadTables();
        const settings = resolveSettings(config.settings), poster = buildShivaAsarTammuzPoster(5787, settings);
        const state = buildAutomaticCharts(config, tables, new Date('2027-07-21T16:00:00Z'));
        const publicSheet = currentOnePageSheets(state, settings, { on: poster.span.from - 1 }).find(sheet => sheet.label === 'שבעה עשר בתמוז');
        if (!publicSheet?.html.includes('7:40') || !publicSheet.html.includes('8:56')) throw Error('The public special schedule is missing its full fast-day times');
        return { serial: poster.span.from, text: shivaAsarTammuzText(poster) };
      });
      const card = page.locator(`.tx-card[data-id="taanis-${message.serial}"]`);
      await card.waitFor(); assert.equal(await card.locator('textarea').inputValue(), message.text);
      checks.push({ width, message: true, publicSheet: true });
      await context.close();
    }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
