// Build first, then npm ci --prefix worker/calendar. No real account or event is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { createHash, randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, 'worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
const output = process.env.CALENDAR_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'shul-calendar-'));
fs.mkdirSync(output, { recursive: true });
let endpoint = '', backend;
const errors = [], requests = [], checks = [];
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/data/calendar.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ endpoint })); }
  let file = path.resolve(root, 'dist', '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== path.join(root, 'dist') && !file.startsWith(path.join(root, 'dist') + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const ownerPassword = 'Synthetic calendar owner password 2026';
const editorPassword = 'Synthetic calendar editor password 2026';

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const context = async width => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        localStorage.setItem('zmanim-nocount', '1');
      } catch { /* Initial opaque documents have no site storage. */ }
    });
    ctx.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    });
    return ctx;
  };
  const jump = async (page, month) => {
    await page.locator('[data-cal-jump]').click(); await page.locator('.cal-dialog input[name=month]').fill(month);
    await page.getByRole('button', { name: 'Show month', exact: true }).click();
  };
  const fillEvent = async (page, title, type = 'kiddush', date = '2026-11-07') => {
    await page.locator('.cal-brand [data-cal-add]').click();
    const form = page.locator('.cal-dialog form');
    await form.locator('[name=title]').fill(title); await form.locator('[name=type]').selectOption(type); await form.locator('[name=date]').fill(date);
    return form;
  };
  const fit = async (page, label) => {
    const geometry = await page.evaluate(() => {
      const table = document.querySelector('.cal-grid').getBoundingClientRect(), card = document.querySelector('.shul-calendar').getBoundingClientRect();
      const min = [...document.querySelectorAll('.cal-month-nav > button,.cal-brand > button')].map(el => el.getBoundingClientRect().height);
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, table: [table.left, table.right], card: [card.left, card.right], buttons: min,
        even: getComputedStyle(document.querySelector('.cal-grid tbody tr:nth-child(2) td')).backgroundColor };
    });
    assert(geometry.scrollWidth <= geometry.viewport, label + ': no horizontal page overflow');
    assert(geometry.table[0] >= 0 && geometry.table[1] <= geometry.viewport, label + ': seven day columns fit');
    assert(geometry.buttons.every(height => height >= 44));
    assert.equal(geometry.even, 'rgb(255, 255, 255)', 'Chart zebra shading must not reach the calendar');
    checks.push({ label, geometry });
  };
  try {
    // The first phase is explicitly a device preview inside the existing admin.
    for (const width of [320, 375, 768, 1440]) {
      const ctx = await context(width), page = await ctx.newPage();
      await page.goto(origin + '/admin/#calendar'); await page.locator('.shul-calendar').waitFor();
      await jump(page, '2026-11'); await fit(page, 'preview-' + width);
      await page.evaluate(() => document.fonts.ready);
      const before = await page.locator('[data-cal-step="1"]').evaluate(el => el.getBoundingClientRect().top);
      await page.locator('[data-cal-step="1"]').click();
      const after = await page.locator('[data-cal-step="1"]').evaluate(el => el.getBoundingClientRect().top);
      assert(Math.abs(after - before) < 1, JSON.stringify({ width, before, after, scroll: await page.evaluate(() => scrollY) }));
      await page.locator('[data-cal-step="-1"]').click();
      await page.locator('[data-cal-examples]').check();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, 'calendar-' + width + '.png'), fullPage: true });
      const form = await fillEvent(page, 'Synthetic Kiddush with a long title - מזל טוב למשפחה ולכל הקהילה', 'kiddush');
      await form.locator('[name=description]').fill('First line\nSecond line: מזל טוב');
      await form.locator('[name=location]').fill('Synthetic shul location');
      await form.getByRole('button', { name: 'Save event', exact: true }).click();
      await page.locator('.cal-dialog').waitFor({ state: 'detached' });
      await page.reload(); await page.locator('.shul-calendar').waitFor(); await jump(page, '2026-11');
      assert.equal(await page.locator('[data-cal-examples]').isChecked(), false, 'Example events are not persisted');
      await page.locator('[data-cal-day="2026-11-07"]').click();
      const scope = width <= 700 ? page.locator('.cal-dialog') : page.locator('.cal-day-panel');
      await scope.locator('[data-cal-edit]').click();
      await page.locator('.cal-dialog [name=title]').fill('Updated synthetic Kiddush');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.locator('.cal-dialog').waitFor({ state: 'detached' });
      const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('lakewood-commons-calendar-preview-v1')));
      assert.equal(raw.events.length, 1); assert.equal(raw.events[0].title, 'Updated synthetic Kiddush'); assert.equal(raw.events[0].revision, 2);
      await page.locator('[data-cal-day="2026-11-07"]').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('[data-cal-day="2026-11-08"]').getAttribute('aria-pressed'), 'true');
      if (width === 375) {
        const another = await fillEvent(page, '<img src=x onerror="window.calendarXss=1">', 'announcement', '2026-11-08');
        await another.getByRole('button', { name: 'Save event', exact: true }).click();
        await page.locator('[data-cal-day="2026-11-08"]').click();
        assert.equal(await page.evaluate(() => window.calendarXss), undefined);
        assert.equal(await page.locator('.cal-event-card img').count(), 0);
        await page.keyboard.press('Escape');
        await page.locator('[data-cal-access]').click();
        const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download event backup' }).click();
        const download = await downloadEvent, backup = path.join(output, 'preview-backup.json'); await download.saveAs(backup);
        assert.equal(JSON.parse(fs.readFileSync(backup)).events.length, 2);
        await page.keyboard.press('Escape');
        const timed = await fillEvent(page, 'Keyboard viewport test');
        await timed.locator('[name=allDay]').uncheck(); await timed.locator('[name=time]').fill('19:15');
        await page.screenshot({ path: path.join(output, 'event-form-phone.png') });
        // Simulate an on-screen keyboard reducing the visual viewport.
        await page.evaluate(() => {
          Object.defineProperties(window.visualViewport, { height: { configurable: true, value: 420 }, offsetTop: { configurable: true, value: 0 } });
          document.querySelector('.cal-dialog textarea').focus(); visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(50);
        const rects = await page.locator('.cal-dialog').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, field: el.querySelector('textarea').getBoundingClientRect().bottom }));
        assert(rects.bottom <= 420 && rects.field <= rects.bottom - 12, 'Focused input remains above the reduced viewport');
        page.once('dialog', dialog => dialog.accept()); await page.keyboard.press('Escape');
      }
      await fit(page, 'populated-' + width);
      await page.goto(origin + '/admin/calendar/'); await page.getByRole('heading', { name: 'Calendar editor access' }).waitFor();
      assert.equal(await page.locator('.cal-grid').count(), 0, 'Unconnected editor page does not simulate private access');
      await page.goto(origin + '/?count=off');
      assert.equal(await page.locator('a[href*="calendar"]').count(), 0, 'No calendar was added to congregation navigation');
      await ctx.close();
    }
    assert(!requests.some(request => /\/api\/events|\/api\/access|\/api\/session/.test(request.url)), 'Device preview sends no event/account data to a server');
    // A real isolated Workerd instance verifies the prepared shared accounts.
    const setupToken = randomBytes(32).toString('hex');
    const bundle = await build({ entryPoints: [path.join(runtime, 'worker.js')], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
    backend = new Miniflare(convertV4MiniflareOptions({ name: 'calendar-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
      bindings: { ALLOWED_ORIGIN: origin, BOOTSTRAP_SHA256: createHash('sha256').update(setupToken).digest('hex') },
      durableObjects: { CALENDAR: { className: 'CommunityCalendar', useSQLite: true } } }));
    endpoint = (await backend.ready).origin;
    const call = async (route, method = 'GET', body, token, customOrigin = origin) => {
      const response = await backend.dispatchFetch('https://service.test' + route, { method, headers: { Origin: customOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call('/api/events?from=2026-11-01&to=2026-11-30')).status, 401);
    assert.equal((await call('/api/info', 'GET', null, null, 'https://unrelated.example')).status, 403);
    const ownerCtx = await context(1440), ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(origin + '/admin/calendar/#setup=' + setupToken);
    await ownerPage.getByRole('heading', { name: 'Set up calendar access' }).waitFor();
    assert(!ownerPage.url().includes(setupToken), 'Setup token is removed from the address');
    await ownerPage.locator('[name=name]').fill('Synthetic owner'); await ownerPage.locator('[name=email]').fill('owner@example.test');
    await ownerPage.locator('[name=password]').fill(ownerPassword); await ownerPage.locator('[name=confirmation]').fill(ownerPassword);
    await ownerPage.getByRole('button', { name: 'Create account', exact: true }).click(); await ownerPage.locator('.shul-calendar').waitFor(); await jump(ownerPage, '2026-11');
    const session = await ownerPage.evaluate(() => JSON.parse(sessionStorage.getItem('lakewood-commons-calendar-session-v1')));
    const owner = session.token;
    assert.equal(session.user.role, 'owner');
    assert.equal((await call('/api/setup', 'POST', { setupToken, name: 'Second owner', email: 'second@example.test', password: ownerPassword })).status, 409);
    const invite = await call('/api/access', 'POST', { name: 'Synthetic editor', email: 'editor@example.test', role: 'owner' }, owner);
    assert.equal(invite.status, 201); assert.equal(invite.body.user.role, 'editor');
    const editorCtx = await context(375), editorPage = await editorCtx.newPage();
    await editorPage.goto(origin + '/admin/calendar/#invite=' + invite.body.token);
    await editorPage.locator('[name=password]').fill(editorPassword); await editorPage.locator('[name=confirmation]').fill(editorPassword);
    await editorPage.getByRole('button', { name: 'Create account', exact: true }).click(); await editorPage.locator('.shul-calendar').waitFor(); await jump(editorPage, '2026-11');
    const editorSession = await editorPage.evaluate(() => JSON.parse(sessionStorage.getItem('lakewood-commons-calendar-session-v1'))), editor = editorSession.token;
    assert.equal(editorSession.user.role, 'editor');
    assert.equal((await call('/api/invitations/claim', 'POST', { token: invite.body.token, password: editorPassword })).status, 401);
    assert.equal((await call('/api/access', 'GET', null, editor)).status, 403);
    assert.equal((await call('/api/access', 'POST', { name: 'No escalation', email: 'escalation@example.test' }, editor)).status, 403);
    const ownForm = await fillEvent(editorPage, 'Synthetic editor wedding', 'wedding', '2026-11-11');
    await ownForm.locator('[name=allDay]').uncheck(); await ownForm.locator('[name=time]').fill('19:00');
    await ownForm.getByRole('button', { name: 'Save event', exact: true }).click(); await editorPage.locator('.cal-dialog').waitFor({ state: 'detached' });
    let result = await call('/api/events?from=2026-11-01&to=2026-11-30', 'GET', null, owner);
    const item = result.body.events[0]; assert.equal(item.title, 'Synthetic editor wedding'); assert.equal(item.createdBy, editorSession.user.id);
    const concurrent = await Promise.all(['First revision', 'Second revision'].map(title => call('/api/events/' + item.id, 'PUT', { ...item, title }, owner)));
    assert.deepEqual(concurrent.map(value => value.status).sort(), [200, 409], 'Concurrent changes must not overwrite each other');
    const ownerId = crypto.randomUUID(), fields = { title: 'Owner event', type: 'kiddush', date: '2026-11-07', allDay: true, revision: 0, createdBy: editorSession.user.id };
    const ownerEvent = await call('/api/events/' + ownerId, 'PUT', fields, owner);
    assert.equal(ownerEvent.status, 201); assert.equal(ownerEvent.body.event.createdBy, session.user.id, 'Event ownership comes from the server session');
    assert.equal((await call('/api/events/' + ownerId, 'PUT', { ...ownerEvent.body.event, title: 'Forbidden change' }, editor)).status, 403);
    assert.equal((await call('/api/events/' + ownerId, 'DELETE', { revision: 1 }, editor)).status, 403);
    assert.equal((await call('/api/events/' + ownerId, 'PUT', { ...ownerEvent.body.event, date: '2026-02-30' }, owner)).status, 400);
    assert.equal((await call('/api/events/' + ownerId, 'DELETE', { revision: 1 }, owner)).status, 200);
    assert.equal((await call('/api/events/' + ownerId, 'PUT', fields, owner)).status, 409, 'A stale retry cannot recreate a deleted event');
    const access = await call('/api/access', 'GET', null, owner);
    assert(!/password|salt/.test(JSON.stringify(access.body)), 'Account API never returns password material');
    assert.equal((await call('/api/access/' + session.user.id, 'DELETE', null, owner)).status, 400, 'Main admin cannot be accidentally removed');
    const reset = await call('/api/access/' + editorSession.user.id, 'POST', null, owner);
    assert.equal(reset.status, 200);
    assert.equal((await call('/api/events?from=2026-11-01&to=2026-11-30', 'GET', null, editor)).status, 401, 'Reset revokes existing sessions immediately');
    assert.equal((await call('/api/session', 'POST', { email: 'editor@example.test', password: editorPassword })).status, 401, 'Old password stops working at reset');
    const claimed = await call('/api/invitations/claim', 'POST', { token: reset.body.token, password: 'A different synthetic password 2026' });
    assert.equal(claimed.status, 200);
    assert.equal((await call('/api/access/' + editorSession.user.id, 'DELETE', null, owner)).status, 200);
    assert.equal((await call('/api/events?from=2026-11-01&to=2026-11-30', 'GET', null, claimed.body.token)).status, 401, 'Removed account loses access immediately');
    assert((await call('/api/events?from=2026-11-01&to=2026-11-30', 'GET', null, owner)).body.events.length > 0, 'Main admin retains removed editor events');
    await ownerPage.locator('[data-cal-access]').click(); await ownerPage.locator('.cal-account').first().waitFor();
    await ownerPage.locator('.cal-invite-form [name=name]').fill('Browser invite test'); await ownerPage.locator('.cal-invite-form [name=email]').fill('browser@example.test');
    await ownerPage.getByRole('button', { name: 'Create invitation', exact: true }).click(); await ownerPage.locator('[data-cal-invitation]:visible').waitFor();
    const link = await ownerPage.locator('[data-cal-invitation] input').inputValue(); assert(link.startsWith(origin + '/admin/calendar/#invite='));
    await ownerPage.screenshot({ path: path.join(output, 'calendar-accounts.png') });
    await ownerPage.keyboard.press('Escape');
    await ownerPage.route(endpoint + '/api/events?*', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin }, body: JSON.stringify({ error: 'Synthetic service unavailable' }) }));
    await ownerPage.locator('[data-cal-step="1"]').click();
    await ownerPage.locator('.cal-day-panel .cal-error').filter({ hasText: 'Synthetic service unavailable' }).waitFor();
    assert(await ownerPage.locator('.cal-brand [data-cal-add]').isDisabled(), 'Unavailable storage is not shown as an empty editable calendar');
    await ownerPage.unroute(endpoint + '/api/events?*');
    await ownerPage.locator('.cal-day-panel [data-cal-reload]').click();
    await ownerPage.locator('.cal-brand [data-cal-add]:not([disabled])').waitFor();
    await ownerPage.locator('[data-cal-step="-1"]').click();
    await ownerPage.locator('[data-cal-day="2026-11-11"] .cal-event-chip').waitFor();
    assert(!requests.some(request => /[?&](token|setup|invite)=/.test(request.url)), 'Account secrets never appear in request URLs');
    assert.deepEqual(errors, []);
    checks.push({ sharedAccounts: true, editorBoundaries: true, ownerControls: true, revocation: true, concurrentEdits: true, inviteRegistration: true });
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors, output }));
    await ownerCtx.close(); await editorCtx.close();
  } finally { await browser.close(); if (backend) await backend.dispose(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
