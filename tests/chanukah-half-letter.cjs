// Run after build-offline.py, with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const pdfPages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-08T12:00:00Z') }));
      if (!localStorage.getItem('zmanim-poster-bar-v1')) {
        localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, group: 'חנוכה', sheets: 'all', scope: 'one', margin: 0.35 }));
      }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
    await page.goto(origin + '/admin/#posters/all');
    await page.locator('.poster.is-halfpage').waitFor();
    const settle = () => page.evaluate(() => document.fonts.ready);
    const year = () => page.locator('.poster-year-now').getAttribute('data-year').then(Number);
    const chooseYear = async value => {
      while (await year() !== value) await page.locator(await year() < value ? '#poster-year-next' : '#poster-year-back').click();
      await settle();
    };
    const check = async (width, value) => {
      await page.setViewportSize({ width, height: 1000 });
      await chooseYear(value);
      assert.equal(await page.locator('input[name=poster-break]').count(), 0, 'No irrelevant column control');
      const copies = await page.locator('#poster-copies-two').isChecked() ? 2 : 1;
      assert.equal(await page.locator('.poster.is-halfpage').count(), copies);
      const expected = await page.evaluate(async value => {
        const { buildChanukahPoster, toCell } = await import('/js/posters/chanukah.js');
        const { loadState } = await import('/js/storage.js');
        const { resolveSettings } = await import('/js/settings.js');
        const { loadTables } = await import('/js/data-loader.js');
        const p = buildChanukahPoster(value, resolveSettings(loadState().settings), await loadTables());
        return [p.shacharisRows.flatMap(row => [row.vasikin.time, ...row.cells.slice(1).map(c => c.text)]),
          p.weekdayMincha.map(t => toCell(t).text), p.maariv.map(t => toCell(t).text), p.erevShabbos.cells.map(c => c.text)]
          .map(list => list.flatMap(text => text.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []));
      }, value);
      const actual = await page.locator('.poster.is-halfpage').first().locator('.halfpage-body .onepage-sec').evaluateAll(sections => sections.map(s =>
        [...s.querySelectorAll('.onepage-times')].flatMap(t => t.textContent.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [])));
      assert.deepEqual(actual, expected, 'Every minyan and merged Friday time retained in ' + value);
      const netz = await page.evaluate(async value => {
        const { buildChanukahPoster } = await import('/js/posters/chanukah.js');
        const { loadState } = await import('/js/storage.js');
        const { resolveSettings } = await import('/js/settings.js');
        const { loadTables } = await import('/js/data-loader.js');
        return buildChanukahPoster(value, resolveSettings(loadState().settings), await loadTables()).shacharisRows
          .flatMap(row => row.vasikin.netzDays || []).map(day => day.time);
      }, value);
      assert.deepEqual(await page.locator('.poster.is-halfpage').first().locator('.halfpage-netz .poster-netz-day > bdi[dir=ltr]').allTextContents(), netz);
      const texts = await page.locator('.poster.is-halfpage').allTextContents();
      assert(texts.every(text => text === texts[0]), 'Copies retain identical schedules and notes');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone preview fits');
      await page.emulateMedia({ media: 'print' });
      const boxes = await page.locator('.poster.is-halfpage').evaluateAll(sheets => sheets.map(sheet => {
        const rect = sheet.getBoundingClientRect(), cs = getComputedStyle(sheet);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scroll: sheet.scrollHeight,
          client: sheet.clientHeight, bottom: rect.bottom - parseFloat(cs.paddingBottom),
          legend: sheet.querySelector('.poster-legend').getBoundingClientRect().bottom,
          textSize: parseFloat(getComputedStyle(sheet.querySelector('.onepage-row')).fontSize),
          paper: document.getElementById('print-page-size').textContent,
          children: [...sheet.querySelectorAll('.onepage-line,.halfpage-netz,.onepage-sec-head,.poster-legend')]
            .map(el => el.getBoundingClientRect().toJSON()) };
      }));
      for (const [i, box] of boxes.entries()) {
        assert.deepEqual([box.x, box.y, box.width, box.height], [i * 528, 0, 528, 816]);
        assert.equal(box.scroll, box.client, 'No vertical spill');
        assert(box.legend <= box.bottom + 1, 'Footnotes fit');
        assert(box.textSize >= 12.6, 'Times stay at least 9.5pt');
        assert(box.children.every(r => r.x >= box.x && r.right <= box.x + 528 && r.bottom <= box.legend + 1));
        assert(box.paper.includes('letter landscape'));
        assert.equal(box.textSize, boxes[0].textSize, 'Both copies print at the same type size');
      }
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal(pdfPages(pdf), 1, 'One physical sheet, without a blank second page');
      assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 792 612\]/, 'Landscape Letter paper');
      await page.emulateMedia({ media: 'screen' });
    };
    const checkOriginal = async (width, value) => {
      await page.setViewportSize({ width, height: 1000 });
      await chooseYear(value);
      assert.equal(await page.locator('.poster.is-halfpage,.is-half-letter-print,#poster-copies-one,#poster-margin,#poster-ink-colour').count(), 0,
        'Original poster modes have no half-page layout or controls');
      assert.equal(await page.locator('.poster.is-chanukah').count(), 1);
      const expected = await page.evaluate(async value => {
        const { buildChanukahPoster, toCell } = await import('/js/posters/chanukah.js');
        const { loadState } = await import('/js/storage.js');
        const { resolveSettings } = await import('/js/settings.js');
        const { loadTables } = await import('/js/data-loader.js');
        const p = buildChanukahPoster(value, resolveSettings(loadState().settings), await loadTables());
        return { title: p.erevShabbos.title, times: [
          [...p.shacharisRows.flatMap(row => [row.vasikin.time, ...row.cells.slice(1).map(c => c.text)]),
            ...p.shacharisRows.flatMap(row => (row.vasikin.netzDays || []).map(day => day.time))],
          p.weekdayMincha.map(t => toCell(t).text), p.erevShabbos.cells.map(c => c.text), p.maariv.map(t => toCell(t).text)]
          .map(list => list.flatMap(text => text.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [])) };
      }, value);
      assert.deepEqual(await page.locator('.poster-set-head').allTextContents(), ['שחרית', 'מנחה', expected.title, 'מעריב']);
      const actual = await page.locator('.poster-set').evaluateAll(sections => sections.map(s =>
        s.textContent.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []));
      assert.deepEqual(actual, expected.times, 'Original poster retains every time and sunrise reference');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Original poster preview fits');
      await page.emulateMedia({ media: 'print' });
      const box = await page.locator('.poster.is-chanukah').evaluate(s => {
        const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
        return { x: r.x, y: r.y, width: parseFloat(cs.width), height: parseFloat(cs.height),
          legendBottom: s.querySelector('.poster-legend').getBoundingClientRect().bottom,
          bottom: r.bottom - parseFloat(cs.paddingBottom) * r.height / parseFloat(cs.height),
          paper: document.getElementById('print-page-size').textContent };
      });
      assert.deepEqual([box.x, box.y], [0, 0]);
      assert(Math.abs(box.width - 816) < 0.05 && Math.abs(box.height - 1056) < 0.05, 'Original full-page dimensions');
      assert(box.legendBottom <= box.bottom + 0.5, 'Original notes stay inside the frame');
      assert(box.paper.includes('letter portrait'));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal(pdfPages(pdf), 1, 'Original poster prints on one full page');
      assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 612 792\]/);
      await page.emulateMedia({ media: 'screen' });
    };
    assert(await page.locator('#poster-copies-one').isChecked(), 'Existing users keep one copy by default');
    for (const copies of ['one', 'two']) {
      await page.locator(`label[for=poster-copies-${copies}]`).click();
      for (const width of [1440, 375]) for (const value of [5785, 5786, 5787, 5788, 5789, 5790, 5791]) await check(width, value);
    }
    await chooseYear(5788);
    for (const mode of ['one', 'each', 'all']) {
      await page.locator(`label[for=poster-sheets-${mode}]`).click();
      await settle();
      if (mode === 'all') {
        assert(await page.locator('#poster-copies-two').isChecked(), 'Returning to All on one retains the copy choice');
        await check(375, 5788);
      } else {
        for (const width of [1440, 375]) for (const value of [5785, 5786, 5787, 5788, 5789, 5790, 5791]) {
          await checkOriginal(width, value);
        }
        await chooseYear(5788);
      }
    }
    for (const margin of ['0.15', '0.75', '0.35']) {
      await page.locator('#poster-margin').selectOption(margin);
      await settle(); await check(375, 5788);
    }
    await page.reload(); await page.locator('.poster.is-halfpage').first().waitFor(); await settle();
    assert(await page.locator('#poster-copies-two').isChecked(), 'Two copies remembered after reload');
    await check(375, 5788);
    await page.locator('label[for=poster-copies-one]').click(); await settle();
    await check(375, 5788);
    await page.reload(); await page.locator('.poster.is-halfpage').waitFor(); await settle();
    assert(await page.locator('#poster-copies-one').isChecked(), 'One copy remembered after reload');
    await page.locator('label[for=poster-copies-two]').click(); await settle();
    const toggle = page.locator('#explain-times-toggle');
    if (await toggle.getAttribute('aria-pressed') === 'false') await toggle.click();
    const secondTime = page.locator('.poster.is-halfpage').nth(1).locator('.onepage-times [data-time-explain]').first();
    const printed = await secondTime.innerText();
    await secondTime.click();
    await page.locator('.time-explain-dialog[open]').waitFor();
    assert.equal(await page.locator('.calc-open-printed').innerText(), printed, 'Second copy retains its own clickable time explanation');
    assert(!await page.locator('.time-explain-dialog').innerText().then(text => text.includes('Calculation not recorded')));
    await page.keyboard.press('Escape');
    await toggle.click();
    // A whole-year print run keeps portrait paper and every occasion on its own sheet.
    await page.locator('label[for=poster-scope-all]').click(); await settle();
    const count = await page.locator('.poster-all-item').count();
    assert(count > 1);
    await page.emulateMedia({ media: 'print' });
    const turned = await page.locator('.poster.is-halfpage').evaluateAll(sheets => sheets.map(s => {
      const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    assert.equal(turned.length, 4, 'Chanukah and Asara B\'Teves each retain both half-page copies');
    assert(turned.every(s => s.x === 0 && s.width === 816 && s.height === 528));
    for (const index of [0, 2]) assert.equal(turned[index + 1].y - turned[index].y, 528, 'Mixed run uses both halves without overlap');
    const run = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    assert.equal(pdfPages(run), count, 'Mixed run has one page per occasion');
    assert.match(run.toString('latin1'), /\/MediaBox \[0 0 612 792\]/);
    await page.emulateMedia({ media: 'screen' });
    await page.locator('label[for=poster-sheets-each]').click(); await settle();
    assert.equal(await page.locator('.poster.is-halfpage,#poster-copies-one').count(), 0, 'A sheet each keeps every original poster in a whole-year run');
    assert.equal(await page.locator('.poster.is-chanukah').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Verified half-Letter copies only under All on one; original full-page Just one and A sheet each; seven years, desktop and phone, saved choices and whole-year runs.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
