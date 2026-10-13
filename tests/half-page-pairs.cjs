// Build first. Verify real half-sheet pairing, remembered controls and physical PDFs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.HALF_PAIRS_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const pageCount = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.HALF_PAIRS_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-11T12:00:00Z') }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ copiesPerPage: 2 }));
      });
      if (!process.env.HALF_PAIRS_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const pair = index => page.locator('.special-half-pair').nth(index);
      const choose = async (index, side, key) => { await pair(index).locator(`select[data-half-side=${side}]`).selectOption(key); await settle(); };
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-poster-bar-v1')).halfPagePairs);
      const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Controls fit ' + width + 'px');
      const printed = async (count, label) => {
        await settle(); await page.emulateMedia({ media: 'print' });
        const geometry = await page.locator('.poster-half-sheet.is-paired').evaluateAll(sheets => sheets.map(sheet => {
          const r = sheet.getBoundingClientRect();
          return { width: r.width, height: r.height, halves: [...sheet.querySelectorAll('.poster-half-slot')].map(slot => {
            const box = slot.getBoundingClientRect(), poster = slot.querySelector('.poster');
            const content = poster?.querySelector('.halfpage-content');
            const centered = content ? (() => {
              const title = poster.querySelector('.onepage-title').getBoundingClientRect();
              const footer = poster.querySelector('.poster-legend').getBoundingClientRect();
              const first = content.firstElementChild.getBoundingClientRect();
              const last = content.lastElementChild.getBoundingClientRect();
              return { topGap: first.top - title.bottom, bottomGap: footer.top - last.bottom };
            })() : null;
            return { x: box.left - r.left, y: box.top - r.top, width: box.width, height: box.height,
              key: slot.dataset.halfKey || '', text: poster?.innerText || '',
              centered,
              overflow: Boolean(poster && (poster.scrollWidth > poster.clientWidth + 1 || poster.scrollHeight > poster.clientHeight + 1)) };
          }) };
        }));
        assert.equal(geometry.length, count, label + ': DOM sheets');
        for (const sheet of geometry) {
          assert.deepEqual([sheet.width, sheet.height], [1056, 816], label + ': landscape Letter');
          assert.deepEqual(sheet.halves.map(half => [half.x, half.y, half.width, half.height]), [[0, 0, 528, 816], [528, 0, 528, 816]], label + ': exact side-by-side halves');
          assert(sheet.halves.every(half => !half.overflow), label + ': content fits');
          for (const half of sheet.halves.filter(half => half.centered)) {
            assert(half.centered.topGap >= -0.5 && half.centered.bottomGap >= -0.5,
              label + ': morning handout stays between its title and footer');
            assert(Math.abs(half.centered.topGap - half.centered.bottomGap) < 1,
              label + ': dates and schedule are vertically centered: ' + JSON.stringify(half.centered));
          }
        }
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal(pageCount(pdf), count, label + ': no split or blank physical pages');
        assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 792 612\]/);
        const textPages = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(text => text.trim());
        assert.equal(textPages.length, count, label + ': every physical page has text');
        assert(textPages.every(text => /6:40|6:43|6:50|6:53|7:00/.test(text)), label + ': times remain selectable in every PDF page');
        if (output) fs.writeFileSync(path.join(output, `${width}-${label}.pdf`), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle(); await noOverflow();
        results.push({ width, label, pages: count, halves: geometry.flatMap(sheet => sheet.halves.map(half => half.key)) });
        return geometry;
      };
      await page.goto(origin + '/admin/#posters/halfpages');
      await page.locator('.poster-half-sheet.is-paired').waitFor(); await settle();
      assert(await page.locator('#poster-workflow-halves').isChecked());
      assert.equal(await page.locator('#poster-copies-two').count(), 0, 'A remembered duplicate-copy preference does not affect pairs');
      const initial = await printed(1, 'chanukah-asara');
      assert.deepEqual(initial[0].halves.map(half => half.key), ['chanukah', 'asarabteves']);
      assert.equal(await page.locator('.poster.is-halfpage').count(), 2);
      if (output) await page.screenshot({ path: path.join(output, `${width}-pairing.png`), fullPage: true });

      await page.locator('#half-add-sheet').click(); await settle();
      await choose(1, 'left', 'roshchodesh8'); await choose(1, 'right', 'behabcheshvan');
      const before = await printed(2, 'two-pairs');
      if (output) await page.screenshot({ path: path.join(output, `${width}-two-pairs.png`), fullPage: true });
      await pair(1).locator('[data-half-action=swap]').click(); await settle();
      assert.equal(await pair(1).locator('select[data-half-side=left]').inputValue(), 'behabcheshvan');
      await pair(1).locator('[data-half-action=up]').click(); await settle();
      assert.equal(await pair(0).locator('select[data-half-side=left]').inputValue(), 'behabcheshvan');
      const saved = await stored();
      // Reload must preserve the arrangement, not just the schedules in it.
      await page.reload(); await page.locator('.poster-half-sheet.is-paired').first().waitFor(); await settle();
      assert.deepEqual(await stored(), saved);
      assert.match(page.url(), /#posters\/halfpages$/);
      await printed(2, 'remembered-pairs');

      await page.locator('[data-poster-zmanim]').click(); await page.locator('#zmanim-reference-panel').waitFor();
      assert.equal(await page.locator('#zmanim-reference-context option').count(), 4, 'Each half has its own zmanim comparison');
      await page.locator('#zmanim-reference-context').selectOption('0');
      assert.equal(await page.locator('[data-reference-group]').count(), 1, 'BHB half offers morning zmanim');
      await page.locator('#zmanim-reference-context').selectOption('2');
      assert.equal(await page.locator('[data-reference-group=mincha]').count(), 1, 'Chanukah half offers afternoon zmanim');
      await page.locator('[data-poster-zmanim]').click(); await settle();

      await page.locator('#half-add-all').click(); await settle();
      assert.deepEqual((await stored()).slice(0, 2), saved, 'Add all preserves custom pairs');
      const available = await pair(0).locator('select[data-half-side=left] option:not([disabled])').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      const selected = (await stored()).flatMap(row => [row.left, row.right]).filter(Boolean);
      assert.deepEqual([...selected].sort(), [...available].sort(), 'Every available half page is placed exactly once');
      const all = await printed(Math.ceil(available.length / 2), 'all-half-pages');
      const referenceText = new Map(all.flatMap(sheet => sheet.halves.filter(half => half.key).map(half => [half.key, half.text])));
      // Compare the two full schedules and two morning handouts with their original single-half view.
      for (const key of ['chanukah', 'asarabteves', 'behabcheshvan', 'roshchodesh8']) {
        await page.goto(origin + '/admin/#posters/' + key); await page.locator('#poster-sheet .poster').first().waitFor();
        if (key === 'chanukah' || key === 'asarabteves') await page.locator('label[for=poster-sheets-all]').click();
        await settle();
        assert.equal(await page.locator('.poster.is-halfpage').first().innerText(), referenceText.get(key), key + ': pairing retains the original half-page content');
      }
      await page.goto(origin + '/admin/#posters/halfpages'); await page.locator('.poster-half-sheet.is-paired').first().waitFor(); await settle();
      await page.locator('#half-clear').click(); await settle();
      assert.equal(await page.locator('#print-btn').count(), 0, 'Empty pairings do not print');
      await page.locator('#half-add-sheet').click(); await settle();
      await page.locator('#half-add-all').click(); await settle();
      assert((await stored()).every(row => row.left || row.right), 'Add all fills empty sheet placeholders');
      await page.locator('#half-clear').click(); await settle();
      await page.locator('#half-add-sheet').click(); await choose(0, 'right', 'asarashacharis');
      const blank = await printed(1, 'blank-left');
      assert.deepEqual(blank[0].halves.map(half => half.key), ['', 'asarashacharis']);
      await choose(0, 'left', 'asarashacharis');
      const duplicate = await printed(1, 'same-schedule');
      assert.equal(duplicate[0].halves[0].text, duplicate[0].halves[1].text, 'Same schedule can be paired with itself');

      await page.locator('#poster-year').selectOption('5787'); await settle();
      await choose(0, 'left', 'roshchodesh13'); await choose(0, 'right', 'chanukah');
      await page.locator('#poster-year').selectOption('5788'); await settle();
      assert.equal(await page.locator('#print-btn').count(), 0, 'Unavailable leap-month schedule cannot silently disappear from print');
      assert(await pair(0).locator('.special-half-error').count());
      await choose(0, 'left', ''); await printed(1, 'common-year');
      await page.locator('#poster-year-today').click(); await settle();
      await page.locator('#poster-year-back').click(); await settle();
      assert.equal(await page.locator('.poster-year-now').getAttribute('data-year'), '5786');
      await page.locator('#poster-year-next').click(); await settle();
      await page.locator('#poster-year').selectOption('5785'); await settle();
      await choose(0, 'left', 'chanukah'); await choose(0, 'right', 'asarabteves');
      await printed(1, 'friday-asara');
      await page.locator('#poster-year-today').click(); await settle();
      assert.equal(await page.locator('.poster-year-now').getAttribute('data-year'), '5787');
      await page.locator('.special-print-settings summary').click(); await settle();
      await page.locator('#poster-margin').selectOption('0.75'); await settle();
      await printed(1, 'wide-margin');
      await page.locator('label[for=poster-ink-mono]').click(); await settle();
      await printed(1, 'black-white');

      const control = pair(0).locator('select[data-half-side=right]');
      await control.scrollIntoViewIfNeeded(); await control.focus();
      const top = await control.evaluate(el => el.getBoundingClientRect().top);
      await control.selectOption('behabiyar'); await settle();
      assert(Math.abs(await pair(0).locator('select[data-half-side=right]').evaluate(el => el.getBoundingClientRect().top) - top) < 2, 'Changing a pairing stays at the clicked control');
      assert(await page.evaluate(() => document.activeElement?.dataset.halfSide === 'right'), 'Pair picker keeps keyboard focus');
      await noOverflow();
      await page.goto(origin + '/admin/#charts'); await page.locator('.pages .page').first().waitFor();
      assert.equal(await page.locator('main.is-half-paired-print').count(), 0, 'Paired print rules are cleared on other screens');
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, results, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
