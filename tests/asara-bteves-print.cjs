// Run after both builds, with Playwright on NODE_PATH. ASARA_ORIGIN also checks the deployed build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.ASARA_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.ASARA_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    if (!process.env.ASARA_ORIGIN) await context.route('**/*', route =>
      route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-08T12:00:00Z') }));
      if (!localStorage.getItem('zmanim-poster-bar-v1')) {
        localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5786, group: 'עשרה בטבת', sheets: 'one', scope: 'one' }));
      }
    });
    const page = await context.newPage(), errors = [], measured = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
    const response = await page.goto(origin + '/admin/#posters/all');
    const html = await response.text(), expectedHTML = fs.readFileSync(root + '/admin/index.html', 'utf8');
    for (const pattern of [/css\/app\.css\?v=[a-f0-9]+/, /css\/print\.css\?v=[a-f0-9]+/]) {
      assert.equal(html.match(pattern)?.[0], expectedHTML.match(pattern)?.[0]);
    }
    const importMap = source => JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    for (const name of ['/js/posters/asarabteves.js', '/js/ui/posters-view.js', '/js/sheets/common.js']) {
      assert.equal(importMap(html)[name], importMap(expectedHTML)[name], name + ' has the tested version');
    }
    await page.locator('#poster-sheet .poster').waitFor();
    const settle = () => page.evaluate(() => document.fonts.ready);
    const chooseYear = async year => {
      while (Number(await page.locator('.poster-year-now').getAttribute('data-year')) !== year) {
        await page.locator(Number(await page.locator('.poster-year-now').getAttribute('data-year')) < year ? '#poster-year-next' : '#poster-year-back').click();
      }
      await settle();
    };
    for (const width of [1440, 375]) for (const mode of ['one', 'each', 'all']) for (const year of [5785, 5786, 5787]) for (const copies of mode === 'all' ? [1, 2] : [1]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator(`label[for=poster-sheets-${mode}]`).click();
      await chooseYear(year);
      if (mode === 'all') {
        await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
        await settle();
      } else {
        assert.equal(await page.locator('#poster-copies-one,.poster.is-halfpage').count(), 0, 'Original modes keep the full-page layout');
      }
      const expected = await page.evaluate(async year => {
        const { buildAsaraBTevesPoster } = await import('/js/posters/asarabteves.js');
        const { loadState } = await import('/js/storage.js');
        const { resolveSettings } = await import('/js/settings.js');
        const p = buildAsaraBTevesPoster(year, resolveSettings(loadState().settings));
        return { title: p.title, sets: p.sets.map(s => s.note ? [s.note.text] : s.lines.flat().map(t => t.text)) };
      }, year);
      assert.equal(await page.locator('#poster-sheet .poster').count(), copies);
      const rows = mode === 'all' ? '.halfpage-body .onepage-sec,.halfpage-zman' : '.poster-set';
      const actual = await page.locator('#poster-sheet .poster').first().locator(rows).evaluateAll(rows =>
        rows.map(row => row.textContent.match(/\d{1,2}:\d{2}/g) || []));
      assert.deepEqual(actual, expected.sets, 'Every time retained in ' + JSON.stringify({ width, mode, year }));
      const texts = await page.locator('#poster-sheet .poster').allTextContents();
      assert(texts.every(text => text === texts[0]), 'Both copies retain identical times and notes');
      assert.equal(await page.locator('#poster-sheet .poster-time-note').count(), copies);
      assert.equal(await page.locator('#poster-sheet .poster-annotated-time').first().textContent(), '6:40(סליחות קודם שחרית)');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone preview fits');
      await page.emulateMedia({ media: 'print' });
      const boxes = await page.locator('#poster-sheet .poster').evaluateAll(sheets => sheets.map(sheet => {
        const r = sheet.getBoundingClientRect(), css = getComputedStyle(sheet), zoom = r.height / parseFloat(css.height);
        const legend = sheet.querySelector('.poster-legend').getBoundingClientRect();
        const note = sheet.querySelector('.poster-time-note').getBoundingClientRect();
        const body = sheet.querySelector('.halfpage-body.is-asara');
        const content = body?.lastElementChild.getBoundingClientRect();
        const times = [...sheet.querySelectorAll('.poster-set-line,.onepage-line,.halfpage-zman')].map(el => el.getBoundingClientRect());
        return { x: r.x, y: r.y, width: parseFloat(css.width), height: parseFloat(css.height),
          legendBottom: legend.bottom, limit: r.bottom - parseFloat(css.paddingBottom) * zoom,
          contentGap: content ? legend.top - content.bottom : null,
          sectionGaps: body ? [...body.children].slice(1).map((el, i) =>
            el.getBoundingClientRect().top - body.children[i].getBoundingClientRect().bottom) : [],
          timesInside: times.every(t => t.x >= r.x - 1 && t.right <= r.right + 1),
          noteInside: note.x >= r.x && note.right <= r.right && note.bottom <= legend.top,
          noteFont: parseFloat(getComputedStyle(sheet.querySelector('.poster-time-note')).fontSize) };
      }));
      for (const [index, box] of boxes.entries()) {
        const size = mode === 'all' ? [528, 816] : [816, 1056];
        assert(Math.abs(box.width - size[0]) < 0.1 && Math.abs(box.height - size[1]) < 0.1);
        if (mode === 'all') assert.deepEqual([box.x, box.y], [index * 528, 0], 'Copies sit on the two halves of Letter paper');
        if (mode === 'all') {
          assert(box.contentGap >= 12, 'The schedule leaves room before the location notes');
          assert(box.sectionGaps.every(gap => gap >= 12 && gap <= 24), 'Tefillah blocks stay together with modest gaps');
        }
        assert(box.legendBottom <= box.limit + 0.5, 'Location key stays inside the frame');
        assert(box.timesInside && box.noteInside, 'Times and the 6:40 note stay inside the page');
      }
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true,
        path: output ? `${output}/${year}-${mode}-${width}-${copies}.pdf` : undefined });
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'One printed page');
      assert.match(pdf.toString('latin1'), mode === 'all' ? /\/MediaBox \[0 0 792 612\]/ : /\/MediaBox \[0 0 612 792\]/);
      await page.emulateMedia({ media: 'screen' });
      if (output && width === 1440) {
        await page.locator('#poster-sheet .poster').first().screenshot({ path: `${output}/${year}-${mode}-${copies}-poster.png` });
      }
      measured.push({ year, width, mode, copies, boxes });
    }
    // Copies and physical size survive reloads, large margins, and phone rotation.
    await page.reload(); await page.locator('.poster.is-halfpage').first().waitFor(); await settle();
    assert(await page.locator('#poster-copies-two').isChecked(), 'Two copies are remembered');
    await chooseYear(5785);
    for (const margin of ['0.15', '0.75', '0.35']) {
      await page.locator('#poster-margin').selectOption(margin); await settle();
      const fits = await page.locator('.poster.is-halfpage').evaluateAll(sheets => sheets.every(sheet => {
        const r = sheet.getBoundingClientRect(), legend = sheet.querySelector('.poster-legend').getBoundingClientRect();
        return sheet.querySelector('.halfpage-body').getBoundingClientRect().bottom < legend.top
          && legend.bottom <= r.bottom && sheet.scrollWidth <= sheet.clientWidth;
      }));
      assert(fits, 'Friday handout fits at margin ' + margin);
    }
    await page.locator('label[for=poster-copies-one]').click();
    await page.reload(); await page.locator('.poster.is-halfpage').waitFor(); await settle();
    assert(await page.locator('#poster-copies-one').isChecked(), 'One copy is remembered');
    await page.setViewportSize({ width: 812, height: 375 }); await settle();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Rotated phone fits');
    await page.setViewportSize({ width: 375, height: 1100 }); await settle();
    // The congregation's full-size Special Schedule and text card appear near the fast,
    // using the same builder, without requiring an admin visit.
    for (const [year, instant] of [[5786, '2025-12-28T12:00:00Z'], [5785, '2025-01-08T12:00:00Z']]) {
      await page.clock.setFixedTime(new Date(instant));
      await page.goto(origin + '/schedules/');
      await page.locator('.luach-sheet').first().waitFor();
      const sheet = page.locator('.luach-sheet').filter({ hasText: 'עשרה בטבת' });
      assert.equal(await sheet.count(), 1);
      assert.equal(await sheet.locator('.poster-time-note').count(), 1);
      assert.equal(await sheet.locator('.poster.is-halfpage').count(), 0);
      await page.goto(origin + '/texts/');
      const card = page.locator('.tx-card').filter({ hasText: "Asara B'Teves" });
      await card.waitFor();
      assert.equal(await card.count(), 1);
      const text = await card.locator('.tx-body').inputValue();
      assert.match(text, /6:40m \(Selichos before Shacharis\)/);
      assert.match(text, /Mincha /);
      assert.match(text, /Shkia /);
      if (year === 5785) assert.match(text, /Hadlakas Neiros 4:32/);
      else assert.match(text, /Mariv 5:16m, 5:31d, 10:30m/);
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(output + '/measurements.json', JSON.stringify(measured, null, 2));
    console.log(JSON.stringify({ checks: measured.length, years: [5785, 5786, 5787], widths: [1440, 375],
      modes: ['one', 'each', 'all'], publicSchedules: true, fastMessages: true, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
