// Build first. Exercise selection, legacy links, comparison tools and actual print pages.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const pages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SPECIAL_SCHEDULES_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const errors = [], measurements = [];
  try {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-11T12:00:00Z') }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
      const settle = async () => {
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      };
      const choose = async name => { await page.locator('#poster-group').selectOption(name); await settle(); };
      const switchTo = async value => { await page.locator('label[for=poster-workflow-' + value + ']').click(); await settle(); };
      const printed = async (selector, count, landscape = false) => {
        await page.emulateMedia({ media: 'print' });
        const boxes = await page.locator(selector).evaluateAll(sheets => sheets.map(sheet => {
          const r = sheet.getBoundingClientRect();
          const legend = sheet.querySelector('.poster-legend'), cs = legend ? getComputedStyle(legend) : null;
          const footerPt = sheet.classList.contains('is-halfpage') ? 6.5
            : sheet.classList.contains('is-onepage') && !sheet.classList.contains('is-weeksheet') || sheet.classList.contains('is-pair') ? 7.5 : null;
          return { width: r.width, height: r.height, overflow: sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1,
            footerPt, footerSize: cs?.fontSize, footerWeight: cs?.fontWeight };
        }));
        assert(boxes.every(box => !box.overflow), 'Printed content stays inside each page: ' + JSON.stringify(boxes));
        for (const box of boxes.filter(box => box.footerPt && box.footerSize)) {
          assert(Math.abs(parseFloat(box.footerSize) - box.footerPt * 96 / 72) < 0.01, 'Consistent fixed footer size');
          assert.equal(box.footerWeight, '400', 'Regular-weight footer');
        }
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal(pages(pdf), count, 'Exact number of physical pages');
        assert.match(pdf.toString('latin1'), landscape ? /\/MediaBox \[0 0 792 612\]/ : /\/MediaBox \[0 0 612 792\]/);
        await page.emulateMedia({ media: 'screen' });
        return boxes;
      };
      await page.goto(origin + '/admin/#posters');
      await page.locator('#poster-group').waitFor(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), 'ראש חודש', 'Current includes today’s morning handout');
      assert.equal(await page.locator('#poster-pick').inputValue(), 'roshchodesh8', 'Current selects the actual month');
      assert.deepEqual(await page.locator('#poster-group optgroup').evaluateAll(groups => groups.map(g => [g.label, [...g.children].map(e => e.value)])), [
        ['Yom Tov', ['ראש השנה יום כיפור', 'סוכות', 'פסח', 'שבועות']],
        ['Other schedules', ['ראש חודש', 'בה"ב אחר סוכות', 'חנוכה', 'עשרה בטבת', 'פורים', 'בה"ב אחר פסח', 'שבעה עשר בתמוז', 'תשעה באב']],
      ], 'Grouped sections keep chronological order');
      await page.locator('#poster-year-next').click(); await settle();
      assert.equal(await page.locator('.poster-year-now').getAttribute('data-year'), '5788');
      await page.locator('#poster-year-back').click(); await settle();
      await page.locator('#poster-year').selectOption('5785'); await settle();
      await page.locator('#poster-year-today').click(); await settle();
      assert.equal(await page.locator('.poster-year-now').getAttribute('data-year'), '5787');
      await choose('חנוכה');
      await page.locator('#poster-group-back').click(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), 'בה"ב אחר סוכות');
      await page.locator('#poster-group-next').click(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), 'חנוכה');
      await page.locator('#poster-group-now').click(); await settle();
      assert.equal(await page.locator('#poster-pick').inputValue(), 'roshchodesh8');
      await choose('חנוכה');
      await page.locator('label[for=poster-sheets-all]').click(); await settle();
      assert.equal(await page.locator('#poster-pick').count(), 0, 'No redundant single-option dropdown');
      assert(!(await page.locator('.special-print-settings').getAttribute('open')), 'Advanced settings start collapsed');
      await page.locator('.special-print-settings summary').click();
      await page.locator('#poster-margin-next').click(); await settle();
      assert.equal(await page.locator('#poster-margin').inputValue(), '0.4');
      await page.locator('#poster-margin-back').click(); await settle();
      await page.locator('#poster-margin').selectOption('0.5'); await settle();
      await page.locator('#poster-margin-reset').click(); await settle();
      assert.equal(await page.locator('#poster-margin').inputValue(), '0.35');
      await page.locator('label[for=poster-copies-two]').click(); await settle();
      const withoutTools = await printed('.poster.is-halfpage', 1, true);
      assert.deepEqual(withoutTools.map(b => [b.width, b.height]), [[528, 816], [528, 816]], 'Two real half Letter copies');
      await page.locator('[data-poster-zmanim]').click(); await page.locator('#zmanim-reference-panel').waitFor();
      await page.locator('[data-reference-group=mincha]').click(); await settle();
      assert.equal(await page.locator('[data-reference-key=shkia]').count(), 1);
      assert.deepEqual(await printed('.poster.is-halfpage', 1, true), withoutTools, 'Comparison does not change print geometry');
      await page.locator('[data-poster-explain]').click(); await settle();
      assert.equal(await page.locator('[data-poster-explain]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-poster-explain]').click();
      await page.reload(); await page.locator('.poster.is-halfpage').first().waitFor(); await settle();
      assert(await page.locator('#poster-copies-two').isChecked(), 'Format and copy choice survive reload');
      await choose('עשרה בטבת');
      await page.locator('#poster-pick').selectOption('asarashacharis'); await settle();
      assert.equal(await page.locator('.poster.is-shacharis').count(), 2);
      await printed('.poster.is-shacharis', 1, true);
      await page.locator('#poster-pick').selectOption('asarabteves'); await settle();
      assert.equal(await page.locator('.poster.is-shacharis').count(), 0, 'Full Asara remains separate from its morning handout');
      await printed('.poster', 1);
      await page.locator('label[for=poster-sheets-all]').click(); await settle();
      await printed('.poster.is-halfpage', 1, true);
      await choose('ראש השנה יום כיפור');
      await page.locator('#poster-pick').selectOption('__combined__'); await settle();
      await printed('.poster.is-onepage', 1);
      await switchTo('set');
      await page.locator('label[for=poster-scope-all]').click(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 6, 'Combined set includes five occasions and separate Vasikin');
      assert.equal(await page.locator('[data-set-key="poster:vasikinboth"]').isChecked(), true);
      assert.equal(await page.locator('.special-set-list').getByText('ראש חודש', { exact: true }).count(), 0, 'Morning handouts are excluded from year sets');
      await printed('.poster', 6);
      await page.locator('[data-set-key="poster:vasikinboth"]').uncheck(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 5);
      await page.reload(); await page.locator('.special-set-list').waitFor(); await settle();
      assert.equal(await page.locator('[data-set-key="poster:vasikinboth"]').isChecked(), false, 'Named selection survives reload');
      await page.locator('[data-set-select=all]').click(); await settle();
      await page.locator('label[for=poster-set-layout-original]').click(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 12, 'Original set excludes paired alternatives by default');
      await printed('.poster', 12);
      await page.locator('[data-set-key="poster:pair"]').check(); await settle();
      assert.equal(await page.locator('.poster-all-item').count(), 13, 'A paired alternative is an explicit named choice');
      await page.locator('[data-set-select=none]').click(); await settle();
      assert.equal(await page.locator('#print-btn').count(), 0, 'Empty selection cannot print a blank set');
      await page.locator('[data-set-review="poster:chanukah"]').click(); await settle();
      assert(await page.locator('#poster-workflow-single').isChecked());
      assert.equal(await page.locator('.poster.is-chanukah').count(), 1);
      for (const name of ['פורים', 'שבועות', 'שבעה עשר בתמוז', 'תשעה באב']) {
        await choose(name);
        assert.equal(await page.locator('#print-btn').count(), 0, 'Unavailable occasion has no misleading Print button');
      }
      await choose('בה"ב אחר סוכות');
      await page.locator('#poster-own-new').click(); await settle();
      assert.equal(await page.locator('.own-group').inputValue(), 'בה"ב אחר סוכות');
      assert.deepEqual(await page.locator('.own-group optgroup').evaluateAll(g => g.map(e => e.label)), ['Yom Tov', 'Other schedules']);
      await page.locator('.own-name').fill('Custom test'); await settle();
      assert((await page.locator('.poster-when-what').innerText()).includes('Custom test'));
      await page.locator('.own-mode').selectOption('zman'); await settle();
      await page.locator('.own-zman').scrollIntoViewIfNeeded();
      await page.locator('.own-zman').focus();
      const ownZmanY = await page.locator('.own-zman').evaluate(el => el.getBoundingClientRect().top);
      await page.locator('.own-zman').selectOption('minchaGedola'); await settle();
      assert.equal(await page.locator('.own-round').inputValue(), 'up', 'Mincha Gedola defaults to upward rounding');
      assert.deepEqual(await page.locator('.own-round option:enabled').evaluateAll(options => options.map(option => option.value)), ['up', 'up5']);
      assert.match(await page.locator('.own-when').textContent(), /מנחה גדולה לחומרא.*up to the minute/);
      assert.ok(Math.abs(await page.locator('.own-zman').evaluate(el => el.getBoundingClientRect().top) - ownZmanY) < 2, 'Changing the zman keeps the control in place');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'own-zman', 'Changing the zman restores focus');
      const savedOwnGroup = await page.locator('#poster-group').inputValue();
      const savedOwnKey = await page.locator('#poster-pick').inputValue();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
        state.own.find(sheet => sheet.name === 'Custom test').blocks[0].rows[0].round = 'down5';
        localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
      });
      await page.reload(); await page.locator('#poster-group').waitFor();
      await page.locator('#poster-group').selectOption(savedOwnGroup);
      await page.locator('#poster-pick').selectOption(savedOwnKey); await settle();
      assert.equal(await page.locator('.own-round').inputValue(), 'up5', 'Older saved choices show their effective upward rounding');
      assert.match(await page.locator('.own-when').textContent(), /מנחה גדולה לחומרא.*up to the next 5 minutes/);
      await page.locator('.own-zman').selectOption('shkia'); await settle();
      assert.equal(await page.locator('.own-round option:enabled').count(), 5, 'Other zmanim retain all rounding choices');
      await page.locator('.own-editor summary').click();
      await choose('חנוכה');
      await page.locator('#poster-own-new').click(); await settle();
      await choose('חנוכה');
      await page.locator('#poster-pick').selectOption('chanukah'); await settle();
      await page.locator('label[for=poster-sheets-all]').click(); await settle();
      await printed('.poster.is-halfpage', 1, true);
      assert.equal(await page.locator('.poster.is-halfpage').count(), 2, 'Adding a custom schedule does not change Chanukah half sheets');
      await page.locator('#poster-pick').selectOption('__combined__'); await settle();
      await printed('.poster.is-onepage', 1);
      assert.equal(await page.locator('.poster.is-halfpage').count(), 0, 'A whole occasion with a custom sheet uses Letter paper');
      await page.evaluate(() => { location.hash = '#generate'; });
      await page.locator('#gen-form').waitFor(); await settle();
      assert(await page.locator('#show-zmanim-toggle').isVisible(), 'Other admin screens retain their sidebar tools');
      assert.equal(await page.locator('main.is-half-letter-print,main.is-special-schedules').count(), 0, 'Special screen classes are cleared');
      await page.evaluate(() => { location.hash = '#posters/chanukah'; });
      await page.locator('.poster.is-chanukah').waitFor(); await settle();
      measurements.push({ width, previewTop: await page.locator('#poster-sheet').evaluate(el => el.getBoundingClientRect().top), yearButtons: await page.locator('#poster-year-back,#poster-year-next,#poster-year-today').count() });
      if (process.env.SPECIAL_SCHEDULES_OUTPUT) {
        fs.mkdirSync(process.env.SPECIAL_SCHEDULES_OUTPUT, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SPECIAL_SCHEDULES_OUTPUT, 'navigation-' + width + '.png'), fullPage: true });
      }
      await context.close();
    }
    // A saved morning-only choice remains morning-only despite its legacy run flags.
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, group: 'עשרה בטבת · שחרית', sheets: 'all', scope: 'all' }));
    });
    const page = await context.newPage();
    await page.goto(origin + '/admin/#posters/all');
    await page.locator('.poster.is-shacharis').waitFor();
    assert(await page.locator('#poster-workflow-single').isChecked());
    assert.equal(await page.locator('#poster-group').inputValue(), 'עשרה בטבת');
    assert.equal(await page.locator('#poster-pick').inputValue(), 'asarashacharis');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, measurements, errors }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
