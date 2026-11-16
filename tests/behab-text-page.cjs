// Build first. Check the live-shaped Messages page, dates, filtering, editing and copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
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
  const origin = process.env.BEHAB_TEXT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  try {
    for (const width of [320, 375, 393, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        window.behaCopied = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.behaCopied = text; } } });
      });
      if (!process.env.BEHAB_TEXT_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const cards = () => page.locator('.tx-card[data-id^="behab-"]');
      const open = async date => {
        await page.clock.setFixedTime(new Date(date));
        await page.goto(origin + '/texts/?count=off&verify=' + Date.now());
        await page.locator('.tx-title').waitFor();
        assert.equal(await page.locator('a').count(), 1, 'Messages has only its calendar return link');
        assert.equal(await page.locator('[data-calendar-back]').getAttribute('href'), '/admin/calendar/');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Fits this viewport');
        const header = await page.locator('.tx-site-header').evaluate(element => {
          const box = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
          return { bounds:box(element), photo:box(element.querySelector('img')), back:box(element.querySelector('a')), title:box(document.querySelector('.tx-title')), text:element.innerText, pictureReady:element.querySelector('img').complete && element.querySelector('img').naturalWidth > 0 };
        });
        assert(header.pictureReady && header.photo.width === 54 && header.photo.height === 35, 'The original building picture is visible');
        assert(!header.text.includes('Bais Medrash'), 'The long shul name does not crowd the header');
        assert(header.photo.left >= 16 && header.back.right <= width - 16 && header.photo.right + 12 <= header.back.left, 'Photo and return button have space beside each other');
        for (const control of [header.photo, header.back]) assert(control.top >= header.bounds.top + 6 && control.bottom <= header.bounds.bottom - 6, 'Header contents stay inside the navy bar');
        assert(header.back.height >= 44 && header.title.top >= header.bounds.bottom + 16, 'The touch target fits above the page title');
      };
      for (const [date, count] of [['2026-10-14T16:00:00Z', 0], ['2026-10-15T16:00:00Z', 1], ['2026-10-18T16:00:00Z', 2], ['2026-10-19T16:00:00Z', 2], ['2026-10-20T16:00:00Z', 1], ['2026-10-27T16:00:00Z', 0]]) {
        await open(date); assert.equal(await cards().count(), count, date + ': four-day window');
        if (date.startsWith('2026-10-19')) assert((await cards().first().locator('textarea').inputValue()).startsWith('Today Behab'));
        checks.push({ width, date, count });
      }
      await open('2026-10-18T16:00:00Z');
      const card = cards().first(), body = card.locator('textarea');
      assert.equal(await body.inputValue(), 'Tomorrow Behab\n6:40m (Selichos before Shacharis), 7:00en, 7:15d, 7:35sh\nThe following will NOT be saying Selichos\n8:00m, 8:20en, 8:40d');
      assert.match(await card.locator('.tx-date').innerText(), /Oct 18, 2026/);
      assert.match(await card.locator('.tx-when').innerText(), /After Sukkos/);
      await body.fill((await body.inputValue()) + '\nTest addition');
      await card.locator('.tx-copy').click();
      assert.equal(await page.evaluate(() => window.behaCopied), await body.inputValue(), 'Copy uses the edited message');
      if (process.env.BEHAB_TEXT_OUTPUT) { fs.mkdirSync(process.env.BEHAB_TEXT_OUTPUT, { recursive: true }); await page.screenshot({ path: path.join(process.env.BEHAB_TEXT_OUTPUT, `${width}-bhb.png`), fullPage: true }); }
      await page.reload(); await page.locator('.tx-title').waitFor();
      assert(!(await cards().first().locator('textarea').inputValue()).includes('Test addition'), 'Reload rebuilds fresh chart text');
      await page.locator('.tx-title').click({ clickCount: 3 });
      await page.locator('#tx-kind-behab-on').waitFor();
      assert(await cards().count() >= 6, 'Year view includes both rounds');
      await page.locator('label[for=tx-kind-behab-off]').click();
      assert.equal(await cards().count(), 0, 'Behab has its own filter');
      await page.locator('label[for=tx-kind-behab-on]').click();
      assert(await cards().count() >= 6);
      const afterPesach = cards().filter({ hasText: 'After Pesach' }).first();
      assert((await afterPesach.locator('textarea').inputValue()).startsWith('Tomorrow Behab'));
      assert(!(await afterPesach.locator('textarea').inputValue()).includes('Selichos before Shacharis'), 'After Pesach follows the chart note');
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, checks, editingAndCopy: true, yearFilter: true, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
