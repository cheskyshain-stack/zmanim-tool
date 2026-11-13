const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { chromium } = require('playwright');
const runtime = path.resolve(__dirname, '../worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
const root = path.resolve(__dirname, '../dist');

test('the private register uses the existing Seats login and saves to the shared Worker', async t => {
  let endpoint, origin;
  const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.woff2':'font/woff2' };
  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url, origin).pathname;
    if (route === '/data/seats-sync.json') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ endpoint }));
    }
    const file = path.resolve(root, '.' + route + (route.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    try {
      const contents = await fs.readFile(file);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(contents);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  origin = 'http://127.0.0.1:' + server.address().port;
  const bundle = await build({ entryPoints: [path.resolve(__dirname, '../worker/seats/worker.js')], bundle: true, write: false, format: 'esm' });
  const privatePin = '13792478';
  const worker = new Miniflare(convertV4MiniflareOptions({
    name: 'yahrzeits-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
    bindings: { ALLOWED_ORIGIN: origin, SEATS_PRIVATE_PIN: privatePin }, durableObjects: { SEATS_WORKSPACE: { className: 'SeatsWorkspace', useSQLite: true } },
  }));
  t.after(() => worker.dispose());
  endpoint = (await worker.ready).origin;
  const api = (route, options = {}) => fetch(endpoint + '/api/' + route, {
    ...options, headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
  });
  assert.equal((await api('yahrzeits')).status, 401);
  const legacyLogin = await api('session', { method: 'POST', body: JSON.stringify({ name: 'Synthetic legacy organizer', pin: '4444' }) });
  assert.equal(legacyLogin.status, 200);
  const legacyToken = (await legacyLogin.json()).token;
  const legacyHeaders = { Authorization: 'Bearer ' + legacyToken };
  assert.equal((await api('plans', { headers: legacyHeaders })).status, 200);
  assert.equal((await api('yahrzeits', { headers: legacyHeaders })).status, 403);
  assert.equal((await api('yahrzeits/example-id', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await api('yahrzeits/example-id', { method: 'DELETE', body: '{}' })).status, 401);
  assert.equal((await api('yahrzeits', { headers: { Origin: 'https://example.org' } })).status, 403);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const errors = [], signIns = [];
  const setup = async width => {
    const page = await browser.newPage({ viewport: { width, height: 740 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) errors.push(message.text()); });
    page.on('request', request => { if (request.url().endsWith('/api/session') && request.method() === 'POST') signIns.push(1); });
    await page.clock.setFixedTime(new Date('2026-11-13T17:00:00Z'));
    return page;
  };
  const signIn = async (page, button) => {
    await page.getByLabel('Your name').fill('Synthetic organizer');
    await page.getByLabel('PIN', { exact: true }).fill(privatePin);
    await page.getByRole('button', { name: button, exact: true }).click();
  };
  const checkWidth = page => page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return document.documentElement.scrollWidth === innerWidth && (!dialog || dialog.scrollWidth <= dialog.clientWidth);
  });

  const first = await setup(375);
  await first.goto(origin + '/seats/');
  await signIn(first, 'Open Seats');
  await first.getByRole('link', { name: 'Yahrzeit Calendar' }).click();
  await first.getByRole('button', { name: '+ Add member' }).click();
  assert.equal(signIns.length, 1, 'Seats session should transfer without another PIN');
  await first.getByLabel('Congregation member').fill('Synthetic Member');
  const entry = (page, kind) => page.locator('[data-kind=' + kind + ']');
  const fillDate = async (row, month, day) => {
    await row.getByLabel('Hebrew month').selectOption(String(month));
    await row.getByLabel('Hebrew day').selectOption(String(day));
  };
  await fillDate(entry(first, 'father'), 8, 29);
  await fillDate(entry(first, 'mother'), 8, 29);
  await first.getByRole('button', { name: '+ Custom relationship' }).click();
  const custom = entry(first, 'custom');
  await custom.getByRole('textbox', { name: 'Relationship', exact: true }).fill('Grandfather');
  await custom.getByLabel('Name of the deceased (optional)').fill('ר׳ דוד <test>');
  await fillDate(custom, 8, 29);
  assert.ok(await checkWidth(first), 'form should fit 375 pixels');
  await first.getByRole('button', { name: 'Save yahrzeits' }).click();
  await first.getByText('Saved to the website.', { exact: false }).waitFor();
  await first.getByRole('button', { name: /3 yahrzeits/ }).click();
  await first.getByText('Grandfather: ר׳ דוד <test>').waitFor();
  await first.getByRole('button', { name: 'Close' }).click();
  assert.ok(await checkWidth(first), 'calendar should fit 375 pixels');

  const second = await setup(393);
  await second.goto(origin + '/yahrzeits/');
  await signIn(second, 'Open Yahrzeit Calendar');
  await second.getByRole('button', { name: 'Members', exact: true }).click();
  await second.getByRole('button', { name: 'Edit Synthetic Member' }).click();
  assert.equal(await entry(second, 'custom').getByLabel('Name of the deceased (optional)').inputValue(), 'ר׳ דוד <test>');
  assert.ok(await checkWidth(second), 'form should fit 393 pixels');
  assert.equal(signIns.length, 2);
  await first.getByRole('button', { name: 'Members', exact: true }).click();
  await first.getByRole('button', { name: 'Edit Synthetic Member' }).click();
  await second.getByLabel('Congregation member').fill('Renamed Member');
  await second.getByRole('button', { name: 'Save yahrzeits' }).click();
  await second.getByText('Saved to the website.', { exact: false }).waitFor();
  await first.getByLabel('Congregation member').fill('Older copy');
  const conflict = first.waitForResponse(response => response.url().includes('/api/yahrzeits/') && response.status() === 409);
  await first.getByRole('button', { name: 'Save yahrzeits' }).click();
  await conflict;
  await first.getByText('Someone else changed this record.', { exact: false }).waitFor();
  await first.reload();
  await first.getByRole('button', { name: 'Members', exact: true }).click();
  await first.getByRole('button', { name: 'Edit Renamed Member' }).click();
  first.once('dialog', confirm => confirm.accept());
  await first.getByRole('button', { name: 'Delete member' }).click();
  await first.getByText('Member removed.').waitFor();
  await first.getByRole('button', { name: 'Members', exact: true }).click();
  await first.getByText('No members have been added yet.').waitFor();
  assert.deepEqual(errors, []);
});
