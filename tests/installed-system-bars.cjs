// Checks page behavior with real CSS safe-area overrides. Desktop emulation does
// not draw Android's native buttons; the installed display mode is a fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SYSTEM_BARS_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    for (const fixture of [
      { name: 'android-browser', android: true, installed: false, bottom: 48 },
      { name: 'desktop-app', installed: true, bottom: 48 },
      { name: 'iphone', iphone: true, installed: true, bottom: 34 },
      { name: 'no-inset', android: true, installed: true, bottom: 0 },
      { name: 'android-app', android: true, installed: true, bottom: 48, top: 24 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
        isMobile: Boolean(fixture.android || fixture.iphone), reducedMotion: 'reduce',
        userAgent: fixture.android ? 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36' : fixture.iphone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' : undefined,
      });
      await context.addInitScript(({ installed }) => {
        localStorage.setItem('zmanim-nocount', '1');
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => {
          const result = original(query);
          if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: Boolean(installed) });
          return result;
        };
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedDisplayReport = text; } } });
      }, fixture);
      if (!process.env.SYSTEM_BARS_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-18T03:45:00Z'));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: fixture.bottom, top: fixture.top || 0 } });
      await page.goto(origin + '/?count=off');
      await page.locator('.luach-menu').waitFor();
      if (await page.locator('.luach-announce-close').isVisible().catch(() => false)) await page.locator('.luach-announce-close').click();
      const enabled = fixture.android && fixture.installed;
      const theme = page.locator('meta[name="theme-color"]');
      await assert.doesNotReject(() => page.waitForFunction(expected => document.querySelector('meta[name="theme-color"]').content === expected, enabled && fixture.bottom > 0 ? '#142b46' : '#faf7f0'));
      assert.equal(await page.locator('.luach-system-area').count(), enabled ? 1 : 0, fixture.name);
      assert.equal((await page.locator('meta[name="viewport"]').getAttribute('content')).includes('viewport-fit=cover'), Boolean(enabled));
      const check = page.locator('.luach-display-check');
      assert.equal(await check.count(), fixture.android ? 1 : 0, 'Temporary display check is Android only');
      if (fixture.android) {
        await check.locator('summary').click();
        await check.getByRole('button', { name: 'Copy details', exact: true }).click();
        await page.waitForFunction(() => window.copiedDisplayReport);
        const report = JSON.parse(await page.evaluate(() => window.copiedDisplayReport));
        assert.equal(report.check, 'app-display-2026-10-18');
        assert.equal(report.modes.standalone, fixture.installed);
        assert.equal(report.safeArea.bottom, fixture.bottom + 'px');
        assert.equal(report.theme, enabled && fixture.bottom > 0 ? '#142b46' : '#faf7f0');
        assert.equal(report.systemArea?.height ?? null, enabled ? fixture.bottom : null);
        assert.equal(report.browser, await page.evaluate(() => navigator.userAgent));
        assert.deepEqual(Object.keys(report).sort(), ['check', 'browser', 'platform', 'modes', 'viewport', 'theme', 'safeArea', 'systemArea', 'pageSize', 'screenSize', 'visualViewport'].sort());
        await check.locator('summary').click();
      }
      if (fixture.name === 'android-app') {
        const geometry = await page.locator('.luach-system-area').evaluate(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { height: rect.height, bottom: rect.bottom, width: rect.width, background: style.backgroundColor, pointerEvents: style.pointerEvents };
        });
        assert.deepEqual(geometry, { height: 48, bottom: 844, width: 390, background: 'rgb(20, 43, 70)', pointerEvents: 'none' });
        assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).paddingBottom), '48px');
        const header = await page.locator('#main .luach-bar').boundingBox();
        assert.equal(header.height, 88, 'Top cutout adds space to the header');
        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme });
          assert.equal(await theme.getAttribute('content'), '#142b46');
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const footer = await page.locator('.luach-site-footer').boundingBox();
        assert(footer.y + footer.height <= 844 - 48, 'Footer can scroll clear of system buttons');
        if (process.env.SYSTEM_BARS_ARTIFACTS) {
          fs.mkdirSync(process.env.SYSTEM_BARS_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SYSTEM_BARS_ARTIFACTS, 'android-app.png') });
        }
        await page.locator('.luach-menu a[href="/donate/"]').click();
        await page.getByRole('tab', { name: 'Card · ACH', exact: true }).waitFor();
        assert.equal(await page.locator('.luach-system-area').count(), 1, 'Page changes preserve one system background');
        assert.equal(await theme.getAttribute('content'), '#142b46');
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0, top: 0 } });
        await page.waitForFunction(() => document.querySelector('meta[name="theme-color"]').content === '#faf7f0');
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 24, top: 0 } });
        await page.waitForFunction(() => document.querySelector('meta[name="theme-color"]').content === '#142b46');
        await page.setViewportSize({ width: 844, height: 390 });
        const rotated = await page.locator('.luach-system-area').boundingBox();
        assert.equal(rotated.height, 24);
        assert.equal(rotated.y + rotated.height, 390);
        assert.equal(rotated.width, 844);
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.luach-system-area').isVisible(), false, 'No system background on paper');
        assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).paddingBottom), '0px');
        await page.emulateMedia({ media: 'screen' });
        await page.waitForFunction(() => document.querySelector('meta[name="theme-color"]').content === '#142b46');
      }
      console.log(fixture.name + ' passed');
      await context.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
