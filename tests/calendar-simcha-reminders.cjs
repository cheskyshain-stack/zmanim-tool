const test = require('node:test');
const assert = require('node:assert/strict');
const { createECDH, createHash, generateKeyPairSync, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const runtime = path.resolve(__dirname, '../worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
const origin = 'https://calendar.example.test';
const password = 'Synthetic calendar password 2026';
const vapid = JSON.stringify(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }));
function subscription(id) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/' + id, keys: { auth: randomBytes(16).toString('base64url'), p256dh: ecdh.getPublicKey('base64url') } };
}

function browserSite(getEndpoint) {
  const root = path.resolve(__dirname, '../dist');
  return http.createServer((request, response) => {
    const route = new URL(request.url, origin).pathname;
    if (route === '/data/calendar.json') {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ endpoint: getEndpoint() }));
    }
    let file = path.resolve(root, '.' + decodeURIComponent(route));
    if (!file.startsWith(root + path.sep) && file !== root) return response.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return response.writeHead(404).end();
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    return response.end(fs.readFileSync(file));
  });
}

async function checkPhoneControls(site, owner, viewer, device) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true });
  try {
    const pageAs = async session => {
      const context = await browser.newContext({ viewport: { width: 375, height: 720 } });
      await context.addInitScript(({ session, device }) => {
        localStorage.setItem('zmanim-nocount', '1');
        sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify(session));
        let current = null;
        window.calendarPushAttempts = 0;
        const registration = { active: true, pushManager: { getSubscription: async () => current,
          subscribe: async () => {
            window.calendarPushAttempts++;
            if (window.failCalendarPush) throw new DOMException('Push registration denied', 'NotAllowedError');
            return current = { endpoint: device.endpoint, toJSON: () => device, unsubscribe: async () => { current = null; return true; } };
          } } };
        navigator.serviceWorker.register = async () => registration;
        navigator.serviceWorker.getRegistration = async () => registration;
      }, { session, device });
      return context.newPage();
    };
    const reader = await pageAs(viewer);
    const pageCdp = await reader.context().newCDPSession(reader);
    const browserCdp = await browser.newBrowserCDPSession();
    const { targetInfo } = await pageCdp.send('Target.getTargetInfo');
    const setNotificationPermission = setting => browserCdp.send('Browser.setPermission', {
      permission: { name: 'notifications' }, setting, origin: new URL(site).origin, browserContextId: targetInfo.browserContextId,
    });
    await setNotificationPermission('denied');
    await reader.goto(site + '/admin/calendar/?preview=congregation');
    await reader.getByRole('button', { name: /^Notifications/ }).click();
    const notifications = reader.getByRole('dialog', { name: 'Notifications' });
    await notifications.getByRole('button', { name: 'Phone reminders', exact: true }).click();
    await notifications.waitFor({ state: 'detached' });
    const turnOn = reader.getByRole('button', { name: 'Turn on phone reminders' });
    await reader.getByText('Your browser reports that notifications for this site are blocked.').waitFor();
    await turnOn.click();
    await reader.getByText('The browser still blocks notifications.', { exact: false }).waitFor();
    assert.equal(await reader.evaluate(() => window.calendarPushAttempts), 0);

    await setNotificationPermission('prompt');
    await reader.evaluate(() => {
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
      Notification.requestPermission = () => new Promise(resolve => { window.answerCalendarPermission = resolve; });
    });
    await turnOn.click();
    await reader.getByText('Waiting for notification permission.', { exact: false }).waitFor();
    assert(await turnOn.isDisabled());
    await setNotificationPermission('granted');
    await reader.waitForFunction(() => Notification.permission === 'granted');
    await reader.evaluate(() => window.answerCalendarPermission('granted'));
    await reader.getByText('Notifications are allowed. Tap Turn on phone reminders once more to finish.').waitFor();
    assert.equal(await reader.evaluate(() => window.calendarPushAttempts), 0);

    await reader.evaluate(() => { delete navigator.userActivation; window.failCalendarPush = true; });
    await turnOn.click();
    await reader.getByText('The browser couldn’t register this phone for notifications. Push registration denied').waitFor();
    await reader.evaluate(() => { window.failCalendarPush = false; });
    await turnOn.click();
    await reader.getByText('Phone reminders are on for this device.').waitFor();
    await reader.getByRole('button', { name: 'Turn off phone reminders' }).click();
    await reader.getByRole('button', { name: 'Turn on phone reminders' }).waitFor();
    assert(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    const manager = await pageAs(owner);
    await manager.goto(site + '/admin/calendar/');
    await manager.locator('.cal-brand [data-cal-add]:not([disabled])').click();
    const form = manager.getByRole('dialog', { name: 'Add an event' });
    await form.getByLabel('Details').fill('Synthetic Shabbos simcha');
    await form.getByLabel('Date', { exact: true }).fill('2090-12-02');
    await form.getByLabel('Phone reminder').selectOption('day-of');
    await form.getByText('Friday, December 1, 2090 at 9:00 a.m. New York time. Shabbos reminders go out Friday morning.', { exact: true }).waitFor();
    await form.getByRole('button', { name: 'Save event' }).click();
    await form.waitFor({ state: 'detached' });
    await manager.goto(site + '/admin/calendar/?simcha=2090-12-02&post=1');
    await manager.getByRole('dialog', { name: 'Day details' }).getByText('Synthetic Shabbos simcha', { exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Post an announcement' }).click();
    await manager.getByRole('dialog', { name: 'Announcements' }).getByLabel('New announcement').waitFor();
    await manager.keyboard.press('Escape');
    await manager.locator('[data-cal-view]').selectOption('viewer');
    await manager.getByRole('button', { name: /^Notifications/ }).click();
    const previewSetup = manager.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: 'Phone reminders', exact: true });
    await previewSetup.waitFor();
    assert(await previewSetup.isDisabled(), 'View as Congregation shows the setup without changing device settings');
  } finally { await browser.close(); }
}

