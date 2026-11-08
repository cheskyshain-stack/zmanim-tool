// Build first. Use actual mouse/touch events and synthetic, intercepted account data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), endpoint = 'https://calendar-preview.example.test';
const output = process.env.CALENDAR_HOME_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-home-preview-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless:true });
  const errors = [], checks = [];
  const user = role => ({ id:'synthetic-' + role, role, name:'Example ' + role, active:true });
  const session = role => ({ token:'d'.repeat(64), expires:Date.parse('2299-01-01T00:00:00Z'), user:user(role) });
  try {
    const prepare = async ({ width = 393, touch = false, role = null, loginRole = 'owner' } = {}) => {
      const context = await browser.newContext({ viewport:{ width, height:900 }, hasTouch:touch, isMobile:touch });
      const calls = [], messages = [], read = new Set();
      const announcementStatus = () => ({ total:messages.length, unread:messages.filter(message => !read.has(message.id)).length, deletedCount:0, editCount:0, canPost:true, canEdit:true, canDelete:true });
      const addAnnouncement = message => { messages.unshift(message); if (message.read) read.add(message.id); };
      await context.addInitScript(value => {
        try { localStorage.setItem('zmanim-nocount', '1'); if (value) sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify(value)); } catch { /* Opaque initial document. */ }
      }, role ? session(role) : null);
      await context.route('**/data/calendar.json', route => route.fulfill({ contentType:'application/json', body:JSON.stringify({ endpoint }) }));
      await context.route(endpoint + '/**', route => {
        const request = route.request(), url = new URL(request.url());
        const headers = { 'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Headers':'Authorization,Content-Type', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
        calls.push(request.method() + ' ' + url.pathname);
        let body;
        if (url.pathname === '/api/session' && request.method() === 'POST') body = session(loginRole);
        else if (url.pathname === '/api/session') body = { user:user(role || loginRole) };
        else if (url.pathname === '/api/events') body = { events:[] };
        else if (url.pathname === '/api/announcements/status') body = announcementStatus();
        else if (url.pathname === '/api/announcements/read') { request.postDataJSON().ids.forEach(id => read.add(id)); body = announcementStatus(); }
        else body = { ...announcementStatus(), messages:messages.map(message => ({ ...message, read:read.has(message.id) })), nextBefore:null };
        return route.fulfill({ headers, contentType:'application/json', body:JSON.stringify(body) });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-11-06T16:00:00Z'));
      const home = async () => { await page.goto(origin + '/?count=off'); await page.locator('[data-calendar-preview]').waitFor(); await page.evaluate(() => document.fonts.ready); };
      const tap = async (count = 1) => {
        const card = page.locator('[data-calendar-preview]'); await card.evaluate(el => el.scrollIntoView({ block:'center', behavior:'instant' }));
        const b = await card.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
        for (let i = 0; i < count; i++) touch ? await page.touchscreen.tap(x, y) : await page.mouse.click(x, y);
      };
      return { context, page, calls, home, tap, addAnnouncement };
    };
    for (const width of [320, 375, 393, 768, 1440]) {
      const t = await prepare({ width });
      for (const date of ['2026-11-06T16:00:00Z', '2026-11-10T16:00:00Z']) {
        await t.page.clock.setFixedTime(new Date(date)); await t.home();
        const cards = await t.page.locator('.luach-menu > .luach-item').evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect(), title = node.querySelector('.luach-item-title');
          return { title:title.textContent, width:box.width, height:box.height, top:box.top, left:box.left,
            titleFits:title.scrollWidth <= title.clientWidth + 1, colour:getComputedStyle(node).backgroundColor };
        }));
        assert.deepEqual(cards.map(card => card.title), ['Zmanim','Donate','Community calendar']);
        assert(cards.every(card => Math.abs(card.width - cards[0].width) < 1 && Math.abs(card.height - cards[0].height) < 1), JSON.stringify({ width, date, cards }));
        assert(cards[2].titleFits); assert.equal(cards[2].colour, 'rgb(236, 238, 239)');
        assert(await t.page.locator('[data-calendar-preview]').isDisabled(), 'Placeholder still announces disabled semantics');
        assert.equal(await t.page.locator('.luach-menu a[href*="calendar"]').count(), 0);
        assert(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await t.page.evaluate(() => scrollTo(0,0));
        await t.page.screenshot({ path:path.join(output, width + '-' + date.slice(0,10) + '.png'), fullPage:true });
        checks.push({ width, date:date.slice(0,10), equalCards:true, order:cards.map(card => card.title) });
      }
      await t.context.close();
    }
    for (const touch of [false, true]) {
      const t = await prepare({ touch });
      await t.home(); await t.tap(); assert.equal(new URL(t.page.url()).pathname, '/');
      await t.home(); await t.tap(2); assert.equal(new URL(t.page.url()).pathname, '/');
      assert.equal(await t.page.locator('[data-calendar-preview]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(236, 238, 239)');
      await t.home(); await t.tap(); await t.page.waitForTimeout(800); await t.tap(); await t.page.waitForTimeout(800); await t.tap();
      assert.equal(new URL(t.page.url()).pathname, '/', 'Separated clicks must not add up to the preview gesture');
      await t.home(); await t.tap(2); await t.page.locator('[data-calendar-preview]').dispatchEvent('pointercancel'); await t.tap();
      assert.equal(new URL(t.page.url()).pathname, '/', 'A cancelled touch/scroll resets the gesture');
      await t.home(); await t.tap(2);
      const outside = t.page.locator('.luach-next-head').first();
      await outside.evaluate(el => el.scrollIntoView({ block:'center', behavior:'instant' }));
      const outsideBox = await outside.boundingBox();
      const outsideX = outsideBox.x + outsideBox.width / 2, outsideY = outsideBox.y + outsideBox.height / 2;
      touch ? await t.page.touchscreen.tap(outsideX,outsideY) : await t.page.mouse.click(outsideX,outsideY);
      await t.tap(); assert.equal(new URL(t.page.url()).pathname, '/', 'An outside tap resets the sequence');
      await t.home(); await t.tap(3);
      await t.page.waitForURL('**/admin/calendar/?preview=congregation');
      await t.page.getByRole('heading', { name:'Calendar sign in', exact:true }).waitFor();
      assert.equal(await t.page.locator('.shul-calendar').count(), 0, 'The gesture does not bypass calendar sign-in');
      assert(!t.calls.some(call => call.includes('/api/events')), 'No private event read without a session');
      await t.page.goBack(); await t.page.locator('[data-calendar-preview]').waitFor(); await t.tap(3);
      await t.page.waitForURL('**/admin/calendar/?preview=congregation');
      await t.page.getByRole('heading', { name:'Calendar sign in', exact:true }).waitFor();
      checks.push({ touch, singleAndDoubleInert:true, slowTapsInert:true, cancelResets:true, tripleOpens:true, signInRequired:true });
      await t.context.close();
    }
    for (const role of ['owner','editor','viewer']) {
      const t = await prepare({ role });
      t.addAnnouncement({ id:'already-read', sequence:1, text:'Previously read update', createdAt:'2026-11-01T12:00:00Z', revision:1, read:true });
      t.addAnnouncement({ id:'long-unread', sequence:2, text:'Long update\n' + 'More announcement details\n'.repeat(80), createdAt:'2026-11-02T12:00:00Z', revision:1 });
      t.addAnnouncement({ id:'short-unread', sequence:3, text:'New Shul announcement', createdAt:'2026-11-03T12:00:00Z', revision:1 });
      await t.home(); await t.tap(3);
      await t.page.waitForURL('**/admin/calendar/?preview=congregation');
      await t.page.locator('.shul-calendar').waitFor();
      assert.equal(await t.page.evaluate(() => JSON.parse(sessionStorage.getItem('lakewood-commons-calendar-session-v1')).user.role), role);
      assert(await t.page.locator('body').evaluate(el => el.classList.contains('cal-reader-page')));
      assert(await t.page.locator('.cal-editor-header').isVisible());
      assert.equal(await t.page.locator('[data-cal-view-notice],[data-cal-view],[data-cal-access],[data-cal-add]').count(), 0, 'The congregation screen has no admin controls');
      await t.page.getByRole('button', { name:'Notifications, 2 unread', exact:true }).waitFor();
      await t.page.getByRole('button', { name:'Notifications, 2 unread', exact:true }).click();
      await t.page.getByRole('button', { name:'Notifications, 1 unread', exact:true }).waitFor();
      assert.equal(await t.page.locator('.cal-announcement-compose:not([hidden]),[data-cal-edit-announcement]:not([hidden]),[data-cal-delete-announcement]:not([hidden])').count(), 0);
      assert(!/Preview|Main admin|Choose Main admin/.test(await t.page.locator('.cal-dialog').innerText()));
      await t.page.locator('.cal-announcement-feed').evaluate(feed => { feed.scrollTop = feed.scrollHeight; });
      await t.page.waitForFunction(() => document.querySelector('[data-cal-announcement-count]').hidden);
      await t.page.keyboard.press('Escape');
      await t.page.reload(); await t.page.locator('.shul-calendar').waitFor();
      await t.page.waitForFunction(() => document.querySelector('[data-cal-announcement-count]').hidden);
      t.addAnnouncement({ id:'later-unread', sequence:4, text:'Another new update', createdAt:'2026-11-04T12:00:00Z', revision:1 });
      await t.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await t.page.getByRole('button', { name:'Notifications, 1 unread', exact:true }).waitFor();
      await t.page.locator('[data-cal-options]').click();
      assert(!/Preview|Main admin|View as|Schedule messages/.test(await t.page.locator('.cal-dialog').innerText()));
      assert(t.calls.every(call => call.startsWith('GET ') || ['POST /api/announcements/open','POST /api/announcements/read'].includes(call)), 'Only personal announcement reading is recorded');
      checks.push({ role, actualRolePreserved:true, congregationOnly:true, unreadOnly:true, readPersistsOnReload:true, laterPostIsUnread:true }); await t.context.close();
    }
    const admin = await prepare({ role:'owner' });
    await admin.page.goto(origin + '/admin/calendar/'); await admin.page.locator('[data-cal-view]').waitFor();
    await admin.page.locator('[data-cal-view]').selectOption('viewer');
    await admin.page.locator('.cal-reader-heading [data-cal-view-notice]').waitFor();
    await admin.page.getByRole('button', { name:/^Notifications/ }).click();
    await admin.page.locator('.cal-dialog').waitFor(); await admin.page.keyboard.press('Escape');
    assert(admin.calls.every(call => call.startsWith('GET ')), 'The explicit admin preview still does not write reads or opens');
    await admin.page.locator('[data-cal-options]').click(); await admin.page.locator('[data-cal-view]').selectOption('owner');
    await admin.page.locator('.cal-admin-heading').waitFor(); await admin.context.close();
    checks.push({ adminPreviewRemainsReadOnly:true });
    for (const role of ['owner','editor']) {
      const back = await prepare({ role });
      await back.page.goto(origin + '/admin/calendar/'); await back.page.locator('.cal-brand [data-cal-add]:not([disabled])').waitFor();
      await back.page.getByRole('link', { name:'Schedule messages', exact:true }).click(); await back.page.locator('.tx-title').waitFor();
      assert.equal(await back.page.locator('a').count(), 1);
      await back.page.getByRole('link', { name:'Back to calendar', exact:true }).click();
      await back.page.locator('.cal-brand [data-cal-add]:not([disabled])').waitFor();
      assert.equal(await back.page.evaluate(() => JSON.parse(sessionStorage.getItem('lakewood-commons-calendar-session-v1')).user.role), role);
      assert.equal(await back.page.locator('[data-cal-access]').count(), role === 'owner' ? 1 : 0);
      checks.push({ role, messagesReturnKeepsSession:true }); await back.context.close();
    }
    const visitor = await prepare(); await visitor.page.goto(origin + '/texts/'); await visitor.page.locator('.tx-title').waitFor();
    await visitor.page.getByRole('link', { name:'Back to calendar', exact:true }).click();
    await visitor.page.getByRole('heading', { name:'Calendar sign in', exact:true }).waitFor();
    assert(!visitor.calls.some(call => call.includes('/api/events')), 'The return link cannot bypass calendar sign-in');
    checks.push({ messagesReturnRequiresSignIn:true }); await visitor.context.close();
    const login = await prepare(); await login.home(); await login.tap(3);
    await login.page.getByRole('heading', { name:'Calendar sign in', exact:true }).waitFor();
    await login.page.locator('[name=email]').fill('owner@example.test'); await login.page.locator('[name=password]').fill('Synthetic owner password 2026');
    await login.page.getByRole('button', { name:'Sign in', exact:true }).click();
    await login.page.locator('.cal-reader-heading').waitFor();
    assert.equal(await login.page.locator('[data-cal-view-notice],[data-cal-view]').count(), 0);
    checks.push({ ownerLoginResumesCongregationView:true }); await login.context.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors, output }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
