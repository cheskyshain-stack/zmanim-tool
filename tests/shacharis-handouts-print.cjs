// Run after build-offline.py, with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.SHACHARIS_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const choices = ['עשרה בטבת · שחרית', 'בה"ב חשון · שחרית', 'בה"ב אייר · שחרית'];
const expected = [
  ['בית מדרש', '6:40'], ['בעזרת נשים', '7:00'], ['בית מדרש למטה', '7:15'],
  ['באולם השמחות', '7:35'], ['בית מדרש', '8:00'], ['בעזרת נשים', '8:20'], ['בית מדרש למטה', '8:40'],
];
const pdfPages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SHACHARIS_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    if (!process.env.SHACHARIS_ORIGIN) await context.route('**/*', route =>
      route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-09T12:00:00Z') }));
      if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1',
        JSON.stringify({ year: 5787, group: 'עשרה בטבת · שחרית', sheets: 'all', scope: 'all', margin: 0.35 }));
    });
    const page = await context.newPage(), errors = [], measured = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { response = await page.goto(origin + '/admin/?morning-check=' + attempt + '#posters/all'); if (response.ok()) break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    assert(response?.ok(), 'Admin page loads');
    const html = await response.text(), localHTML = fs.readFileSync(root + '/admin/index.html', 'utf8');
    for (const pattern of [/css\/app\.css\?v=[a-f0-9]+/, /css\/print\.css\?v=[a-f0-9]+/]) {
      assert.equal(html.match(pattern)?.[0], localHTML.match(pattern)?.[0], 'Tested print styles are served');
    }
    const imports = source => JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    for (const module of ['/js/ui/posters-view.js', '/js/posters/shacharis.js', '/js/posters/special-shacharis.js']) {
      assert.equal(imports(html)[module], imports(localHTML)[module], 'Tested module is served');
    }
    await page.locator('.poster.is-shacharis').waitFor();
    const settle = () => page.evaluate(() => document.fonts.ready);
    const chooseYear = async year => {
      while (Number(await page.locator('.poster-year-now').getAttribute('data-year')) !== year) {
        await page.locator(Number(await page.locator('.poster-year-now').getAttribute('data-year')) < year ? '#poster-year-next' : '#poster-year-back').click();
      }
      await settle();
    };
    const measure = async copies => {
      const actual = await page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-run').evaluateAll(rows => rows.map(row =>
        [row.querySelector('.shacharis-handout-room').textContent, row.querySelector('.shacharis-handout-time').textContent]));
      assert.deepEqual(actual, expected, 'Every time is paired with its written room');
      assert.equal(await page.locator('.poster.is-shacharis').count(), copies);
      assert.equal(await page.locator('.poster.is-shacharis.is-onepage .page-header').count(), copies, 'Morning handouts use the compact letterhead');
      assert.equal(await page.locator('.poster.is-shacharis .onepage-title,.poster.is-shacharis .onepage-sec-head').count(), copies * 2,
        'Compact title and Shacharis section bar are present');
      assert.equal(await page.locator('.poster.is-shacharis .poster-wordmark,.poster.is-shacharis .poster-rule').count(), 0, 'No framed Word-style letterhead');
      assert.equal(await page.locator('.shacharis-handout-shade').count(), copies * 3);
      assert.equal(await page.locator('.poster.is-shacharis u').count(), 0, 'Rooms replace location underlines');
      const texts = await page.locator('.poster.is-shacharis').allTextContents();
      assert(texts.every(text => text === texts[0] && !text.includes('*') && !/מנחה|מעריב/.test(text)), 'Only morning times, without location stars');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone preview fits');
      await page.emulateMedia({ media: 'print' });
      const boxes = await page.locator('.poster.is-shacharis').evaluateAll(sheets => sheets.map(sheet => {
        const r = sheet.getBoundingClientRect(), cs = getComputedStyle(sheet);
        const content = [...sheet.querySelectorAll('.page-header,.onepage-title,.onepage-sec-head,.shacharis-handout-run,.shacharis-handout-note')]
          .map(el => el.getBoundingClientRect());
        return { x: r.x, y: r.y, width: r.width, height: r.height,
          inside: content.every(c => c.x >= r.x + parseFloat(cs.paddingLeft) - 1 && c.right <= r.right - parseFloat(cs.paddingRight) + 1
            && c.y >= r.y + parseFloat(cs.paddingTop) - 1 && c.bottom <= r.bottom - parseFloat(cs.paddingBottom) + 1),
          overflow: sheet.scrollHeight > sheet.clientHeight || sheet.scrollWidth > sheet.clientWidth,
          typeSize: parseFloat(getComputedStyle(sheet.querySelector('.shacharis-handout-run')).fontSize),
          rtl: [...sheet.querySelectorAll('.shacharis-handout-run')].every(row =>
            row.querySelector('.shacharis-handout-room').getBoundingClientRect().left >= row.querySelector('.shacharis-handout-time').getBoundingClientRect().right),
          paper: document.getElementById('print-page-size').textContent };
      }));
      for (const [i, box] of boxes.entries()) {
        assert.deepEqual([box.x, box.y, box.width, box.height], [i * 528, 0, 528, 816], 'Each copy is a real half Letter sheet');
        assert(box.inside && !box.overflow, 'Letterhead, rooms, times and note fit inside the print margins: ' + JSON.stringify(box));
        assert(box.rtl, 'Hebrew room on the right, its time on the left');
        assert(box.typeSize >= 20, 'Times remain large enough for a morning poster');
        assert(box.paper.includes('letter landscape'));
      }
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
      assert.equal(pdfPages(pdf), 1, 'One landscape sheet with no overflow page');
      assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 792 612\]/);
      await page.emulateMedia({ media: 'screen' });
      return { boxes, pdf };
    };
    for (const [choiceIndex, choice] of choices.entries()) for (const year of [5785, 5787, 5790]) for (const width of [1440, 375]) for (const copies of [1, 2]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('#poster-group').selectOption(choice);
      await chooseYear(year);
      await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
      await settle();
      assert.equal(await page.locator('input[name=poster-sheets],input[name=poster-scope],input[name=poster-break]').count(), 0,
        'A standalone half-page poster does not offer unrelated layouts');
      assert.equal(await page.locator('.shacharis-handout-note').count(), choiceIndex === 0 ? copies : 0);
      const result = await measure(copies);
      measured.push({ choice, year, width, copies, typeSize: result.boxes[0].typeSize });
      if (output && year === 5787 && width === 1440 && copies === 1) {
        await page.locator('.poster.is-shacharis').screenshot({ path: path.join(output, choiceIndex + '-poster.png') });
        fs.writeFileSync(path.join(output, choiceIndex + '-one.pdf'), result.pdf);
      }
    }
    for (const margin of ['0.15', '0.75', '0.35']) {
      await page.locator('#poster-margin').selectOption(margin); await settle(); await measure(2);
    }
    await page.locator('label[for=poster-ink-mono]').click(); await settle(); await measure(2);
    await page.reload(); await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
    assert(await page.locator('#poster-copies-two').isChecked(), 'Copies setting survives reload');
    assert(await page.locator('#poster-ink-mono').isChecked());
    assert.equal(await page.locator('#poster-margin').inputValue(), '0.35');
    await measure(2);
    for (const key of ['asarashacharis', 'behabcheshvan', 'behabiyar']) {
      await page.goto(origin + '/admin/#posters/' + key); await page.locator('.poster.is-shacharis').first().waitFor(); await settle(); await measure(2);
    }
    await page.locator('#poster-group').selectOption('עשרה בטבת'); await settle();
    await page.locator('label[for=poster-scope-one]').click(); await settle();
    assert.equal(await page.locator('.poster.is-shacharis').count(), 0, 'The full Asara schedule remains separate');
    assert.equal(await page.locator('.halfpage-body.is-asara').count(), 2, 'Existing compact Asara copies remain available');
    assert.equal(await page.locator('.halfpage-body.is-asara .onepage-sec-head').first().innerText(), 'שחרית');
    assert((await page.locator('#poster-sheet').innerText()).includes('מנחה'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, cases: measured.length, measured, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
