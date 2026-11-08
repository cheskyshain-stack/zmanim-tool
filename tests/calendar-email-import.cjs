// Isolated Workerd and browser checks. No real email, account or post is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { createHash, randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, 'worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
const output = process.env.CALENDAR_EMAIL_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-email-'));
fs.mkdirSync(output, { recursive: true });
let endpoint, backend, browser;
const errors = [], checks = [];
const server = http.createServer((request, response) => {
  if (request.url.split('?')[0] === '/data/calendar.json') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ endpoint })); }
  let file = path.resolve(root, 'dist', '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(path.join(root, 'dist') + path.sep)) return response.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return response.writeHead(404).end();
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
const subject = 'New text message from Lc Text (848) 356-4187';
const from = '"Lc Text (SMS)" <15510001111.18483564187.synthetic@txt.voice.google.com>';
const wrapper = text => '<https://voice.google.com>\r\n' + text + '\r\nYOUR ACCOUNT <https://voice.google.com> HELP CENTER\r\n<https://support.google.com/voice#topic=1707989> HELP FORUM\r\nGoogle LLC\r\n1600 Amphitheatre Pkwy';
const receivedAt = new Date(Date.now() - 7 * 86400000).toISOString();
const input = (id, text, change = {}) => ({ mailbox: 'ads@neileich.org', message: { sourceId: id, subject, from, receivedAt, text: wrapper(text), ...change } });

(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port, setupToken = randomBytes(32).toString('hex');
    const bundle = await build({ entryPoints: [path.join(runtime, 'worker.js')], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
    backend = new Miniflare(convertV4MiniflareOptions({ name: 'lc-text-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
      bindings: { ALLOWED_ORIGIN: origin, BOOTSTRAP_SHA256: createHash('sha256').update(setupToken).digest('hex') }, durableObjects: { CALENDAR: { className: 'CommunityCalendar', useSQLite: true } } }));
    endpoint = (await backend.ready).origin;
    const call = async (route, method = 'GET', body, token, customOrigin = origin, inboxKey) => {
      const response = await backend.dispatchFetch(endpoint + route, { method, headers: { ...(customOrigin ? { Origin: customOrigin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(inboxKey ? { 'X-Calendar-Inbox-Key': inboxKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const incoming = (body, key) => call('/api/email-import/receive', 'POST', body, null, null, key);
    assert.equal((await incoming({ heartbeat: true })).status, 401);
    assert.equal((await call('/api/email-import')).status, 401);
    assert.equal((await call('/api/events?from=2026-11-01&to=2026-11-30', 'GET', null, null, null)).status, 403);
    const owner = (await call('/api/setup', 'POST', { setupToken, name: 'Synthetic owner', email: 'owner@example.test', password: 'Synthetic owner password 2026' })).body;
    const invited = (await call('/api/access', 'POST', { name: 'Synthetic editor', email: 'editor@example.test' }, owner.token)).body;
    const editor = (await call('/api/invitations/claim', 'POST', { token: invited.token, password: 'Synthetic editor password 2026' })).body;
    const viewer = (await call('/api/register', 'POST', { name: 'Synthetic reader', email: 'reader@example.test', password: 'Synthetic reader password 2026' })).body;
    for (const actor of [editor, viewer]) {
      assert.equal((await call('/api/email-import', 'GET', null, actor.token)).status, 403);
      assert.equal((await call('/api/email-import', 'POST', { revision: 0, includeExisting: true }, actor.token)).status, 403);
      assert.equal((await call('/api/email-import/review', 'GET', null, actor.token)).status, 403);
    }
    let result = await call('/api/email-import', 'POST', { revision: 0, includeExisting: true }, owner.token);
    assert.equal(result.status, 200); let key = result.body.script.match(/"key": "([a-f0-9]{64})"/)[1];
    assert(!result.body.script.includes(owner.token));
    assert.equal((await call('/api/email-import', 'POST', { revision: 0, includeExisting: true }, owner.token)).status, 409);
    const publicConnection = await call('/api/email-import', 'GET', null, owner.token);
    assert(!JSON.stringify(publicConnection.body).includes(key)); assert(!('keyHash' in publicConnection.body.connection));
    assert.equal((await incoming({ mailbox: 'other@example.test', heartbeat: true }, key)).status, 403);
    assert.equal((await incoming({ mailbox: 'ads@neileich.org', heartbeat: true }, key)).status, 200);
    for (const change of [{ from: 'attacker@example.test' }, { from: from.replace('18483564187', '18483564188') }, { subject: 'Fwd: ' + subject }]) {
      assert.equal((await incoming(input('111111111111', 'Wrong sender', change), key)).body.ignored, true);
    }
    assert.equal((await call('/api/announcements/status', 'GET', null, viewer.token)).body.total, 0);
    const original = input('111111111111', 'Synthetic notice\nמזל טוב\n7:30 @ #230');
    result = await incoming(original, key); assert.equal(result.status, 200); assert.equal(result.body.posted, true);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null, 'The machine receiver grants no browser CORS access');
    assert.equal((await incoming(original, key)).body.duplicate, true);
    let feed = (await call('/api/announcements', 'GET', null, viewer.token)).body;
    assert.equal(feed.total, 1); assert.equal(feed.unread, 1); assert.equal(feed.messages[0].createdAt, receivedAt);
    assert.equal(feed.messages[0].text, 'Synthetic notice\nמזל טוב\n7:30 @ #230');
    assert(!JSON.stringify(feed).includes('ads@')); assert(!JSON.stringify(feed).includes('txt.voice.google.com'));
    assert.equal((await call('/api/announcements/status', 'GET', null, owner.token)).body.unread, 1, 'Importing never marks the owner or anyone else as read');
    const importedId = feed.messages[0].id;
    await call('/api/announcements/' + importedId, 'PUT', { text: 'Manager correction', revision: 1, operationId: randomBytes(16).toString('hex') }, editor.token);
    await incoming(original, key);
    assert.equal((await call('/api/announcements', 'GET', null, viewer.token)).body.messages[0].text, 'Manager correction');
    await call('/api/announcements/' + importedId, 'DELETE', {}, owner.token); await incoming(original, key);
    assert.equal((await call('/api/announcements', 'GET', null, viewer.token)).body.messages.length, 0, 'A retry cannot restore a deleted notification');
    assert.equal((await incoming(input('222222222222', 'x'.repeat(4001)), key)).body.needsReview, true);
    assert.equal((await incoming(input('333333333333', ''), key)).body.needsReview, true);
    let review = (await call('/api/email-import/review', 'GET', null, owner.token)).body.messages;
    assert.equal(review.length, 2);
    const long = review.find(message => message.sourceId === '222222222222'), empty = review.find(message => message.sourceId === '333333333333');
    assert.equal((await call('/api/email-import/review/' + long.digest, 'POST', { action: 'post', text: 'Manual review' }, editor.token)).status, 403);
    const manual = { action: 'post', text: 'Reviewed original wording' };
    await call('/api/email-import/review/' + long.digest, 'POST', manual, owner.token);
    await call('/api/email-import/review/' + long.digest, 'POST', manual, owner.token);
    await call('/api/email-import/review/' + empty.digest, 'POST', { action: 'skip' }, owner.token);
    await incoming(input('333333333333', ''), key);
    assert.equal((await call('/api/email-import/review', 'GET', null, owner.token)).body.messages.length, 0);
    feed = (await call('/api/announcements', 'GET', null, viewer.token)).body;
    assert.equal(feed.messages.length, 1); assert.equal(feed.messages[0].text, manual.text); assert.equal(feed.messages[0].createdAt, receivedAt);
    result = await call('/api/email-import', 'POST', { revision: 1, includeExisting: true }, owner.token);
    const oldKey = key; key = result.body.script.match(/"key": "([a-f0-9]{64})"/)[1];
    assert.equal((await incoming(original, oldKey)).status, 401); assert.equal((await incoming(original, key)).body.duplicate, true);
    checks.push('Owner-only configuration; exact sender; authenticated machine receipt; safe extraction; original dates; private provenance; independent unread counts; retry/edit/deletion protection; review; rotation');

    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
    for (const width of [320, 393, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
      await context.addInitScript(session => { sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify(session)); localStorage.setItem('zmanim-nocount', '1'); }, owner);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
      await page.goto(origin + '/admin/calendar/'); await page.locator('[data-cal-access]').click(); await page.locator('[data-cal-email-import]').click();
      await page.getByRole('heading', { name: 'LC Text connection', exact: true }).waitFor(); await page.locator('.cal-inbox-setup').waitFor();
      assert.equal(await page.locator('.cal-inbox-dialog [data-cal-inbox-content] > details').first().getAttribute('open'), null, 'Explanations start collapsed');
      if (width === 320) await page.locator('[name=includeExisting]').uncheck();
      await page.getByRole('button', { name: 'Create replacement script', exact: true }).click();
      await page.locator('[data-cal-inbox-script]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[name=includeExisting]').isChecked(), width !== 320, 'Creating the script preserves the chosen history setting');
      const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download script', exact: true }).click();
      const downloadPath = await (await downloadEvent).path(), generated = fs.readFileSync(downloadPath, 'utf8');
      key = generated.match(/"key": "([a-f0-9]{64})"/)[1];
      assert(generated.includes('setupLcTextCalendar')); assert(!generated.includes(owner.token));
      assert.equal(JSON.parse(generated.match(/var LC_CALENDAR_CONFIG = ([\s\S]*?);\n/)[1]).includeExisting, width !== 320);
      await incoming(input('aaaa00000000' + width, '<img src=x onerror="window.emailXss=1">', { truncated: true }), key);
      await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
      await page.getByText('Messages needing review (1)', { exact: true }).click();
      await page.locator('.cal-inbox-review-card').waitFor();
      const digest = await page.locator('.cal-inbox-review-card').getAttribute('data-cal-inbox-review-id');
      const card = page.locator('[data-cal-inbox-review-id="' + digest + '"]'); await card.getByText('Original email', { exact: true }).click();
      assert.equal(await card.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.emailXss), undefined);
      await card.locator('textarea').fill('Synthetic reviewed wording\nמזל טוב');
      await incoming(input('bbbb00000000' + width, '', { truncated: true }), key);
      await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
      await page.getByText('Messages needing review (2)', { exact: true }).waitFor();
      await page.waitForFunction(id => document.querySelector('[data-cal-inbox-review-id="' + id + '"] textarea')?.value === 'Synthetic reviewed wording\nמזל טוב', digest);
      await page.screenshot({ path: path.join(output, 'lc-text-review-' + width + '.png'), fullPage: true });
      const geometry = await page.locator('.cal-inbox-dialog').evaluate(dialog => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right, buttons: [...dialog.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect().height), textarea: dialog.querySelector('.cal-inbox-review-card textarea').getBoundingClientRect().width }));
      assert(geometry.scrollWidth <= width && geometry.left >= 0 && geometry.right <= width, JSON.stringify(geometry));
      assert(geometry.buttons.every(height => height >= 44)); assert(geometry.textarea >= width * (width > 700 ? .15 : .55));
      checks.push({ width, geometry });
      await card.getByRole('button', { name: 'Post notification', exact: true }).click(); await card.waitFor({ state: 'detached' });
      await page.getByText('Notification posted.', { exact: true }).waitFor();
      await page.locator('.cal-inbox-review-card').getByRole('button', { name: 'Skip email', exact: true }).click();
      await page.getByText('Email skipped.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
      await page.getByRole('button', { name: 'Disconnect LC Text', exact: true }).click(); await page.getByText('LC Text disconnected.', { exact: true }).waitFor();
      assert.equal((await incoming(original, key)).status, 401);
      await page.keyboard.press('Escape');
      if (width !== 1440) {
        const state = (await call('/api/email-import', 'GET', null, owner.token)).body.connection;
        await call('/api/email-import', 'POST', { revision: state.revision, includeExisting: true }, owner.token);
      }
      await context.close();
    }
    const oldContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
    await oldContext.addInitScript(session => { sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify(session)); localStorage.setItem('zmanim-nocount', '1'); }, owner);
    const oldPage = await oldContext.newPage();
    await oldPage.route(endpoint + '/api/info', route => route.fulfill({ json: { private: true, ready: true } }));
    await oldPage.goto(origin + '/admin/calendar/'); await oldPage.locator('[data-cal-access]').click(); await oldPage.locator('[data-cal-email-import]').click();
    await oldPage.getByText('The email connection is awaiting activation.', { exact: false }).waitFor();
    assert.equal(await oldPage.locator('.cal-inbox-setup').count(), 0, 'An older deployed service cannot appear connected or offer an unsupported setup');
    await oldContext.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2));
    console.log('LC Text worker, permissions, Google-script handoff and browser checks passed. Artifacts: ' + output);
  } finally { await browser?.close(); await backend?.dispose(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
