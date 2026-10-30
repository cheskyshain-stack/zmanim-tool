const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = process.env.CANDLE_LOOKUP_ROOT || path.resolve(__dirname, '../dist');
const output = process.env.CANDLE_LOOKUP_OUTPUT || '/tmp/candle-lighting-lookup';
const locations = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/candle-zip-locations.json')));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + '/')) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.CANDLE_LOOKUP_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  try {
    for (const width of (process.env.CANDLE_LOOKUP_WIDTHS || '320,393,760,1440').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 760, hasTouch: width < 760, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('zmanim-nocount', '1'));
      let mode = 'success', pending = null;
      const requests = [];
      await context.route('https://www.hebcal.com/zmanim?**', async route => {
        requests.push(route.request().url());
        if (process.env.CANDLE_LOOKUP_REAL_API) return route.continue();
        const zip = new URL(route.request().url()).searchParams.get('zip');
        if (mode === 'pending') await new Promise(resolve => { pending = resolve; });
        if (mode === 'network') return route.abort();
        if (mode === 'service') return route.fulfill({ status: 503, body: '{}' });
        if (!locations[zip]) return route.fulfill({ status: 404, body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ location: locations[zip], times: { sunset: 'ignore remote times' } }) });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-30T11:17:00Z') });
      await page.goto(origin + '/?count=off&candle-lookup-check=' + Date.now());
      const trigger = () => page.locator('.luach-next .is-candles');
      await trigger().waitFor();
      if (await page.locator('.luach-announce-close').isVisible()) await page.locator('.luach-announce-close').click();
      await page.evaluate(() => document.fonts.ready);
      const before = await page.locator('.luach-next').innerText();
      assert(!before.includes('ZIP'), 'The homepage has no added hint');
      assert.equal(requests.length, 0, 'No location requests before the lookup is submitted');
      const shulTime = await trigger().locator('.luach-next-time').innerText();
      const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      const open = async () => { if (width < 760) await trigger().tap(); else await trigger().click(); await page.locator('.luach-candle-dialog[open]').waitFor(); };
      await open();
      const dialog = page.locator('.luach-candle-dialog'), input = dialog.locator('input'), status = dialog.locator('[role=status]');
      assert(await input.evaluate(el => el === document.activeElement));
      assert.match(await dialog.locator('.luach-candle-date').innerText(), /Friday, October 30, 2026/);
      assert.equal(requests.length, 0, 'Opening alone does not request a ZIP');
      if (width < 760) {
        // Model Android's keyboard: only visualViewport shrinks and pans, while
        // the layout viewport stays full height. Desktop Chromium has no OS keyboard.
        await page.evaluate(() => {
          const view = visualViewport, fields = ['width', 'height', 'offsetTop', 'offsetLeft'];
          const originals = fields.map(key => [key, Object.getOwnPropertyDescriptor(view, key)]);
          const geometry = { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0 };
          for (const key of fields) Object.defineProperty(view, key, { configurable: true, get: () => geometry[key] });
          window.candleKeyboardViewport = {
            set(values) { Object.assign(geometry, values); view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll')); },
            restore() { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(view, key, descriptor); else delete view[key]; } view.dispatchEvent(new Event('resize')); },
          };
        });
        for (const geometry of [
          { width, height: 450, offsetTop: 0, offsetLeft: 0 },
          { width, height: 360, offsetTop: 72, offsetLeft: 0 },
          { width, height: 250, offsetTop: 0, offsetLeft: 0 },
          { width, height: 180, offsetTop: 40, offsetLeft: 0 },
          { width: width - 30, height: 340, offsetTop: 40, offsetLeft: 15 },
        ]) {
          await page.evaluate(geometry => window.candleKeyboardViewport.set(geometry), geometry);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const measured = await dialog.evaluate(el => {
            const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            return { layoutHeight: innerHeight, dialog: box(el), fields: box(el.querySelector('.luach-candle-fields')), scrollTop: el.scrollTop };
          });
          assert.equal(measured.layoutHeight, 900, 'Keyboard simulation leaves the layout viewport full height');
          for (const [name, box] of Object.entries({ dialog: measured.dialog, fields: measured.fields })) {
            assert(box.top >= geometry.offsetTop && box.bottom <= geometry.offsetTop + geometry.height,
              name + ' stays above the keyboard: ' + JSON.stringify({ geometry, measured }));
            assert(box.left >= geometry.offsetLeft && box.right <= geometry.offsetLeft + geometry.width);
          }
          assert(measured.fields.top >= measured.dialog.top && measured.fields.bottom <= measured.dialog.bottom, 'Both ZIP input and Show time are visible inside the scrolling dialog');
          if (geometry.height === 450) await page.screenshot({ path: path.join(output, 'keyboard-area-' + width + '.png'), clip: { x: 0, y: 0, width, height: geometry.height } });
          checks.push({ width, keyboardGeometry: geometry, measured });
        }
        await page.evaluate(() => window.candleKeyboardViewport.restore());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      const submit = async zip => { await input.fill(zip); await dialog.getByRole('button', { name: 'Show time', exact: true }).click(); };
      await submit('1234');
      await status.filter({ hasText: 'five-digit' }).waitFor();
      assert.equal(requests.length, 0);
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      await submit('90210');
      await dialog.locator('.luach-candle-result:not([hidden])').waitFor();
      assert.match(await dialog.locator('.luach-candle-location').innerText(), /Beverly Hills/);
      assert.equal(await dialog.locator('.luach-candle-clock').innerText(), '5:44 PM');
      assert.equal(await dialog.locator('.luach-candle-zone').innerText(), 'Pacific Daylight Time');
      assert.equal(await dialog.locator('.luach-candle-countdown').innerText(), 'in 13 hours 27 minutes');
      assert(!((await dialog.innerText()).includes('minutes before sunset')), 'The removed explanation stays off the popup');
      assert(!(await input.evaluate(el => el === document.activeElement)), 'Valid submission dismisses the input keyboard');
      assert.equal(await trigger().locator('.luach-next-time').innerText(), shulTime);
      assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage })), saved);
      const bounds = await dialog.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900);
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), 'The dialog fits without sideways scrolling');
      await page.screenshot({ path: path.join(output, 'result-' + width + '.png'), fullPage: true });
      await page.clock.fastForward(61000);
      assert.notEqual(await dialog.locator('.luach-candle-countdown').innerText(), 'in 13 hours 27 minutes', 'The popup countdown refreshes while it stays open');
      assert(await dialog.isVisible(), 'Minute refresh preserves the dialog');
      assert.equal(await input.inputValue(), '90210');
      assert.equal(await trigger().locator('.luach-next-time').innerText(), shulTime);
      await dialog.getByRole('button', { name: 'Close candle-lighting lookup' }).click();
      assert(await trigger().evaluate(el => el === document.activeElement), 'Close returns focus to candle lighting');
      await trigger().press('Enter');
      await dialog.locator('input').waitFor();
      await page.keyboard.press('Escape');
      assert(await dialog.isHidden());
      await trigger().press('Space');
      assert(await dialog.isVisible());
      await page.mouse.click(1, 1);
      assert(await dialog.isHidden(), 'Backdrop closes the lookup');
      await open();
      await submit('00000');
      await status.filter({ hasText: 'not found' }).waitFor();
      assert(await dialog.locator('.luach-candle-result').isHidden(), 'Invalid ZIP removes any old result');
      if (!process.env.CANDLE_LOOKUP_REAL_API) {
        mode = 'network'; await submit('10001');
        await status.filter({ hasText: 'internet connection' }).waitFor();
        mode = 'service'; await submit('10001');
        await status.filter({ hasText: 'unavailable' }).waitFor();
        mode = 'pending'; await submit('10001');
        await page.waitForFunction(() => document.querySelector('.luach-candle-form').getAttribute('aria-busy') === 'true');
        await page.waitForTimeout(50);
        await input.fill('08701');
        mode = 'success'; pending?.();
        await dialog.getByRole('button', { name: 'Show time', exact: true }).click();
        await dialog.locator('.luach-candle-location').filter({ hasText: 'Lakewood' }).waitFor();
        assert.equal(await dialog.locator('.luach-candle-clock').innerText(), '5:38 PM');
        assert.match(await dialog.locator('.luach-candle-zone').innerText(), /Eastern Daylight Time/);
        mode = 'pending'; await submit('00901');
        await page.waitForTimeout(50);
        await page.clock.fastForward(12001);
        await status.filter({ hasText: 'timed out' }).waitFor();
        mode = 'success'; pending?.();
      } else {
        await submit('08701');
        await dialog.locator('.luach-candle-location').filter({ hasText: 'Lakewood' }).waitFor();
        assert.equal(await dialog.locator('.luach-candle-clock').innerText(), '5:38 PM');
      }
      await input.fill('08701');
      await input.press('Enter');
      await dialog.locator('.luach-candle-result:not([hidden])').waitFor();
      assert(!(await input.evaluate(el => el === document.activeElement)), 'The keyboard Go action also blurs the ZIP input');
      await page.clock.setSystemTime(new Date('2026-10-30T21:38:00Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await dialog.locator('.luach-candle-countdown').innerText(), 'now');
      await page.clock.setSystemTime(new Date('2026-10-30T21:44:00Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await dialog.locator('.luach-candle-countdown').innerText(), 'Candle lighting has passed');
      if (width === 1440) {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert(await dialog.isHidden(), 'Printing dismisses the popup');
        const text = execFileSync('pdftotext', ['-raw', '-', '-'], { input: pdf, encoding: 'utf8' });
        assert(!text.includes('ZIP locations') && !text.includes('Show time'), 'Lookup controls are excluded from paper');
        fs.writeFileSync(path.join(output, 'home.pdf'), pdf);
        await open();
      }
      await dialog.getByRole('button', { name: 'Close candle-lighting lookup' }).click();
      await page.clock.fastForward(61000);
      await open();
      assert(await dialog.isVisible(), 'Lookup works after the home card is replaced');
      await page.evaluate(() => document.querySelector('.luach-menu a[href="/week/"]').click());
      await page.locator('#reader-next').waitFor();
      assert.equal(await page.locator('.luach-candle-dialog').count(), 0, 'Navigation disposes the popup');
      await page.goBack();
      await trigger().waitFor(); await open();
      assert.equal(await page.locator('.luach-candle-dialog[open]').count(), 1, 'Returning home has one working lookup');
      checks.push({ width, city: 'Beverly Hills', time: '5:44 PM', homeTime: shulTime, requests: requests.length });
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