test('real Worker protects enrollment and lets a manager set, retain, and clear an event reminder', async () => {
  const setupToken = randomBytes(32).toString('hex');
  const bundle = await build({ entryPoints: [path.join(runtime, 'worker.js')], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
  let endpoint = '', host = origin;
  const server = process.env.CALENDAR_REMINDER_BROWSER === '1' ? browserSite(() => endpoint) : null;
  if (server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    host = 'http://127.0.0.1:' + server.address().port;
  }
  const backend = new Miniflare(convertV4MiniflareOptions({ name: 'simcha-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
    bindings: { ALLOWED_ORIGIN: host, BOOTSTRAP_SHA256: createHash('sha256').update(setupToken).digest('hex'), CALENDAR_REMINDER_VAPID: vapid },
    durableObjects: { CALENDAR: { className: 'CommunityCalendar', useSQLite: true } } }));
  try {
    const call = async (route, method = 'GET', body, token) => {
      const response = await backend.dispatchFetch('https://worker.example.test' + route, { method, headers: { Origin: host,
        ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const device = subscription('synthetic-device'), settings = '/api/phone-reminders';
    assert.equal((await call(settings, 'PUT', { subscription: device })).status, 401);
    const owner = (await call('/api/setup', 'POST', { setupToken, name: 'Test owner', email: 'owner@example.test', password })).body;
    const viewer = (await call('/api/register', 'POST', { name: 'Test viewer', email: 'viewer@example.test', password })).body;
    assert.match(owner.reminderPublicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.equal((await call('/api/info')).body.phoneReminders, true);
    assert.equal((await call(settings, 'PUT', { subscription: { ...device, endpoint: 'https://push.apple.com.evil.test/abc' } }, viewer.token)).status, 400);
    assert.equal((await call(settings, 'PUT', { subscription: device }, viewer.token)).body.enabled, true);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.enabled, true);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, owner.token)).body.enabled, false);
    assert.equal((await call(settings, 'DELETE', { endpoint: device.endpoint }, viewer.token)).body.enabled, false);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.enabled, false);
    const route = '/api/events/test-simcha';
    const fields = { title: 'Synthetic Kiddush', type: 'kiddush', date: '2090-12-02', revision: 0, reminder: 'day-before' };
    assert.equal((await call(route, 'PUT', fields, viewer.token)).status, 403);
    const created = await call(route, 'PUT', fields, owner.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.reminder, 'day-before');
    const { reminder, ...legacy } = created.body.event;
    const retained = await call(route, 'PUT', { ...legacy, title: 'Edited by older calendar client' }, owner.token);
    assert.equal(retained.body.event.reminder, reminder);
    const cleared = await call(route, 'PUT', { ...retained.body.event, reminder: '' }, owner.token);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.event.reminder, undefined);
    if (server) {
      endpoint = (await backend.ready).origin;
      await checkPhoneControls(host, owner, viewer, device);
    }
  } finally { await backend.dispose(); server?.close(); }
});

test('Friday delivery uses New York time, retries transient failures, and skips revoked devices', async () => {
  const { reminderKeys, reminderDeviceKey, runSimchaReminders, simchaReminderAt } = await import('../worker/calendar/simcha-reminders.js');
  assert.equal(new Date(simchaReminderAt({ date: '2027-03-14', reminder: 'day-of' })).toISOString(), '2027-03-14T13:00:00.000Z');
  assert.equal(new Date(simchaReminderAt({ date: '2026-11-01', reminder: 'day-of' })).toISOString(), '2026-11-01T14:00:00.000Z');
  const event = { date: '2026-11-14', reminder: 'day-of', createdBy: 'owner' };
  const morning = Date.parse('2026-11-13T14:00:00.000Z');
  assert.equal(simchaReminderAt(event), morning);
  const records = new Map([['event:simcha', event], ['user:owner', { id: 'owner', role: 'owner', active: true, version: 1 }],
    ['user:viewer', { id: 'viewer', role: 'viewer', active: true, version: 1 }], ['user:revoked', { id: 'revoked', role: 'viewer', active: false, version: 2 }]]);
  const storage = { get: key => records.get(key), put: (key, value) => records.set(key, value), delete: key => records.delete(key),
    list: ({ prefix, startAfter = '', limit = Infinity }) => new Map([...records].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)) };
  for (const userId of ['owner', 'viewer', 'revoked']) {
    const sub = subscription(userId);
    records.set(await reminderDeviceKey(sub.endpoint), { id: userId, userId, version: 1, subscription: sub });
  }
  const calls = [];
  const send = async (url, options) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Topic'), 'simcha-2026-11-13');
    assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
    const id = url.split('/').at(-1); calls.push(id);
    return new Response(null, { status: id === 'viewer' && calls.filter(value => value === id).length === 1 ? 503 : 201 });
  };
  const keys = reminderKeys(vapid);
  assert.equal(await runSimchaReminders(storage, keys, origin, morning - 1, send), morning);
  assert.deepEqual(calls, []);
  assert.equal(await runSimchaReminders(storage, keys, origin, morning, send), morning + 300000);
  assert.deepEqual(calls.sort(), ['owner', 'viewer']);
  await runSimchaReminders(storage, keys, origin, morning + 300000, send);
  await runSimchaReminders(storage, keys, origin, morning + 600000, send);
  assert.deepEqual(calls.sort(), ['owner', 'viewer', 'viewer']);
  await runSimchaReminders(storage, keys, origin, morning + 86400000, send);
  assert.equal(calls.length, 3, 'Shabbos itself does not send a second alert');
});

test('phone notification hides private text and opens the calendar day', async () => {
  const handlers = {};
  let notification, opened;
  const self = { location: { origin }, addEventListener: (type, handle) => { handlers[type] = handle; },
    registration: { showNotification: async (title, options) => { notification = { title, ...options }; } },
    clients: { matchAll: async () => [], openWindow: async url => { opened = url; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin/calendar/phone-reminders.js'), 'utf8'), { self, URL });
  let pending;
  handlers.push({ data: { json: () => ({ date: '2026-11-14', day: '2026-11-13', post: true, text: 'Private simcha details' }) }, waitUntil: work => { pending = work; } });
  await pending;
  assert.equal(notification.title, 'Simcha reminder');
  assert(!JSON.stringify(notification).includes('Private simcha details'));
  handlers.notificationclick({ notification: { ...notification, close() {} }, waitUntil: work => { pending = work; } });
  await pending;
  assert.equal(opened, origin + '/admin/calendar/?simcha=2026-11-14&post=1');
});
