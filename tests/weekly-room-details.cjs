// Run after build-offline.py. Requires Playwright on NODE_PATH.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const mobile of [true, false]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-11-08T05:00:00Z') });
      await page.goto(origin + '/week/');
      await page.locator('.weekly-reader').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const reveal = async time => {
        await time.evaluate(el => { el.closest('.reader-agenda-day').open = true; });
        await page.waitForTimeout(400);
      };
      const rooms = [
        ['button.reader-time:has(.reader-digits u)', 'Downstairs', 'בית מדרש למטה'],
        ['button.reader-time:has(.reader-room-mark:text-is("*"))', 'Ezras Nashim', 'עזרת נשים'],
        ['button.reader-time:has(.reader-room-mark:text-is("**"))', 'Simcha hall', 'אולם השמחות'],
        ['button.reader-time:not(:has(u)):has(.reader-room-mark:empty)', 'Main Bais Medrash', 'בית מדרש'],
      ];
      const dialog = page.locator('.reader-room-dialog');
      for (const [selector, name, hebrew] of rooms) {
        const time = page.locator(selector).first();
        assert(await time.count(), name + ' appears in the real weekly schedule');
        await reveal(time);
        const clock = await time.locator('.reader-digits').innerText();
        if (mobile) await time.tap(); else await time.click();
        assert(await dialog.isVisible(), name + ' room dialog opens');
        assert.equal(await dialog.locator('h2').textContent(), name);
        assert.equal(await dialog.locator('.reader-room-hebrew').textContent(), hebrew);
        assert.equal(await dialog.locator('.reader-room-clock').textContent(), clock.replace(/\*/g, ''));
        const box = await dialog.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= (mobile ? 375 : 1440), 'Room details fit the viewport');
        if (mobile && name === 'Ezras Nashim' && process.env.WEEKLY_ROOM_SCREENSHOT) await page.screenshot({ path: process.env.WEEKLY_ROOM_SCREENSHOT });
        await dialog.locator('button').click();
        assert(await dialog.isHidden(), 'Close button dismisses room details');
        assert(await time.evaluate(el => el === document.activeElement), 'Focus returns to the selected time');
      }
      const first = page.locator('button.reader-time').first();
      await reveal(first);
      await first.focus();
      await page.keyboard.press('Enter');
      assert(await dialog.isVisible(), 'Keyboard opens room details');
      await page.keyboard.press('Escape');
      assert(await dialog.isHidden(), 'Escape closes room details');
      await first.press('Space');
      assert(await dialog.isVisible(), 'Space opens room details');
      await page.clock.fastForward(61000);
      assert(await dialog.isVisible(), 'Minute refresh keeps room details open');
      await page.mouse.click(2, 2);
      assert(await dialog.isHidden(), 'Backdrop closes room details');
      await first.click();
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert(await dialog.isHidden(), 'Native printing closes room details');
      assert(pdf.length > 1000, 'Weekly schedule still prints');
      await page.locator('#reader-next').click();
      await reveal(page.locator('button.reader-time').first());
      await page.locator('button.reader-time').first().click();
      assert(await page.locator('.reader-room-dialog').isVisible(), 'Room details work after changing weeks');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.reader-sub button.reader-time, .reader-time:has(.reader-reckoning)[data-reader-room]').count(), 0,
        'Plag and latest Shema do not acquire minyan rooms');
      assert(await page.locator('.reader-sub .reader-time, .reader-time:has(.reader-reckoning)').count() > 0,
        'Non-minyan times remain on the schedule');
      for (const width of [320, 375, 393, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      }
      assert.deepEqual(errors, [], 'No browser errors');
      console.log('Verified room details on ' + (mobile ? 'phone' : 'desktop') + ', keyboard, dismissals, print, navigation, and non-minyan times.');
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
