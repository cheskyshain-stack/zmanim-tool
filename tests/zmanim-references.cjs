// Build first. This suite checks comparison controls and the actual printed sheets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.ZMANIM_REFERENCE_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const pages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const pdfText = pdf => execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.ZMANIM_REFERENCE_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    if (!process.env.ZMANIM_REFERENCE_ORIGIN) await context.route('**/*', route =>
      route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-11T12:00:00Z') }));
    });
    const page = await context.newPage(), errors = [], checked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
    const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
    const noOverflow = async () => {
      await settle();
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        outside: [...document.querySelectorAll('main *, .sidebar *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8).map(el => ({ name: el.className || el.tagName, right: el.getBoundingClientRect().right })) }));
      assert(layout.scroll <= layout.width, 'Admin fits this viewport: ' + JSON.stringify(layout));
    };
    const chooseGroup = async group => { await page.locator(`[data-reference-group="${group}"]`).click(); await settle(); };
    const printed = async selector => {
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('#zmanim-reference-panel').isVisible(), false, 'Comparison does not print');
      const geometry = await page.locator(selector).evaluateAll(sheets => sheets.map(sheet => ({
        width: sheet.getBoundingClientRect().width, height: sheet.getBoundingClientRect().height,
        rows: [...sheet.querySelectorAll('tr,.onepage-row')].map(row => row.getBoundingClientRect().height),
        text: sheet.innerText,
      })));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
      await page.emulateMedia({ media: 'screen' });
      return { geometry, text: pdfText(pdf), pages: pages(pdf), pdf };
    };
    await page.goto(origin + '/admin/?count=off&b=' + Date.now() + '#charts');
    await page.locator('.pages .page').first().waitFor(); await settle();
    const before = await printed('.pages .page');
    await page.locator('#show-zmanim-toggle').click();
    await page.locator('#zmanim-reference-date').waitFor(); await settle();
    assert.equal(await page.locator('#zmanim-reference-context option').count(), 2, 'Both Shabbos and Weekday charts are selectable');
    await chooseGroup('mincha');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.referenceGroup), 'mincha', 'Group buttons retain keyboard focus');
    for (const key of ['shkia', 'chatzos', 'gedola', 'chatzos-30', 'gedola-lechumra', 'gedola-week', 'plag-gra', 'plag-mga', 'plag-mga-72']) {
      assert.equal(await page.locator(`[data-reference-key="${key}"]`).count(), 1, 'Mincha reference: ' + key);
    }
    const saved = await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1'));
    const friday = page.locator('.pages .page').first().locator('.cell[data-col=G]').first();
    const serial = Number(await friday.getAttribute('data-serial'));
    // Dispatch the same cell click even if the sticky reference panel covers its paint.
    await friday.dispatchEvent('click'); await settle();
    assert.equal(Number(await page.locator('#zmanim-reference-date').inputValue()), serial - 1, 'Friday Mincha selects Friday, not Shabbos');
    const shacharis = page.locator('.pages .page').first().locator('.cell[data-col=E]').first();
    await shacharis.dispatchEvent('click'); await settle();
    assert.equal(Number(await page.locator('#zmanim-reference-date').inputValue()), serial, 'Shabbos Shacharis selects Shabbos');
    assert.equal(await page.locator('[data-reference-key=netz]').count(), 1);
    const chol = page.locator('.pages .page').last().locator('.cell[data-col=C]').last();
    const cholAnchor = Number(await chol.getAttribute('data-serial'));
    await chol.dispatchEvent('click'); await settle();
    const cholDate = Number(await page.locator('#zmanim-reference-date').inputValue());
    assert(cholDate >= cholAnchor - 6 && cholDate < cholAnchor, 'Clicking a later weekday row selects a day of that row');
    assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), saved, 'Comparing times does not save or change a schedule');
    const after = await printed('.pages .page');
    assert.deepEqual(after.geometry, before.geometry, 'Chart dimensions, rows and values are unchanged');
    assert.equal(after.text, before.text, 'Actual PDF text is identical with comparison enabled');
    assert.equal(after.pages, before.pages);
    if (output) { fs.writeFileSync(path.join(output, 'seasonal-comparison.pdf'), after.pdf); await page.locator('#zmanim-reference-panel').screenshot({ path: path.join(output, 'seasonal-panel.png') }); }
    checked.push('seasonal charts and PDF geometry');

    await page.goto(origin + '/admin/#week'); await page.locator('.week-cards').waitFor(); await settle();
    assert(await page.locator('#zmanim-reference-panel').isVisible(), 'Comparison follows weekly schedules');
    assert.equal(await page.locator('#zmanim-reference-date option').count(), 7);
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const group of ['shacharis', 'mincha', 'maariv', 'other']) { await chooseGroup(group); await noOverflow(); }
    }
    checked.push('weekly schedules and 320/375/1440 widths');

    await page.goto(origin + '/admin/#posters/behabcheshvan'); await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
    assert.equal(await page.locator('#zmanim-reference-date option').count(), 3, 'BHB exposes only its three scheduled dates');
    assert.equal(await page.locator('[data-reference-group]').count(), 1, 'Morning handouts initially offer only morning zmanim');
    assert.deepEqual(await page.locator('#zmanim-reference-date option').allTextContents(),
      ['Monday, Oct 19, 2026', 'Thursday, Oct 22, 2026', 'Monday, Oct 26, 2026']);
    const bhbOn = await printed('.poster.is-shacharis');
    await page.locator('#show-zmanim-toggle').click(); await settle();
    const bhbOff = await printed('.poster.is-shacharis');
    assert.deepEqual(bhbOn.geometry, bhbOff.geometry);
    assert.equal(bhbOn.text, bhbOff.text, 'The half-page PDF retains the same dates and minyanim');
    assert.equal(bhbOn.pages, 1);
    await page.locator('#show-zmanim-toggle').click();
    if (output) await page.locator('#zmanim-reference-panel').screenshot({ path: path.join(output, 'bhb-panel.png') });
    checked.push('BHB dates and half-page printing');

    const options = await page.locator('#poster-group option').allTextContents();
    for (const option of options) {
      await page.locator('#poster-group').selectOption(option); await settle();
      if (await page.locator('#poster-sheet .poster').count()) {
        assert(await page.locator('#zmanim-reference-panel').isVisible(), option + ' has comparison dates');
        assert(await page.locator('#zmanim-reference-date option').count() > 0, option + ' has actual dates');
        await noOverflow();
      }
    }
    await page.goto(origin + '/admin/#posters/asarabteves'); await page.locator('#poster-sheet .poster').first().waitFor(); await settle();
    assert.equal(await page.locator('#zmanim-reference-date option').count(), 1, 'Asara uses its own date');
    await chooseGroup('maariv');
    assert.match(await page.locator('[data-reference-key=shkia] dd').innerText(), /^4:34:08\.\d+ PM$/);
    assert.equal(await page.locator('[data-reference-key=shkia-plus-35]').count(), 1);
    if (output) await page.screenshot({ path: path.join(output, 'asara-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 1100 }); await noOverflow();
    if (output) await page.screenshot({ path: path.join(output, 'asara-phone.png'), fullPage: true });
    await page.reload(); await page.locator('#zmanim-reference-date').waitFor();
    assert.equal(await page.locator('#show-zmanim-toggle').getAttribute('aria-pressed'), 'true', 'Show zmanim survives reload');
    checked.push('all available special schedules, Asara raw sunset and remembered switch');

    await page.goto(origin + '/admin/#posters/vasikinboth'); await page.locator('#poster-sheet .poster').first().waitFor(); await settle();
    assert.equal(await page.locator('[data-reference-group]').count(), 1, 'Vasikin schedules offer morning zmanim');
    await page.locator('.zmanim-reference-more summary').click();
    assert(await page.locator('[data-reference-key=alos-72]').isVisible(), 'Additional morning references can be expanded');
    await page.locator('#zmanim-reference-date').focus();
    const dates = await page.locator('#zmanim-reference-date option').evaluateAll(options => options.map(option => option.value));
    await page.locator('#zmanim-reference-date').selectOption(dates[0]);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'zmanim-reference-date', 'Date selection retains keyboard focus');
    checked.push('Vasikin and keyboard focus');

    await page.goto(origin + '/admin/#generate');
    await page.locator('label[for=season-choref]').click();
    await page.locator('input[name=hebrewYear]').fill('5787');
    await page.locator('#gen-form button[type=submit]').click();
    await page.locator('#page-form button[type=submit]').click();
    await page.locator('#pages .page').first().waitFor(); await settle();
    assert.equal(await page.locator('#zmanim-reference-context option').count(), await page.locator('#pages .page').count(), 'Each saved print-layout page can be checked');
    await chooseGroup('mincha');
    await page.locator('#zmanim-reference-context').selectOption('2'); await settle(); await noOverflow();
    const savedOn = await printed('#pages .page');
    await page.locator('#show-zmanim-toggle').click(); await settle();
    const savedOff = await printed('#pages .page');
    assert.deepEqual(savedOn.geometry, savedOff.geometry);
    assert.equal(savedOn.text, savedOff.text);
    checked.push('saved print layouts');

    await page.goto(origin + '/chart/?count=off'); await page.locator('.pages .page').first().waitFor();
    assert.equal(await page.locator('[data-zmanim-reference],#show-zmanim-toggle,#zmanim-reference-panel').count(), 0, 'Congregation charts have no admin comparison metadata or controls');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, checked, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
