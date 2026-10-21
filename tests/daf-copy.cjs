const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../dist');
const live = process.env.LIVE_ORIGIN;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  if (!live) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = live || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'chrome', headless: true });
  const results = [], errors = [];
  try {
    for (const [width, height] of [[320, 568], [375, 812], [412, 915], [1440, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: width < 760 });
      await context.addInitScript(() => {
        try { localStorage.setItem('zmanim-nocount', '1'); } catch {}
      });
      // Check our embed lifecycle with an inert merchant form, without sending any payment data.
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/')) return route.continue();
        if (url.startsWith('https://secure.cardknox.com/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><label>Name <input id="donor-name"></label>' });
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/donate/?count=off&donation_check=' + Date.now());
      const card = page.getByRole('tab', { name: 'Card · ACH', exact: true });
      const daf = page.getByRole('tab', { name: 'DAF', exact: true });
      await card.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const copy = page.locator('.luach-copy-btn');
      const measure = () => page.evaluate(() => ({
        paymentHeight: document.querySelector('.luach-payments').getBoundingClientRect().height,
        footerTop: document.querySelector('.luach-site-footer').getBoundingClientRect().top + scrollY,
        footerGap: document.documentElement.scrollHeight - document.querySelector('.luach-site-footer').getBoundingClientRect().bottom - scrollY,
        documentHeight: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(await card.getAttribute('aria-selected'), 'true');
      assert.equal(await page.getByRole('tabpanel').count(), 1);
      assert.equal(await page.getByRole('tab').count(), 2);
      assert.equal(await page.locator('.luach-give-account').count(), 5);
      assert(await copy.isHidden());
      assert.equal(await page.locator('.luach-site-footer button').count(), 0);
      assert.equal(await page.locator('.luach-payment-icon.is-zelle').count(), 0);
      assert.match(await page.locator('.luach-give-legal').innerText(), /New Jersey 501\(c\)\(3\) nonprofit · EIN: 26-4527675/);
      const cardLayout = await measure();
      assert(!cardLayout.overflow);
      assert(Math.abs(cardLayout.footerGap - 24) < 2);
      if (process.env.ARTIFACT_DIR && width === 375) await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, 'donation-live-design-card.png'), fullPage: true });
      await daf.click();
      assert.equal(await page.getByRole('tabpanel').count(), 1);
      assert.equal(await daf.getAttribute('aria-selected'), 'true');
      assert(await copy.isVisible());
      assert.equal(await copy.innerText(), 'Copy EIN');
      assert((await copy.boundingBox()).height >= 44);
      const providers = page.locator('.luach-daf-provider');
      assert.equal(await providers.count(), 5);
      assert.deepEqual(await providers.locator('img').evaluateAll(images => images.map(img => img.alt)),
        ['The Donors Fund', 'Pledger', 'OJC Fund', 'Matbia', 'iMaaser']);
      assert.equal(await page.getByRole('link', { name: 'iMaaser', exact: true }).getAttribute('href'), 'https://app.imaaser.org/donor/login');
      assert.equal(await providers.locator('svg[aria-hidden="true"]').count(), 5);
      await page.waitForFunction(() => [...document.querySelectorAll('.luach-daf-provider img')].every(img => img.complete && img.naturalWidth > 0));
      for (const link of await providers.all()) {
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.equal(await link.getAttribute('data-tax-id'), '26-4527675');
      }
      const rows = await providers.evaluateAll(links => links.map(link => {
        const row = link.getBoundingClientRect(), logo = link.querySelector('img').getBoundingClientRect();
        const arrow = link.querySelector('svg').getBoundingClientRect();
        return { left: row.left, top: row.top, width: row.width, height: row.height,
          contentsFit: logo.left >= row.left && logo.right <= arrow.left - 16 && arrow.right <= row.right };
      }));
      assert(rows.every(row => row.height >= 72 && Math.abs(row.width - rows[0].width) < 1 && row.contentsFit));
      assert(rows.every((row, index) => !index || row.top >= rows[index - 1].top + rows[index - 1].height));
      const dafLayout = await measure();
      assert(!dafLayout.overflow);
      assert(dafLayout.paymentHeight > cardLayout.paymentHeight, 'The five-row provider list has room for every choice');
      assert(dafLayout.footerTop >= cardLayout.footerTop, 'The footer follows the complete provider list');
      assert(Math.abs(dafLayout.footerGap - 24) < 2);
      if (process.env.ARTIFACT_DIR && width === 375) await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, 'donation-live-design-daf.png'), fullPage: true });
      await page.evaluate(() => {
        window.copyWrites = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copyWrites.push(text) } });
      });
      await page.getByRole('link', { name: 'iMaaser', exact: true }).evaluate(link => link.addEventListener('click', event => event.preventDefault(), { once: true }));
      await page.getByRole('link', { name: 'iMaaser', exact: true }).click();
      await page.waitForFunction(() => window.copyWrites.length === 1);
      await copy.click();
      await page.waitForFunction(() => document.querySelector('.luach-copy-btn').textContent === 'Copied');
      await copy.click();
      await page.evaluate(async () => {
        for (const link of document.querySelectorAll('.luach-daf-provider')) {
          link.addEventListener('click', event => event.preventDefault(), { once: true });
          link.click();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });
      assert.deepEqual(await page.evaluate(() => window.copyWrites), ['26-4527675']);
      await daf.focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await card.getAttribute('aria-selected'), 'true');
      assert(await copy.isHidden());
      await page.keyboard.press('End');
      assert.equal(await daf.getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Home');
      assert.equal(await card.getAttribute('aria-selected'), 'true');
      assert.equal(await card.evaluate(tab => document.activeElement === tab), true);

      if (width === 375) {
        const accounts = page.locator('.luach-give-account');
        for (let index = 0; index < 5; index++) {
          const account = accounts.nth(index), go = account.locator('.luach-give-go');
          const href = await go.getAttribute('href');
          const name = await account.locator('.luach-account-title').innerText();
          await go.click();
          assert.equal(await page.locator('.luach-frame').count(), 1);
          assert.equal(await account.locator('iframe').getAttribute('src'), href);
          assert.equal(await account.locator('iframe').getAttribute('title'), name + ' donation form');
          assert.equal(await account.locator('iframe').getAttribute('allow'), 'payment');
          assert.match(await account.locator('.luach-frame-where').innerText(), /secure\.cardknox\.com/);
          assert.equal(await account.locator('.luach-frame-help a').getAttribute('href'), href);
          if (name === 'Neileich') assert.equal(await account.locator('.luach-frame-website').getAttribute('href'), 'https://www.neileich.org/');
          const frame = page.frameLocator('.luach-frame');
          await frame.locator('#donor-name').fill('Preserved entry');
          await page.evaluate(() => window.savedDonationFrame = document.querySelector('.luach-frame'));
          await daf.click();
          assert.equal(await copy.isVisible(), true);
          assert.equal(await page.locator('.luach-frame').isHidden(), true);
          assert.equal((await measure()).paymentHeight, dafLayout.paymentHeight);
          await page.setViewportSize({ width: 812, height: 375 });
          await card.click();
          assert.equal(await frame.locator('#donor-name').inputValue(), 'Preserved entry');
          assert(await page.evaluate(() => window.savedDonationFrame === document.querySelector('.luach-frame')));
          await page.setViewportSize({ width, height });
          assert.equal(await frame.locator('#donor-name').inputValue(), 'Preserved entry');
          assert(!(await measure()).overflow);
          await account.getByRole('button', { name: 'Close the donation form' }).click();
          assert.equal(await page.locator('.luach-frame').count(), 0);
          assert.equal(await go.getAttribute('aria-expanded'), 'false');
          assert.equal(await go.evaluate(link => document.activeElement === link), true);
        }
        // Opening a different fund removes the previous form instead of keeping two live.
        await accounts.nth(0).locator('.luach-give-go').click();
        await accounts.nth(1).locator('.luach-give-go').click();
        assert.equal(await page.locator('.luach-frame').count(), 1);
        assert.equal(await accounts.nth(0).locator('.luach-give-go').getAttribute('aria-expanded'), 'false');
        await accounts.nth(1).getByRole('button', { name: 'Close the donation form' }).click();
      }

      await page.reload();
      await card.waitFor();
      assert.equal(await card.getAttribute('aria-selected'), 'true');
      assert(await copy.isHidden());
      await daf.click();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('blocked'); } } });
        document.execCommand = () => false;
      });
      await copy.click();
      await page.waitForFunction(() => document.querySelector('.luach-copy-btn').textContent === 'Try again');
      await page.evaluate(() => {
        window.retryWrites = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.retryWrites.push(text) } });
      });
      await copy.click();
      await page.waitForFunction(() => document.querySelector('.luach-copy-btn').textContent === 'Copied');
      assert.deepEqual(await page.evaluate(() => window.retryWrites), ['26-4527675']);
      results.push({ width, height, cardLayout, dafLayout, clipboard: 'once, retry verified', keyboard: 'passed', forms: width === 375 ? 'all five, rotation and method switching preserve entry' : 'not repeated' });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, results, errors }));
  } finally {
    await browser.close();
    if (!live) server.close();
  }
})().catch(error => { console.error(error); if (!live) server.close(); process.exitCode = 1; });
