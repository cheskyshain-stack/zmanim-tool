const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.ALL_SCHEDULES_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.ALL_SCHEDULES_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-13T12:00:00Z') }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1',
          JSON.stringify({ year: 5787, group: 'ראש חודש', sheet: 'roshchodesh8', design: 'new' }));
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === origin || url.protocol === 'data:' ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00Z'));
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      const settle = () => page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-poster-bar-v1')));
      const keys = async () => (await saved()).printPages.map(page => page.left);
      const expectedMonths = year => page.evaluate(async year => {
        const { buildRoshChodeshShacharisPoster, ROSH_CHODESH_SHACHARIS_MONTHS } = await import('/js/posters/shacharis.js');
        const { resolveSettings } = await import('/js/settings.js'); const { loadState } = await import('/js/storage.js');
        const settings = resolveSettings(loadState().settings);
        return ROSH_CHODESH_SHACHARIS_MONTHS.map(month => ({ month, poster: buildRoshChodeshShacharisPoster(year, month, settings) }))
          .filter(item => item.poster).sort((a, b) => a.poster.span.from - b.poster.span.from).map(item => 'roshchodesh' + item.month);
      }, year);
      const expectAllMonths = async year => {
        const expected = await expectedMonths(year);
        assert.deepEqual(await keys(), expected);
        assert.equal(await page.locator('.special-job-page').count(), expected.length);
        assert.equal(await page.locator('#poster-group').inputValue(), 'all:roshchodesh');
        assert.equal(await page.locator('#poster-pick').inputValue(), 'all:roshchodesh');
        assert.equal((await saved()).collection, 'roshchodesh');
        assert(page.url().endsWith('#posters/category/roshchodesh'));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        return expected;
      };
      const printSet = async (name, count, landscape) => {
        await page.emulateMedia({ media: 'print' }); await settle();
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, count, 'No empty or overflowing printed sheets');
        assert(pdf.toString('latin1').includes(landscape ? '/MediaBox [0 0 792 612]' : '/MediaBox [0 0 612 792]'));
        if (output) fs.writeFileSync(path.join(output, name + '-' + width + '.pdf'), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle();
        checks.push({ width, print: name, pages: count });
      };
      await page.goto(origin + '/admin/#posters/roshchodesh8'); await page.locator('#poster-group').waitFor(); await settle();
      assert.equal(await page.locator('#poster-pick option[value="all:roshchodesh"]').count(), 1);
      await page.locator('#poster-pick').selectOption('all:roshchodesh'); await settle();
      let months = await expectAllMonths(5787);
      const ids = (await saved()).printPages.map(page => page.id);
      await page.locator('.special-print-settings').evaluate(el => el.open = true); await settle();
      await page.locator('#poster-margin-next').click(); await settle();
      assert.deepEqual((await saved()).printPages.map(page => page.id), ids, 'Margin changes retain page identity');
      for (const design of ['old', 'new']) {
        await page.locator('label[for=poster-design-' + design + ']').click(); await settle();
        await expectAllMonths(5787);
        assert.deepEqual((await saved()).printPages.map(page => page.id), ids);
        await printSet('all-rc-' + design, months.length, true);
      }
      for (const year of [5786, 5790, 5787]) {
        await page.locator('#poster-year').selectOption(String(year)); await settle();
        await expectAllMonths(year); checks.push({ width, year, allMonths: true });
      }
      await page.reload(); await page.locator('#poster-group').waitFor(); await settle();
      months = await expectAllMonths(5787);
      await page.locator('#poster-pick').selectOption(months[0]); await settle();
      assert.deepEqual(await keys(), [months[0]]); assert.equal((await saved()).collection, null);
      await page.locator('#poster-group').selectOption('all:roshchodesh'); await settle();
      await expectAllMonths(5787);
      await page.locator('#poster-page-next').click(); await settle();
      assert.deepEqual(await keys(), [months[0]], 'Next from All opens the first month individually');
      await page.locator('#poster-group').selectOption('all:roshchodesh'); await settle();
      await page.locator('#poster-page-now').click(); await settle();
      assert.equal((await saved()).collection, null);
      assert.equal((await keys()).length, 1); assert(months.includes((await keys())[0]));
      await page.locator('#poster-group').selectOption('all:yomtov'); await settle();
      const holidays = await keys();
      for (const key of ['roshhashana', 'yomkippur', 'sukkos', 'pesach']) assert(holidays.includes(key));
      assert(holidays.every(key => ['roshhashana', 'yomkippur', 'sukkos', 'sukkosshuava', 'pesach'].includes(key)));
      assert.equal(new Set(holidays).size, holidays.length);
      assert.equal(await page.locator('#poster-pick').count(), 0, 'All Yom Tov has no unrelated Page selector');
      assert((await page.locator('.special-controls').innerText()).includes('No schedule is available yet for שבועות'));
      for (const [year, gregorian] of [[5786, '2025'], [5787, '2026']]) {
        await page.locator('#poster-year').selectOption(String(year)); await settle();
        assert.equal(await page.locator('#poster-group').inputValue(), 'all:yomtov');
        assert((await page.locator('.poster-when-en').first().innerText()).includes(gregorian));
      }
      for (const design of ['new', 'old']) {
        await page.locator('label[for=poster-design-' + design + ']').click(); await settle();
        assert.deepEqual(await keys(), holidays);
        await printSet('all-yomtov-' + design, holidays.length, false);
      }
      await page.reload(); await page.locator('#poster-group').waitFor(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), 'all:yomtov');
      assert.deepEqual(await keys(), holidays);
      await page.locator('#poster-group').selectOption('פסח'); await settle();
      assert.deepEqual(await keys(), ['pesach']);
      await page.goBack(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), 'all:yomtov');
      assert.deepEqual(await keys(), holidays);
      await page.goForward(); await settle(); assert.deepEqual(await keys(), ['pesach']);
      await page.locator('#poster-group').selectOption('all:roshchodesh'); await settle();
      await page.locator('[data-job-action=remove]').first().click(); await settle();
      assert.deepEqual(await keys(), months.slice(1)); assert.equal((await saved()).collection, null);
      await page.reload(); await page.locator('#poster-group').waitFor(); await settle();
      assert.deepEqual(await keys(), months.slice(1), 'Removed month is not restored on reload');
      await page.locator('#poster-group').selectOption('all:roshchodesh'); await settle();
      const restoredIds = (await saved()).printPages.map(page => page.id);
      await page.locator('[data-job-action=page]').first().click(); await settle();
      assert.deepEqual((await saved()).printPages.map(page => page.id), restoredIds);
      await page.locator('[data-add-group]').selectOption('בה"ב אחר סוכות'); await settle();
      await page.locator('[data-add-after] button[type=submit]').click(); await settle();
      assert.equal((await saved()).collection, null);
      assert.equal((await keys()).length, months.length + 1, 'An added page remains in the edited set');
      assert((await keys()).includes('behabcheshvan'));
      await page.reload(); await page.locator('#poster-group').waitFor(); await settle();
      assert.equal((await keys()).length, months.length + 1);
      await page.locator('#poster-group').selectOption('all:roshchodesh'); await settle();
      await expectAllMonths(5787);
      if (output) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, 'all-rosh-chodesh-' + width + '.png') });
      }
      checks.push({ width, collectionReload: true, individual: true, history: true, editedSetReload: true });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
