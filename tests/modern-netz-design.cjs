const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.MODERN_NETZ_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.MODERN_NETZ_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (output) fs.mkdirSync(output, { recursive: true });
  const checks = [], errors = [];
  try {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        localStorage.setItem('zmanim-nocount', '1');
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, sheet: 'vasikinboth', design: 'new', margin: 0.2, marginDefault: 0.15 }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const expected = year => page.evaluate(async year => {
        const { buildVasikinPoster } = await import('/js/posters/vasikin.js');
        const { loadState } = await import('/js/storage.js'), { resolveSettings } = await import('/js/settings.js');
        return buildVasikinPoster(year, resolveSettings(loadState().settings), 'both').days.flatMap(day => day.lines.map(line => line.text));
      }, year);
      const check = async year => {
        await settle();
        const times = await expected(year);
        assert.deepEqual(await page.locator('.is-modern-vasikin .netz-row strong').allTextContents(), times);
        assert.equal(await page.locator('.is-modern-vasikin .netz-row [data-time-explain]').count(), new URL(page.url()).pathname.startsWith('/admin/') ? 15 : 0,
          'Admin retains all traces and public pages omit admin controls');
        const geometry = await page.locator('.is-modern-vasikin').evaluate(sheet => {
          const rect = sheet.getBoundingClientRect(), css = getComputedStyle(sheet), zoom = rect.width / sheet.offsetWidth;
          const header = sheet.querySelector('.page-header'), intro = sheet.querySelector('.netz-intro');
          const last = sheet.querySelector('.netz-block:last-of-type'), footer = sheet.querySelector('.netz-footer');
          const days = [...sheet.querySelectorAll('.netz-day')].map(day => day.getBoundingClientRect());
          const yk = sheet.querySelector('.netz-kippur .netz-rows').getBoundingClientRect();
          const outside = [...sheet.querySelectorAll('.netz-row span,.netz-row strong,.netz-title,.netz-location,.netz-day h3,.netz-footer p')].filter(el => {
            const range = document.createRange(); range.selectNodeContents(el); const box = range.getBoundingClientRect();
            return box.left < rect.left + parseFloat(css.paddingLeft) * zoom - 1 || box.right > rect.right - parseFloat(css.paddingRight) * zoom + 1 || box.bottom > rect.bottom - parseFloat(css.paddingBottom) * zoom + 1;
          }).map(el => el.textContent);
          return { width: sheet.offsetWidth, height: sheet.offsetHeight, outside,
            headerRule: parseFloat(getComputedStyle(header).borderBottomWidth) > 0 && header.getBoundingClientRect().bottom <= intro.getBoundingClientRect().top + 1,
            introRule: getComputedStyle(intro).borderBottomWidth,
            footerClear: last.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top - 5 * zoom,
            footerGap: (footer.getBoundingClientRect().top - last.getBoundingClientRect().bottom) / zoom,
            firstDayRight: days[0].left > days[1].left,
            ykCentered: Math.abs((yk.left + yk.right) / 2 - (rect.left + rect.right) / 2) < 1,
            photo: new URL(sheet.querySelector('.header-icon').src).pathname,
            overflow: sheet.scrollWidth > sheet.clientWidth || sheet.scrollHeight > sheet.clientHeight,
            scale: css.getPropertyValue('--netz-scale') };
        });
        assert.equal(geometry.width, 816); assert.equal(geometry.height, 1056);
        assert.deepEqual(geometry.outside, [], 'All text stays within the margins: ' + JSON.stringify(geometry));
        assert(geometry.headerRule); assert.equal(geometry.introRule, '0px'); assert(geometry.footerClear, JSON.stringify({ width, year, ...geometry }));
        assert(geometry.firstDayRight && geometry.ykCentered); assert(!geometry.overflow);
        assert.equal(geometry.photo, '/assets/logo-building-icon.png');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        return { times, geometry };
      };
      const print = async (name, times, count = 1) => {
        await page.emulateMedia({ media: 'print' }); await settle();
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, count);
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 612 792]'));
        const text = execFileSync('pdftotext', ['-raw', '-', '-'], { input: pdf, encoding: 'utf8' });
        for (const time of times) assert(text.includes(time), name + ' keeps ' + time);
        if (output) fs.writeFileSync(path.join(output, width + '-' + name + '.pdf'), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle();
        checks.push({ width, name, pages: count });
      };
      await page.goto(origin + '/admin/#posters/vasikinboth'); await page.locator('.is-modern-vasikin').waitFor();
      assert.equal(await page.locator('#poster-break-even,#poster-break-day').count(), 0, 'The fixed Netz layout has no unrelated column-splitting controls');
      const initial = await check(5787);
      if (output) await page.locator('.is-modern-vasikin').screenshot({ path: path.join(output, width + '-new.png') });
      await print('new', initial.times);
      await page.locator('label[for=poster-design-old]').click(); await settle();
      assert.equal(await page.locator('.is-modern-vasikin').count(), 0);
      assert.equal(await page.locator('.is-vasikin.is-both').count(), 1);
      await print('old', initial.times);
      await page.locator('label[for=poster-design-new]').click(); await settle();
      for (const year of [5785, 5787, 5791]) {
        await page.locator('#poster-year').selectOption(String(year));
        await page.locator('.special-print-settings').evaluate(el => el.open = true);
        for (const margin of ['0.15', '0.75']) {
          await page.locator('#poster-margin').selectOption(margin);
          const result = await check(year);
          await print(year + '-margin-' + margin, result.times);
        }
      }
      await page.locator('label[for=poster-ink-mono]').click(); await settle();
      assert(await page.locator('.is-modern-vasikin').evaluate(el => el.classList.contains('is-mono')));
      await check(5791);
      await page.locator('#poster-margin').selectOption('0.15');
      await page.locator('#poster-year').selectOption('5787');
      await page.reload(); await page.locator('.is-modern-vasikin').waitFor(); await check(5787);
      await page.locator('[data-job-action=page]').first().click();
      await page.locator('[data-add-group]').selectOption('בה"ב אחר סוכות');
      await page.locator('.special-add-page button[type=submit]').click(); await settle();
      await check(5787); await print('mixed-with-half', initial.times, 2);
      await page.goto(origin + '/schedules/?count=off&website-preview=2026-09-14T15%3A00%3A00.000Z');
      await page.locator('.is-modern-vasikin').waitFor(); await check(5787);
      assert.equal(await page.locator('.is-vasikin.is-both').count(), 0);
      await print('public', initial.times, await page.locator('.luach-sheet').count());
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
