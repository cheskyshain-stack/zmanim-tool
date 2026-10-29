// Real interactions must retain the control's position and focus after a redraw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SCROLL_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (window !== window.top) return;
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-09T12:00:00Z') }));
      if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1',
        JSON.stringify({ year: 5787, group: 'חנוכה', sheets: 'all', scope: 'one', margin: 0.35 }));
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async () => { throw new Error('Clipboard denied in this test'); } } });
      document.execCommand = () => true;
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === 'data:') return route.continue();
      if (url.hostname === 'secure.cardknox.com') return route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><label>Test form <input id="donor-name"></label>' });
      if (url.hostname === 'zmanim-traffic.cheskyshain.workers.dev') {
        await new Promise(resolve => setTimeout(resolve, 150));
        const start = url.searchParams.get('start'), end = url.searchParams.get('end');
        return route.fulfill({ json: { schemaVersion: 2, timezone: 'America/New_York', range: { start, end },
          snapshotAt: url.searchParams.get('asOf'), fetchedAt: new Date().toISOString(),
          totals: { views: 10, visits: 5 }, coverage: { status: 'complete', detailStatus: 'complete' },
          byDay: [{ date: end, status: 'complete', views: 10, visits: 5 }] } });
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
    const settle = () => page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const visit = async route => {
      const response = await page.goto(origin + route);
      assert(!response || response.ok());
      await settle();
    };
    const clickInPlace = async (selector, name, { focused = true } = {}) => {
      const button = page.locator(selector).first();
      await button.waitFor();
      await button.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await settle();
      const before = await button.evaluate(el => ({ y: scrollY, top: el.getBoundingClientRect().top }));
      await button.click();
      await settle();
      await page.waitForTimeout(180); // Include fitting, smooth-scroll mistakes, and async redraws.
      const after = await page.locator(selector).first().evaluate(el => ({ y: scrollY,
        top: el.getBoundingClientRect().top, disabled: Boolean(el.disabled),
        focused: document.activeElement === el || el.tagName === 'LABEL' && document.activeElement === el.control,
        bodyFocused: document.activeElement === document.body }));
      assert(Math.abs(after.top - before.top) < 3, name + ': the clicked control moved: ' + JSON.stringify({ before, after }));
      if (focused && !after.disabled) assert(after.focused, name + ': focus was lost');
      if (focused && after.disabled) assert(!after.bodyFocused, name + ': disabled control sent focus to the page');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': horizontal overflow');
      checks.push({ width: page.viewportSize().width, name, beforeY: before.y, afterY: after.y });
    };
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 640 });
      await visit('/admin/#charts');
      await page.locator('.chart-next').waitFor();
      await clickInPlace('.chart-next', 'Season chart Next');
      await clickInPlace('.chart-prev', 'Season chart Previous');
      await clickInPlace('.chart-today', 'Season chart Today');
      await visit('/admin/#week');
      await clickInPlace('#week-next', 'Admin week Next');
      await clickInPlace('#week-prev', 'Admin week Previous');
      await clickInPlace('#week-today', 'Admin week Today');
      await page.locator('.week-print-panel').evaluate(el => { el.open = true; });
      await clickInPlace('label[for="week-layout-combined"]', 'Weekly layout');
      assert(await page.locator('.week-print-panel').evaluate(el => el.open), 'Weekly print panel stays open');
      await visit('/week/');
      await clickInPlace('#reader-next', 'Public week Next');
      await clickInPlace('#reader-prev', 'Public week Previous');
      await clickInPlace('#reader-today', 'Public week Today');
      await page.locator('.reader-agenda-day').first().evaluate(el => { el.open = true; });
      await page.waitForTimeout(350);
      await page.evaluate(() => window.scrollTo(0, 120));
      const minuteY = await page.evaluate(() => scrollY);
      await page.clock.runFor(60050);
      await settle();
      await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => scrollY), minuteY, 'Minute refresh retains the reader position');
      await visit('/admin/#posters/all');
      await clickInPlace('#poster-year-next', 'Special schedule year +');
      await clickInPlace('#poster-year-today', 'Special schedule Current year');
      await clickInPlace('#poster-year-back', 'Special schedule year -');
      await clickInPlace('#poster-year-today', 'Return to Current year');
      await clickInPlace('#poster-group-next', 'Special schedule occasion +');
      await clickInPlace('#poster-group-back', 'Special schedule occasion -');
      await page.locator('#poster-group').selectOption('ראש השנה יום כיפור');
      await page.locator('#poster-pick').selectOption('roshhashana');
      await clickInPlace('#poster-page-next', 'Special schedule page +');
      await clickInPlace('#poster-page-back', 'Special schedule page -');
      await clickInPlace('#poster-page-next', 'Select another special schedule page');
      await clickInPlace('#poster-page-now', 'Special schedule Current page');
      await page.locator('#poster-group').selectOption('חנוכה');
      await page.locator('label[for=poster-design-new]').click();
      await page.locator('.special-print-settings').evaluate(el => { el.open = true; });
      await clickInPlace('label[for=poster-design-old]', 'Old poster design');
      await clickInPlace('label[for=poster-design-new]', 'New poster design');
      await page.locator('.special-print-settings').evaluate(el => { el.open = true; });
      await clickInPlace('#poster-margin-next', 'Margin +');
      assert(await page.locator('.special-print-settings').evaluate(el => el.open), 'Special print panel stays open');
      await visit('/admin/#settings');
      await page.locator('#settings-form details').evaluateAll(els => els.forEach((el, i) => { el.open = i > 0; }));
      await page.waitForTimeout(350);
      const openBefore = await page.locator('#settings-form details').evaluateAll(els => els.map(el => el.open));
      await clickInPlace('#settings-form button[type=submit]', 'Save settings');
      assert.deepEqual(await page.locator('#settings-form details').evaluateAll(els => els.map(el => el.open)), openBefore);
      await page.locator('#rules-panel').evaluate(el => { el.open = true; });
      await page.evaluate(async () => {
        const { renderRules } = await import('/js/ui/rules-view.js');
        const rules = Array.from({ length: 4 }, (_, i) => ({ id: 'scroll-test-' + i, name: 'Test rule ' + i,
          enabled: true, condition: { always: true }, columnKeys: ['choref:I'], mode: 'append', value: 'Test note' }));
        renderRules(document.querySelector('#rules-host'), { rules }, () => {});
      });
      await clickInPlace('.rule-row[data-id=scroll-test-1] .rule-edit', 'Edit rule beside its row');
      assert.equal(await page.locator('#rule-form').evaluate(el => el.previousElementSibling.id), 'rule-form-title');
      assert.equal(await page.locator('#rule-form-title').evaluate(el => el.previousElementSibling.dataset.id), 'scroll-test-1');
      await visit('/donate/');
      await clickInPlace('#luach-tab-shul', 'Donation DAF tab');
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#luach-tab-card').evaluate(el => document.activeElement === el), true, 'Keyboard tab focus moves to Card');
      await clickInPlace('.luach-give-go', 'Open donation form');
      await page.frameLocator('.luach-frame').locator('#donor-name').fill('Test entry');
      await clickInPlace('#luach-tab-shul', 'Keep payment form while switching tabs');
      await page.keyboard.press('Home');
      assert.equal(await page.frameLocator('.luach-frame').locator('#donor-name').inputValue(), 'Test entry');
      await page.getByRole('button', { name: 'Close the donation form' }).click();
      assert(await page.locator('.luach-give-go').first().evaluate(el => document.activeElement === el));
      await clickInPlace('#luach-tab-shul', 'Show DAF copy');
      await clickInPlace('.luach-copy-btn', 'Copy EIN with blocked clipboard');
      await visit('/texts/');
      await clickInPlace('.tx-copy', 'Copy message with blocked clipboard');
      await page.evaluate(() => { document.execCommand = () => false; });
      await clickInPlace('.tx-copy', 'Manual copy fallback', { focused: false });
      assert.equal(await page.locator('.copy-fallback-text').evaluate(el => el.selectionEnd - el.selectionStart),
        (await page.locator('.copy-fallback-text').inputValue()).length, 'Manual copy text is selected');
      await visit('/admin/#traffic');
      await page.locator('#traffic-body[aria-busy=false]').waitFor();
      await clickInPlace('[data-traffic-preset="7"]', 'Statistics date range');
      await page.locator('#traffic-body[aria-busy=false]').waitFor();
      await clickInPlace('#traffic-refresh', 'Statistics refresh', { focused: false });
      await page.locator('#traffic-body[aria-busy=false]').waitFor();
      await page.locator('[data-traffic-preset="30"]').click();
      await page.evaluate(() => window.scrollTo(0, 240));
      const loadingY = await page.evaluate(() => scrollY);
      await page.locator('#traffic-body[aria-busy=false]').waitFor();
      await settle();
      assert.equal(await page.evaluate(() => scrollY), loadingY, 'Loading results respects a later manual scroll');
      await visit('/admin/#charts');
      await page.evaluate(() => window.scrollTo(0, 150));
      const currentY = await page.evaluate(() => scrollY);
      await page.locator('.admin-section-tabs [data-section=charts]').evaluate(el => el.click());
      assert.equal(await page.evaluate(() => scrollY), currentY, 'Clicking the active page stays put');
      // A later manual scroll belongs to the reader, with no delayed restoration pulling it back.
      await page.evaluate(() => window.scrollTo(0, 220));
      const manualY = await page.evaluate(() => scrollY);
      await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => scrollY), manualY);
      if (process.env.SCROLL_OUTPUT) {
        fs.mkdirSync(process.env.SCROLL_OUTPUT, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCROLL_OUTPUT, 'charts-' + width + '.png') });
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, checks, errors }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
