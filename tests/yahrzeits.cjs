const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { chromium } = require('playwright');
const XLSX = require('../vendor/xlsx-0.20.3.min.js');
const runtime = path.resolve(__dirname, '../worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
const root = path.resolve(__dirname, '../dist');

test('the private register shares the PIN with Seats and uses a separate login', async t => {
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
  assert.equal((await api('yahrzeits/import', { method: 'POST', body: '{}' })).status, 401);
  const legacyLogin = await api('session', { method: 'POST', body: JSON.stringify({ name: 'Synthetic legacy organizer', pin: '4444' }) });
  assert.equal(legacyLogin.status, 200);
  const legacyToken = (await legacyLogin.json()).token;
  const legacyHeaders = { Authorization: 'Bearer ' + legacyToken };
  assert.equal((await api('plans', { headers: legacyHeaders })).status, 200);
  assert.equal((await api('yahrzeits', { headers: legacyHeaders })).status, 401);
  const wrongPin = await api('session', { method: 'POST', body: JSON.stringify({ name: 'Synthetic organizer', pin: '4444', scope: 'yahrzeits' }) });
  assert.equal(wrongPin.status, 401);
  const signInFor = async scope => {
    const login = await api('session', { method: 'POST', body: JSON.stringify({ name: 'Synthetic organizer', pin: privatePin, scope }) });
    assert.equal(login.status, 200);
    return { Authorization: 'Bearer ' + (await login.json()).token };
  };
  const seatsHeaders = await signInFor('seats'), calendarHeaders = await signInFor('yahrzeits');
  assert.equal((await api('plans', { headers: seatsHeaders })).status, 200);
  assert.equal((await api('yahrzeits', { headers: seatsHeaders })).status, 401);
  assert.equal((await api('yahrzeits', { headers: calendarHeaders })).status, 200);
  assert.equal((await api('plans', { headers: calendarHeaders })).status, 401);
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
  const signIn = async (page, button, name = 'Synthetic organizer') => {
    await page.getByLabel('Your name').fill(name);
    await page.getByLabel('PIN', { exact: true }).fill(privatePin);
    await page.getByRole('button', { name: button, exact: true }).click();
  };
  const checkWidth = page => page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return document.documentElement.scrollWidth === innerWidth && (!dialog || dialog.scrollWidth <= dialog.clientWidth);
  });

  const chooseCalendarOption = async (page, name) => {
    await page.getByRole('button', { name: 'Calendar options', exact: true }).click();
    await page.getByRole('dialog', { name: 'Calendar options' }).getByRole('button', { name, exact: true }).click();
  };
  const calendarBounds = page => page.evaluate(() => {
    const grid = document.querySelector('.cal-grid').getBoundingClientRect();
    const header = document.querySelector('.cal-editor-header').getBoundingClientRect();
    const actions = [...document.querySelectorAll('.cal-reader-actions > *')].map(button => button.getBoundingClientRect());
    const rows = [...document.querySelectorAll('.cal-grid tbody tr')].map(row => row.getBoundingClientRect().height);
    return { fillsWidth: grid.left <= 2 && grid.right >= innerWidth - 2,
      fitsHeight: grid.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight,
      equalRows: Math.max(...rows) - Math.min(...rows) < 1,
      oneActionRow: actions.every(button => button.top === actions[0].top && button.height >= 44),
      enoughSpace: grid.top > header.bottom && grid.height >= 350 };
  });

  const first = await setup(375);
  await first.goto(origin + '/seats/');
  await signIn(first, 'Open Seats');
  await first.getByRole('link', { name: 'Yahrzeit Calendar' }).click();
  await first.getByRole('button', { name: 'Open Yahrzeit Calendar', exact: true }).waitFor();
  assert.equal(signIns.length, 1, 'Signing in to Seats leaves the Yahrzeit Calendar locked');
  await signIn(first, 'Open Yahrzeit Calendar');
  await first.getByRole('table', { name: 'November 2026' }).waitFor();
  assert.equal(await first.getByRole('link', { name: 'Back to Seats' }).count(), 0);
  assert.equal(await first.getByRole('link', { name: /Shul admin/ }).getAttribute('href'), '/admin/');
  assert.deepEqual(await calendarBounds(first), { fillsWidth: true, fitsHeight: true, equalRows: true, oneActionRow: true, enoughSpace: true });
  assert.ok(await first.locator('.cal-facts').getByText('ר״ח כסלו').count());
  const englishIsLarger = await first.locator('.cal-day').first().evaluate(day =>
    parseFloat(getComputedStyle(day.querySelector('.cal-english-day')).fontSize) > parseFloat(getComputedStyle(day.querySelector('.cal-hebrew-day')).fontSize));
  assert.ok(englishIsLarger, 'English dates should be larger, with Hebrew dates still visible');
  assert.equal(await first.locator('.yr-english-month').innerText(), 'November 2026');
  await first.getByRole('button', { name: 'Next month' }).click();
  await first.getByRole('table', { name: 'December 2026' }).waitFor();
  await first.getByRole('button', { name: 'Next month' }).click();
  await first.getByRole('table', { name: 'January 2027' }).waitFor();
  await first.getByRole('button', { name: 'Refresh calendar' }).click();
  await first.getByRole('table', { name: 'January 2027' }).waitFor();
  assert.ok((await calendarBounds(first)).fitsHeight);
  await first.getByRole('button', { name: 'Previous month' }).click();
  await first.getByRole('table', { name: 'December 2026' }).waitFor();
  await first.getByRole('button', { name: 'Previous month' }).click();
  await first.getByRole('table', { name: 'November 2026' }).waitFor();
  await chooseCalendarOption(first, 'Find Hebrew date');
  await first.getByLabel('Hebrew month').selectOption('8');
  await first.getByLabel('Hebrew day').selectOption('30');
  await first.getByRole('button', { name: 'Find date', exact: true }).click();
  await first.getByText('Tuesday, November 10, 2026', { exact: true }).waitFor();
  await first.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseCalendarOption(first, 'Add member');
  assert.equal(signIns.length, 2, 'The same PIN opens the Yahrzeit Calendar in its own session');
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
  await first.getByRole('button', { name: 'Save member' }).click();
  await first.getByText('Saved to the website.', { exact: false }).waitFor();
  const eventCount = first.getByRole('button', { name: /3 yahrzeits/ }).locator('.yr-day-count');
  assert.equal(await eventCount.innerText(), '3 entries');
  assert.ok(await eventCount.evaluate(count => count.scrollWidth <= count.clientWidth));
  await first.getByRole('button', { name: /3 yahrzeits/ }).click();
  await first.getByText('Grandfather: ר׳ דוד <test>').waitFor();
  const grandfather = first.getByRole('listitem').filter({ hasText: 'Grandfather:' });
  assert.equal(await grandfather.getByText('Synthetic organizer').isVisible(), false);
  await grandfather.getByText('Entry info').click();
  await grandfather.getByText('Synthetic organizer').waitFor();
  const originallyAddedAt = await grandfather.locator('time').getAttribute('datetime');
  assert.ok(Number.isFinite(Date.parse(originallyAddedAt)));
  await first.getByRole('button', { name: 'Close' }).click();
  assert.ok(await checkWidth(first), 'calendar should fit 375 pixels');
  if (process.env.YAHRZEIT_SCREENSHOT) await first.screenshot({ path: process.env.YAHRZEIT_SCREENSHOT });
  await first.getByRole('button', { name: 'List', exact: true }).click();
  const agenda = first.getByRole('region', { name: 'Yahrzeit list', exact: true });
  await agenda.getByText('Jan 1, 2026 to Dec 31, 2026').waitFor();
  assert.equal(await first.getByRole('table').count(), 0);
  await agenda.getByText('Synthetic Member', { exact: true }).first().waitFor();
  await first.getByLabel('Date range').selectOption('week');
  await agenda.getByText('Nov 8, 2026 to Nov 14, 2026').waitFor();
  await agenda.getByRole('button', { name: /View details for Mon, Nov 9/ }).click();
  await first.getByRole('dialog', { name: 'Yahrzeits' }).getByText('Grandfather: ר׳ דוד <test>').waitFor();
  await first.getByRole('button', { name: 'Close', exact: true }).click();
  await first.getByLabel('Date range').selectOption('next-week');
  await agenda.getByText('No yahrzeits in this date range.').waitFor();
  await first.getByLabel('Date range').selectOption('custom');
  await agenda.getByLabel('From', { exact: true }).fill('2026-11-09');
  await agenda.getByLabel('To', { exact: true }).fill('2026-11-09');
  await agenda.getByRole('button', { name: 'Apply dates' }).click();
  await agenda.getByText('Synthetic Member', { exact: true }).first().waitFor();
  assert.ok(await checkWidth(first), 'custom date controls should fit 375 pixels');
  if (process.env.YAHRZEIT_SCREENSHOT) await first.screenshot({ path: process.env.YAHRZEIT_SCREENSHOT.replace(/\.png$/, '-list.png') });
  await first.getByRole('button', { name: 'Refresh calendar' }).click();
  await first.getByRole('button', { name: 'List', exact: true, pressed: true }).waitFor();
  assert.equal(await first.getByLabel('Date range').inputValue(), 'custom');
  await agenda.getByText('Synthetic Member', { exact: true }).first().waitFor();
  await first.getByRole('button', { name: 'Calendar', exact: true }).click();
  await first.getByRole('table').waitFor();

  const second = await setup(393);
  await second.goto(origin + '/yahrzeits/');
  await signIn(second, 'Open Yahrzeit Calendar', 'Synthetic second organizer');
  await chooseCalendarOption(second, 'Members');
  await second.getByRole('button', { name: 'Edit Synthetic Member' }).click();
  assert.equal(await entry(second, 'custom').getByLabel('Name of the deceased (optional)').inputValue(), 'ר׳ דוד <test>');
  assert.ok(await checkWidth(second), 'form should fit 393 pixels');
  assert.equal(signIns.length, 3);
  await chooseCalendarOption(first, 'Members');
  await first.getByRole('button', { name: 'Edit Synthetic Member' }).click();
  await second.getByLabel('Congregation member').fill('Renamed Member');
  await second.getByRole('button', { name: 'Save member' }).click();
  await second.getByText('Saved to the website.', { exact: false }).waitFor();
  await first.getByLabel('Congregation member').fill('Older copy');
  const conflict = first.waitForResponse(response => response.url().includes('/api/yahrzeits/') && response.status() === 409);
  await first.getByRole('button', { name: 'Save member' }).click();
  await conflict;
  await first.getByText('Someone else changed this record.', { exact: false }).waitFor();
  await first.reload();
  await chooseCalendarOption(first, 'Members');
  await first.getByRole('button', { name: 'Edit Renamed Member' }).click();
  const savedTime = await entry(first, 'custom').locator('time').getAttribute('datetime');
  assert.equal(savedTime, originallyAddedAt, 'An edit must preserve the original date and organizer');
  first.once('dialog', confirm => confirm.accept());
  await first.getByRole('button', { name: 'Delete member' }).click();
  await first.getByText('Member removed.').waitFor();
  await chooseCalendarOption(first, 'Members');
  await first.getByText('No members have been added yet.').waitFor();
  await first.getByRole('dialog', { name: 'Members' }).getByRole('button', { name: '+ Add member' }).click();
  await first.getByLabel('Congregation member').fill('Member without Dates');
  await first.getByRole('button', { name: 'Save member' }).click();
  await first.getByText('Saved to the website.').waitFor();
  await chooseCalendarOption(first, 'Members');
  await first.getByText('No yahrzeits entered').waitFor();
  await first.getByRole('button', { name: 'Import spreadsheet', exact: true }).click();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Name', 'Address', 'Father Hebrew Date', 'Mother Hebrew Date'],
    ['Member without Dates', '5 Example Street', 'כ״ט בחשון', ''],
    ['Imported Names Only', '8 Example Street', '', ''],
    ['Imported with Dates', '', '', '29 Cheshvan'],
  ]), 'Members');
  await first.getByLabel('Spreadsheet', { exact: true }).setInputFiles({
    name: 'members.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(XLSX.write(book, { bookType: 'xlsx', type: 'array' })),
  });
  await first.getByText('2 new · 1 with details to add · 0 unchanged').waitFor();
  await first.getByRole('button', { name: 'Import members', exact: true }).click();
  await first.getByRole('button', { name: 'Edit Imported Names Only' }).click();
  assert.equal(await first.getByLabel('Address (optional)').inputValue(), '8 Example Street');
  await first.getByText('Member info', { exact: true }).click();
  await first.getByText('Synthetic organizer').waitFor();
  await first.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseCalendarOption(first, 'Members');
  await first.getByRole('button', { name: 'Edit Imported with Dates' }).click();
  assert.equal(await entry(first, 'mother').getByLabel('Hebrew day').inputValue(), '29');
  assert.equal(await entry(first, 'mother').getByLabel('Hebrew month').inputValue(), '8');
  await entry(first, 'mother').getByText('Entry info').click();
  await entry(first, 'mother').getByText('Synthetic organizer').waitFor();
  await first.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseCalendarOption(first, 'Log out');
  await first.getByRole('button', { name: 'Open Yahrzeit Calendar', exact: true }).waitFor();
  await first.goto(origin + '/seats/');
  await first.getByRole('link', { name: 'Yahrzeit Calendar' }).waitFor();
  assert.equal(signIns.length, 3, 'Logging out of the Yahrzeit Calendar leaves Seats signed in');
  await second.goto(origin + '/seats/');
  await second.getByRole('button', { name: 'Open Seats', exact: true }).waitFor();
  assert.equal(signIns.length, 3, 'Signing in to the Yahrzeit Calendar leaves Seats locked');
  assert.deepEqual(errors, []);
});
