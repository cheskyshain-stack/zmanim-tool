// Build first. Check the optional mixed layout on paper and saved pairing controls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.ASARA_LAYOUT_OUTPUT;
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
  const origin = process.env.ASARA_LAYOUT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-print-navigation', 'classic');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-13T12:00:00Z') }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year: 5790, group: 'עשרה בטבת', sheet: 'asarabteves', sheets: 'all', workflow: 'single', margin: 0.15,
        }));
      });
      if (!process.env.ASARA_LAYOUT_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00Z'));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.goto(origin + '/admin/#posters/all');
      await page.locator('#poster-asara-shacharis').waitFor(); await settle();
      assert.equal(await page.locator('#poster-asara-shacharis').inputValue(), 'compact', 'Existing layout stays the default');
      const change = async (select, value) => {
        await select.scrollIntoViewIfNeeded(); await select.focus();
        const before = await select.boundingBox(), id = await select.getAttribute('id');
        await select.selectOption(value); await settle();
        const after = await page.locator('#' + id).boundingBox();
        assert(Math.abs(before.y - after.y) < 1, 'The changed control stays in place');
        assert.equal(await page.evaluate(() => document.activeElement.id), id, 'Focus survives the redraw');
      };
      await change(page.locator('#poster-asara-shacharis'), 'locations');
      await page.reload(); await page.locator('.is-asara-detailed').waitFor(); await settle();
      assert.equal(await page.locator('#poster-asara-shacharis').inputValue(), 'locations', 'Single layout is remembered');
      const inspect = async (label, copies) => {
        await settle();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': mobile controls fit');
        const expected = await page.evaluate(async () => {
          const { buildAsaraBTevesPoster } = await import('/js/posters/asarabteves.js');
          const { loadState } = await import('/js/storage.js');
          const { resolveSettings } = await import('/js/settings.js');
          const year = Number(document.querySelector('#poster-year').value);
          const sets = buildAsaraBTevesPoster(year, resolveSettings(loadState().settings)).sets;
          const later = sets.filter(set => set.calc !== 'shacharis').flatMap(set => set.lines?.flat() || []);
          return { times: sets.map(set => set.note ? [set.note.text] : set.lines.flat().map(time => time.text)),
            underlined: later.filter(time => time.underlined).map(time => time.text), starred: later.filter(time => time.mark).map(time => time.text + time.mark) };
        });
        for (const poster of await page.locator('.is-asara-detailed').all()) {
          assert.deepEqual(await poster.locator('.onepage-sec,.halfpage-zman').evaluateAll(rows => rows.map(row => row.textContent.match(/\d{1,2}:\d{2}/g) || [])), expected.times, 'All original schedule times are retained');
          assert.deepEqual(await poster.locator('.shacharis-handout-room').allTextContents(), ['בית מדרש', 'בעזרת נשים', 'בית מדרש למטה', 'באולם השמחות', 'בית מדרש', 'בעזרת נשים', 'בית מדרש למטה']);
          assert.equal(await poster.locator('.shacharis-handout-row u').count(), 0, 'Morning uses room names');
          assert.deepEqual(await poster.locator('u').allTextContents(), expected.underlined, 'Afternoon and evening underlines are preserved');
          const marked = (await poster.locator('.onepage-line').allTextContents()).flatMap(line => line.match(/\d{1,2}:\d{2}\*+/g) || []);
          assert.deepEqual(marked, expected.starred, 'Afternoon and evening stars are preserved');
          assert(!(await poster.locator('.poster-legend').innerText()).includes('באולם השמחות'), 'Unused hall symbol is omitted');
          assert.equal(await poster.locator('.shacharis-handout-date > div').innerText(), `יום ${Number(await page.locator('#poster-year').inputValue()) === 5785 ? 'ו' : 'א'}' ויחי`);
          assert.equal(await poster.locator('.shacharis-handout-note').count(), 1, 'Selichos note is retained');
        }
        await page.emulateMedia({ media: 'print' });
        const boxes = await page.locator('.is-asara-detailed').evaluateAll(posters => posters.map(poster => {
          const box = poster.getBoundingClientRect(), body = poster.querySelector('.halfpage-body').getBoundingClientRect();
          const content = poster.querySelector('.asara-detailed-sections').getBoundingClientRect();
          const footer = poster.querySelector('.poster-legend'), style = getComputedStyle(footer), legend = footer.getBoundingClientRect();
          const title = poster.querySelector('.onepage-title').getBoundingClientRect();
          return { width: box.width, height: box.height, overflow: poster.scrollWidth > poster.clientWidth + 1 || poster.scrollHeight > poster.clientHeight + 1,
            inside: content.top >= body.top - 0.5 && content.bottom <= legend.top - 6,
            centered: Math.abs(content.top - title.bottom - (legend.top - content.bottom)) < 1,
            footer: style.fontSize, weight: style.fontWeight, scale: poster.style.getPropertyValue('--op-scale') };
        }));
        assert.equal(boxes.length, copies);
        for (const box of boxes) {
          assert.deepEqual([box.width, box.height], [528, 816]);
          assert(!box.overflow && box.inside && box.centered, label + ': content fits and is centered: ' + JSON.stringify(box));
          assert(Math.abs(parseFloat(box.footer) - 6.5 * 96 / 72) < 0.01); assert.equal(box.weight, '400');
        }
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'No extra print page');
        assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 792 612\]/);
        if (output) fs.writeFileSync(path.join(output, `${width}-${label}.pdf`), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle();
        results.push({ width, label, boxes });
      };
      for (const year of [5790, 5785]) for (const margin of ['0.15', '0.5', '0.75']) for (const copies of [1, 2]) {
        await page.locator('#poster-year').selectOption(String(year)); await settle();
        await page.locator('.special-print-settings').evaluate(el => { el.open = true; });
        await page.locator('#poster-margin').selectOption(margin); await settle();
        await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
        await inspect(`${year}-${margin}-${copies}`, copies);
      }
      await page.locator('#poster-year').selectOption('5790'); await settle();
      await page.locator('#poster-margin').selectOption('0.15'); await settle();
      await page.locator('label[for=poster-copies-one]').click(); await settle();
      if (output) await page.locator('.is-asara-detailed').screenshot({ path: path.join(output, `${width}-detailed.png`) });
      await page.locator('label[for=poster-workflow-halves]').click(); await settle();
      await page.locator('select[data-half-side=left]').selectOption('asarabteves'); await settle();
      await change(page.locator('select[data-half-shacharis=left]'), 'locations');
      assert.equal(await page.locator('[data-half-side=left] .is-asara-detailed').count(), 1);
      assert.equal(await page.locator('[data-half-side=right] .is-asara-detailed').count(), 0, 'Two copies of Asara can use different styles');
      await inspect('paired-detailed-compact', 1);
      await page.locator('[data-half-action=swap]').click(); await settle();
      assert.equal(await page.locator('select[data-half-shacharis=right]').inputValue(), 'locations', 'Swap carries the style');
      await page.reload(); await page.locator('.is-asara-detailed').waitFor(); await settle();
      assert.equal(await page.locator('select[data-half-shacharis=right]').inputValue(), 'locations', 'Pair style survives reload');
      await inspect('paired-remembered-swapped', 1);
      await page.locator('[data-poster-zmanim]').click(); await page.locator('#zmanim-reference-context').selectOption('1');
      assert.equal(await page.locator('[data-reference-group=mincha]').count(), 1, 'Mixed sheet retains afternoon comparison');
      await page.locator('[data-poster-zmanim]').click();
      await change(page.locator('select[data-half-shacharis=right]'), 'compact');
      assert.equal(await page.locator('.is-asara-detailed').count(), 0, 'Original layout remains available');
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ fixtures: results.length, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
