// Build first with python build-offline.py, then: node tests/hoshana-rabba-page.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ timezoneId: 'America/New_York' });
    await context.route('**/*', (r) => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    for (const [date, visible] of [
      ['2026-09-26T12:00:00-04:00', false],
      ['2026-09-27T12:00:00-04:00', true],
      ['2026-10-01T20:00:00-04:00', true],
      ['2026-10-02T08:00:00-04:00', true],
      ['2026-10-03T12:00:00-04:00', false],
    ]) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.install({ time: new Date(date) });
      await page.goto(origin + '/texts/');
      await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
      const message = page.getByRole('textbox', { name: 'Hoshana Rabba message', exact: true });
      assert.equal(await message.count(), visible ? 1 : 0, date);
      if (visible) {
        assert.equal(await message.inputValue(), [
          'Hoshana Rabba',
          'MISHNA TORAH in the Ezras Nashim at 8:00 PM, followed by Maariv',
          'Shacharis: 6:18d [NETZ 6:54], 7:30m, 8:20sh',
        ].join('\n'));
      }
      assert.deepEqual(errors, [], date);
      console.log(date + ': ' + (visible ? 'correct message visible' : 'message outside window'));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
