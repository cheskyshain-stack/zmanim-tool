// Build first. Compare real paper output between the new and retained print menus.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.PRINT_NAV_OUTPUT;
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
  const origin = process.env.PRINT_NAV_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], results = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-12T16:00:00Z') }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year: 5787, group: 'עשרה בטבת', sheet: 'asarabteves', sheets: 'all', workflow: 'single', margin: 0.35, asaraShacharis: 'locations',
        }));
      });
      if (!process.env.PRINT_NAV_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-12T16:00:00Z'));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const tab = async name => { await page.locator('#print-tab-' + name).click(); await settle(); };
      const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      const preferences = () => page.evaluate(() => ({
        state: localStorage.getItem('zmanim-app-state-v1'), poster: localStorage.getItem('zmanim-poster-bar-v1'),
        chart: localStorage.getItem('zmanim-chart-print-layout'), backup: localStorage.getItem('zmanim-print-choices-before-simple-v1'),
      }));
      const paper = async label => {
        await settle(); await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.print-setup').filter({ visible: true }).count(), 0, 'Navigation never reaches paper');
        const boxes = await page.locator('.page,.poster,.week-card').evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height, text: node.innerText,
            overflow: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1 };
        }));
        assert(boxes.length, 'There is printable content');
        assert(boxes.every(box => !box.overflow), label + ': printed content fits');
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
        const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
        if (output) fs.writeFileSync(path.join(output, `${width}-${label}.pdf`), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle();
        return { boxes, text, pages, mediaBoxes: pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) };
      };
      const samePaper = async label => {
        const beforePreferences = await preferences();
        const simple = await paper(label + '-simple');
        await page.locator('#print-navigation-mode').click(); await settle();
        assert.equal(await page.locator('.print-setup').count(), 0, 'Previous interface is available');
        assert.equal(await page.locator('#print-navigation-mode').innerText(), 'Use new print setup');
        const classic = await paper(label + '-classic');
        assert.deepEqual(simple, classic, label + ': same physical size, text, page count and printed geometry');
        const afterPreferences = await preferences();
        assert.deepEqual(afterPreferences, beforePreferences, label + ': switching menus preserves every saved choice');
        await page.locator('#print-navigation-mode').click(); await settle();
        assert(await page.locator('.print-setup').isVisible());
        await noOverflow();
        results.push({ width, label, pages: simple.pages });
      };
      const change = async (selector, value) => {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded(); await control.focus();
        const before = await control.boundingBox(), id = await control.getAttribute('id');
        await control.selectOption(value); await settle();
        const after = await page.locator('#' + id).boundingBox();
        assert(Math.abs(before.y - after.y) < 1, id + ': control stays in position');
        assert.equal(await page.evaluate(() => document.activeElement.id), id, 'Focus is retained');
      };

      await page.goto(origin + '/admin/#posters/all'); await page.locator('.print-setup').waitFor(); await settle();
      const backup = (await preferences()).backup;
      assert(backup, 'The original print choices are backed up locally');
      assert.equal(JSON.parse(backup).baseline, '82793f6e19e91e3a71de3c40a575d6d9a9696636');
      for (const pane of ['schedules', 'pages', 'appearance']) { await tab(pane); assert.equal(await page.locator('[data-print-pane]:visible').count(), 1); await noOverflow(); }
      await tab('appearance');
      await change('#poster-asara-shacharis', 'compact'); await change('#poster-asara-shacharis', 'locations');
      assert.equal((await preferences()).backup, backup, 'The pre-update backup is not overwritten by later choices');
      await page.reload(); await page.locator('.print-setup').waitFor(); await settle();
      assert.equal(await page.locator('#print-tab-appearance').getAttribute('aria-selected'), 'true', 'Section survives reload');
      await samePaper('asara-detailed');

      await tab('schedules'); await page.locator('label[for=poster-workflow-halves]').click(); await settle();
      await tab('pages');
      await page.locator('select[data-half-side=left]').selectOption('asarabteves'); await settle();
      await tab('appearance'); await page.locator('select[data-half-shacharis=left]').selectOption('locations'); await settle();
      await tab('pages'); await page.locator('select[data-half-side=right]').selectOption('__same__'); await settle();
      assert.equal(await page.locator('.is-asara-detailed').count(), 2, 'Same as left copies the complete design and room-name choice');
      const pairs = await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-poster-bar-v1')).halfPagePairs);
      assert.equal(pairs[0].right, 'asarabteves'); assert.equal(pairs[0].rightShacharis, 'locations');
      assert(!JSON.stringify(pairs).includes('__same__'), 'Only real schedule keys are saved');
      await samePaper('paired-identical');

      await page.goto(origin + '/admin/#posters/sukkos'); await page.locator('.print-setup').waitFor(); await settle();
      await tab('pages'); await page.locator('#print-occasion-arrangement').selectOption('combined'); await settle();
      await samePaper('combined-sukkos');
      await page.goto(origin + '/admin/#posters/behabcheshvan'); await page.locator('.print-setup').waitFor(); await settle();
      await samePaper('bhb');
      await page.goto(origin + '/admin/#posters/roshchodesh8'); await page.locator('.print-setup').waitFor(); await settle();
      await samePaper('rosh-chodesh');

      await tab('schedules'); await page.locator('label[for=poster-workflow-set]').click(); await settle();
      await page.locator('label[for=poster-scope-all]').click(); await settle();
      await tab('pages'); await page.locator('label[for=poster-set-layout-combined]').click(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 6, 'Combined year set keeps all existing occasions');
      await samePaper('combined-year-set');
      await tab('pages'); await page.locator('label[for=poster-set-layout-original]').click(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 12, 'Original posters remain available in the year set');
      await samePaper('original-year-set');

      await page.goto(origin + '/admin/#posters/behabcheshvan'); await page.locator('.print-setup').waitFor(); await settle();
      await tab('schedules'); await page.locator('#poster-own-new').click(); await settle();
      await page.locator('.own-editor summary').click();
      await page.locator('.own-name').fill('Navigation test'); await settle();
      await page.locator('.own-text').fill('7:00, <u>7:15</u>'); await settle();
      assert(await page.locator('.own-editor').evaluate(panel => panel.open), 'Editing a custom schedule keeps the editor open');
      await samePaper('custom-schedule');

      await page.goto(origin + '/admin/#charts'); await page.locator('.print-setup').waitFor(); await settle();
      await tab('pages'); await change('#chart-print-layout', 'combined-letter');
      await samePaper('chart-together-letter');
      await change('#chart-print-layout', 'combined'); await samePaper('chart-together-tabloid');
      await page.locator('#print-customize-chart').click(); await page.locator('#chart-pad-y').waitFor({ state: 'attached' }); await settle();
      await tab('appearance');
      assert.equal(await page.locator('#chart-molad-format-label').isVisible(), false, 'Wording is hidden while Molad is off');
      await page.locator('#print-setup-find').click(); await page.locator('#print-setup-search').fill('Molad wording');
      await page.locator('.print-setup-result').filter({ hasText: 'Molad wording' }).first().click();
      assert.equal(await page.locator('#chart-molad-off').isChecked(), true, 'Finding a setting does not change it');
      await page.locator('label[for=chart-molad-on]').click(); await settle();
      assert(await page.locator('#chart-molad-format-label').isVisible());
      await page.locator('label[for=chart-molad-format-yiddish]').click(); await settle();
      await samePaper('saved-chart-molad');
      await tab('pages'); await page.locator('#print-page-breaks').evaluate(panel => { panel.open = true; });
      const old = await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-app-state-v1')).sheets.map(sheet => ({ id: sheet.id, weeks: sheet.weeks, overrides: sheet.overrides })));
      await page.locator('#print-page-count').fill('4'); await page.locator('#print-page-count').dispatchEvent('change');
      await page.locator('#print-apply-page-breaks').click(); await settle();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-app-state-v1')).sheets);
      assert(saved.every(sheet => sheet.pageSizes.length === 4));
      assert.deepEqual(saved.map(sheet => ({ id: sheet.id, weeks: sheet.weeks, overrides: sheet.overrides })), old, 'Changing page breaks retains all original weeks and saved times');
      await samePaper('custom-page-breaks');

      await page.goto(origin + '/admin/#week'); await page.locator('.print-setup').waitFor(); await settle();
      await tab('pages'); await page.locator('label[for=week-layout-combined]').click(); await settle();
      await samePaper('weekly-together');
      await tab('schedules'); assert(await page.locator('#week-print-rest').isVisible(), 'Remaining-weeks printing is still reachable');
      if (output) await page.screenshot({ path: path.join(output, `${width}-weekly.png`), fullPage: true });

      await page.locator('#print-navigation-mode').click(); await page.reload(); await page.locator('#print-navigation-mode').waitFor(); await settle();
      assert.equal(await page.locator('.print-setup').count(), 0, 'Previous setup is remembered after reload');
      await page.locator('#print-navigation-mode').click(); await settle();
      assert(await page.locator('.print-setup').isVisible(), 'New setup can be selected again');
      await noOverflow(); await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ parityFixtures: results.length, widths: [320, 375, 1440], errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
