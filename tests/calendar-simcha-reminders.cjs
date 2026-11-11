const test = require('node:test');
const assert = require('node:assert/strict');
const { createECDH, createHash, generateKeyPairSync, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const runtime = path.resolve(__dirname, '../worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
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
        window.seedStaleReminder = () => {
          current = { endpoint: device.endpoint + '-stale', unsubscribe: async () => { current = null; return true; } };
        };
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
    await reader.getByRole('button', { name: /^Messages/ }).click();
    const messages = reader.getByRole('dialog', { name: 'Messages' });
    await messages.getByRole('button', { name: 'Phone reminders', exact: true }).click();
    await messages.waitFor({ state: 'detached' });
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
    await reader.getByRole('button', { name: 'Send test alert' }).click();
    await reader.getByText('Test alert accepted.', { exact: false }).waitFor();
    await reader.getByText('No upcoming simcha alerts are scheduled for this phone.', { exact: true }).waitFor();
    const sameTime = reader.getByRole('switch', { name: 'All the same' });
    const modeLabel = reader.locator('.cal-reminder-toggle');
    const categories = reader.getByRole('group', { name: 'Simcha categories', exact: true });
    const save = reader.getByRole('button', { name: 'Save reminder times' });
    const saved = reader.getByText('Reminder times saved for this phone.');
    const reminderTime = reader.getByLabel('Reminder time', { exact: true });
    assert(await sameTime.isChecked());
    assert(await categories.isHidden());
    assert.equal(await reminderTime.inputValue(), '09:00');
    await reminderTime.fill('10:15');
    await modeLabel.click();
    await categories.waitFor();
    for (const width of [375, 393]) {
      await reader.setViewportSize({ width, height: 720 });
      const geometry = await categories.locator('.cal-reminder-time').evaluateAll(rows => rows.map(row => {
        const label = row.querySelector('label'), time = row.querySelector('input').getBoundingClientRect();
        const panel = row.closest('dialog');
        return { label: label.textContent, fits: label.getBoundingClientRect().right <= time.left && time.right <= panel.getBoundingClientRect().right && time.height >= 44 && panel.scrollWidth <= panel.clientWidth };
      }));
      assert.deepEqual(geometry.map(row => row.label), ['Shalom Zachor', 'Kiddush', 'Vort', 'Aufruf', 'Chasuna', 'Bar mitzva shabbos', 'Bar mitzva dessert']);
      assert(geometry.every(row => row.fits), `Every reminder label and time input fit side by side at ${width}px`);
    }
    const vort = categories.locator('[data-reminder-rule=vort]');
    const kiddush = categories.getByLabel('Kiddush', { exact: true });
    assert.equal(await kiddush.inputValue(), '10:15', 'New category rows use the shared time');
    await kiddush.fill('11:30');
    await vort.getByLabel('Vort', { exact: true }).fill('16:00');
    await vort.locator('summary').click();
    await vort.getByLabel('Weekday reminder').selectOption('day-before');
    await vort.getByLabel('Friday time (optional)').fill('08:30');
    await save.click();
    await saved.waitFor();
    await modeLabel.click();
    await save.click();
    await saved.waitFor();
    await reader.keyboard.press('Escape');
    await reader.getByRole('button', { name: /^Messages/ }).click();
    await messages.getByRole('button', { name: 'Phone reminders', exact: true }).click();
    await sameTime.waitFor();
    assert(await sameTime.isChecked());
    assert.equal(await reminderTime.inputValue(), '10:15');
    await modeLabel.click();
    assert.equal(await vort.getByLabel('Vort', { exact: true }).inputValue(), '16:00');
    assert.equal(await kiddush.inputValue(), '11:30');
    await vort.locator('summary').click();
    assert.equal(await vort.getByLabel('Weekday reminder').inputValue(), 'day-before');
    assert.equal(await vort.getByLabel('Friday time (optional)').inputValue(), '08:30');
    await reader.getByRole('button', { name: 'Turn off phone reminders' }).click();
    await reader.getByRole('button', { name: 'Turn on phone reminders' }).waitFor();
    await reader.keyboard.press('Escape');
    await reader.evaluate(() => window.seedStaleReminder());
    await reader.getByRole('button', { name: /^Messages/ }).click();
    await messages.getByRole('button', { name: 'Phone reminders', exact: true }).click();
    await reader.getByRole('button', { name: 'Reconnect phone reminders' }).click();
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
    assert.equal(await form.getByLabel('Phone reminder').inputValue(), 'schedule');
    await form.getByText('Default reminder is Friday, December 1, 2090 at 9:00 a.m. New York time.', { exact: false }).waitFor();
    await form.getByRole('button', { name: 'Save event' }).click();
    await form.waitFor({ state: 'detached' });
    await manager.goto(site + '/admin/calendar/?simcha=2090-12-02&post=1');
    await manager.getByRole('dialog', { name: 'Day details' }).getByText('Synthetic Shabbos simcha', { exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Post an announcement' }).click();
    await manager.getByRole('dialog', { name: 'Announcements' }).getByLabel('New announcement').waitFor();
    await manager.keyboard.press('Escape');
    await manager.locator('[data-cal-view]').selectOption('viewer');
    await manager.getByRole('button', { name: /^Messages/ }).click();
    const previewSetup = manager.getByRole('dialog', { name: 'Messages' }).getByRole('button', { name: 'Phone reminders', exact: true });
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
  let providerStatus = 201, pushes = 0;
  const backend = new Miniflare(convertV4MiniflareOptions({ name: 'simcha-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
    bindings: { ALLOWED_ORIGIN: host, BOOTSTRAP_SHA256: createHash('sha256').update(setupToken).digest('hex'), CALENDAR_REMINDER_VAPID: vapid },
    durableObjects: { CALENDAR: { className: 'CommunityCalendar', useSQLite: true } },
    outboundService: async request => {
      assert.equal(new URL(request.url).hostname, 'fcm.googleapis.com');
      assert.equal(request.headers.get('content-encoding'), 'aes128gcm');
      pushes++;
      return new WorkerResponse(null, { status: providerStatus });
    },
  }));
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
    assert.equal((await call('/api/info')).body.phoneReminderTest, true);
    assert.equal((await call(settings, 'PUT', { subscription: { ...device, endpoint: 'https://push.apple.com.evil.test/abc' } }, viewer.token)).status, 400);
    assert.equal((await call(settings, 'PUT', { subscription: device }, viewer.token)).body.enabled, true);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.enabled, true);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, owner.token)).body.enabled, false);
    assert.equal((await call(settings + '/test', 'POST', { endpoint: device.endpoint })).status, 401);
    assert.equal((await call(settings + '/test', 'POST', { endpoint: device.endpoint }, owner.token)).status, 409);
    assert.equal(pushes, 0);
    providerStatus = 410;
    assert.deepEqual((await call(settings + '/test', 'POST', { endpoint: device.endpoint }, viewer.token)).body, { accepted: false, status: 410, expired: false });
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.enabled, true, 'A fresh registration is given time to settle');
    providerStatus = 201;
    assert.equal((await call(settings + '/test', 'POST', { endpoint: device.endpoint }, viewer.token)).body.accepted, true);
    assert.equal(pushes, 2);
    const schedule = { endpoint: device.endpoint, schedule: { revision: 0, standard: { day: 'day-of', time: '10:45' }, categories: {} } };
    assert.equal((await call(settings + '/schedule', 'PUT', schedule)).status, 401);
    assert.equal((await call(settings + '/schedule', 'PUT', schedule, owner.token)).status, 403);
    assert.equal((await call(settings + '/schedule', 'PUT', schedule, viewer.token)).body.schedule.standard.time, '10:45');
    assert.equal((await call(settings + '/schedule', 'PUT', schedule, viewer.token)).status, 409);
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.schedule.revision, 1);
    const replacement = subscription('replacement-device');
    assert.equal((await call(settings, 'PUT', { subscription: replacement, previousEndpoint: device.endpoint }, viewer.token)).body.schedule.standard.time, '10:45');
    assert.equal((await call(settings + '/status', 'POST', { endpoint: device.endpoint }, viewer.token)).body.enabled, false);
    assert.equal((await call(settings, 'DELETE', { endpoint: replacement.endpoint }, viewer.token)).body.enabled, false);
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

test('the Workerd alarm delivers Web Push and does not follow provider redirects', { timeout: 15000 }, async () => {
  const accepted = subscription('accepted-device'), redirected = subscription('redirected-device'), expired = subscription('expired-device'), outbound = [];
  const contents = `
    import worker, { CommunityCalendar } from './worker.js';
    import { reminderDeviceKey } from './simcha-reminders.js';
    import { calendarReminderShabbos } from '../../js/calendar/reminder-date.js';
    import { civilDate, shiftDate, TIMEZONE } from '../traffic-calendar.js';
    export default worker;
    export class ReminderTestCalendar extends CommunityCalendar {
      async route(request) {
        const storage = this.ctx.storage;
        const devices = this.env.TEST_DEVICES;
        if (request.method === 'POST') {
          const at = Date.now() - 60000;
          const date = civilDate(at), saturday = calendarReminderShabbos(date);
          const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(at);
          await storage.put({
            'user:reader': { active: true, version: 1, role: 'viewer' },
            'event:kiddush': { date: saturday ? shiftDate(date, 1) : date, type: 'kiddush', reminder: 'schedule' },
          });
          for (const subscription of devices) {
            const key = await reminderDeviceKey(subscription.endpoint);
            await storage.put(key, { id: key, userId: 'reader', version: 1, subscription,
              reminderSchedule: { categories: {}, standard: { day: saturday ? 'day-before' : 'day-of', time } } });
          }
          await storage.setAlarm(Date.now());
        }
        const delivered = await storage.get(await reminderDeviceKey(devices[0].endpoint));
        const refused = await storage.get(await reminderDeviceKey(devices[1].endpoint));
        const expired = await storage.get(await reminderDeviceKey(devices[2].endpoint));
        return Response.json({ sent: delivered?.lastDelivery?.status === 201 && delivered?.sentSlots?.length === 1,
          retry: Object.keys(refused?.reminderRetries || {}).length === 1, expired: !!expired?.expiredAt && expired.lastDelivery.status === 410 });
      }
    }
  `;
  const bundle = await build({ stdin: { contents, resolveDir: runtime, sourcefile: 'alarm-fixture.js' }, bundle: true,
    format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
  const backend = new Miniflare(convertV4MiniflareOptions({ name: 'calendar-push-alarm-test', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
    bindings: { ALLOWED_ORIGIN: origin, CALENDAR_REMINDER_VAPID: vapid, TEST_DEVICES: [accepted, redirected, expired] },
    durableObjects: { CALENDAR: { className: 'ReminderTestCalendar', useSQLite: true } },
    outboundService: async request => {
      outbound.push({ url: request.url, method: request.method, encoding: request.headers.get('content-encoding') });
      if (request.url === redirected.endpoint) return new WorkerResponse(null, { status: 302, headers: { Location: 'https://redirect.example.test/' } });
      if (request.url === expired.endpoint) return new WorkerResponse(null, { status: 410 });
      return new WorkerResponse(null, { status: 201 });
    },
  }));
  try {
    const call = async method => {
      const response = await backend.dispatchFetch('https://worker.example.test/alarm-fixture', { method, headers: { Origin: origin } });
      assert.equal(response.status, 200);
      return response.json();
    };
    let result = await call('POST');
    for (let count = 0; count < 50 && (!result.sent || !result.retry || !result.expired); count++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      result = await call('GET');
    }
    assert.deepEqual(result, { sent: true, retry: true, expired: true });
    assert.deepEqual(outbound.sort((a, b) => a.url.localeCompare(b.url)), [accepted, expired, redirected].map(({ endpoint }) => ({
      url: endpoint, method: 'POST', encoding: 'aes128gcm',
    })));
  } finally { await backend.dispose(); }
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
    assert.equal(headers.get('Topic'), 'simcha-' + morning);
    assert.equal(headers.get('Urgency'), 'high');
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

test('shared and individual phone schedules deliver at their active times', async () => {
  const { nextSimchaReminder, reminderKeys, reminderDeviceKey, runSimchaReminders, simchaReminderAt } = await import('../worker/calendar/simcha-reminders.js');
  const standard = { day: 'day-of', time: '11:00' };
  const categories = { vort: { day: 'day-before', time: '18:00', fridayTime: '08:30' } };
  const schedule = { standard, categories };
  const vort = { type: 'vort', date: '2026-11-12', reminder: 'schedule' };
  const kiddush = { type: 'kiddush', date: '2026-11-12', reminder: 'schedule' };
  const shabbos = { ...vort, date: '2026-11-14' };
  const off = { ...kiddush, reminder: undefined };
  const morning = Date.parse('2026-11-12T14:00:00Z');
  const before = Date.parse('2026-11-11T23:00:00Z');
  const lateMorning = Date.parse('2026-11-12T16:00:00Z');
  const friday = Date.parse('2026-11-13T13:30:00Z');
  const defaultFriday = Date.parse('2026-11-13T14:00:00Z');
  const sharedFriday = Date.parse('2026-11-13T16:00:00Z');
  assert.equal(simchaReminderAt(vort, schedule), before);
  assert.equal(simchaReminderAt(shabbos, schedule), friday);
  assert.equal(simchaReminderAt(shabbos, { ...schedule, sameTime: true }), sharedFriday);
  assert.equal(simchaReminderAt(off, schedule), Infinity);
  const early = { ...kiddush, date: '2027-03-14' };
  const repeated = { ...kiddush, date: '2026-11-01' };
  assert.equal(new Date(simchaReminderAt(early, { standard: { day: 'day-of', time: '02:30' }, categories: {} })).toISOString(), '2027-03-14T07:30:00.000Z');
  assert.equal(new Date(simchaReminderAt(repeated, { standard: { day: 'day-of', time: '01:30' }, categories: {} })).toISOString(), '2026-11-01T05:30:00.000Z');
  const records = new Map([['event:vort', vort], ['event:kiddush', kiddush], ['event:shabbos', shabbos], ['event:off', off],
    ['user:reader', { id: 'reader', role: 'viewer', active: true, version: 1 }]]);
  const storage = { get: key => records.get(key), put: (key, value) => records.set(key, value),
    list: ({ prefix }) => new Map([...records].filter(([key]) => key.startsWith(prefix))) };
  assert.equal(await nextSimchaReminder(storage, schedule, before - 1), before);
  assert.equal(await nextSimchaReminder(storage, null, before), morning);
  for (const id of ['default', 'customized', 'shared']) {
    const sub = subscription(id);
    records.set(await reminderDeviceKey(sub.endpoint), { id, userId: 'reader', version: 1, subscription: sub,
      reminderSchedule: id === 'shared' ? { ...schedule, sameTime: true } : id === 'customized' ? schedule : undefined });
  }
  const delivered = [];
  const send = async (url, options) => {
    delivered.push([url.split('/').at(-1), new Headers(options.headers).get('Topic')]);
    return new Response(null, { status: 201 });
  };
  const keys = reminderKeys(vapid);
  assert.equal(await runSimchaReminders(storage, keys, origin, before - 1, send), before);
  for (const at of [before, morning, morning + 1000, lateMorning, friday, defaultFriday, sharedFriday]) await runSimchaReminders(storage, keys, origin, at, send);
  assert.deepEqual(delivered.sort(), [['customized', 'simcha-' + before], ['default', 'simcha-' + morning], ['customized', 'simcha-' + lateMorning],
    ['shared', 'simcha-' + lateMorning], ['customized', 'simcha-' + friday], ['default', 'simcha-' + defaultFriday], ['shared', 'simcha-' + sharedFriday]].sort());
});

test('phone notification hides private text and opens the calendar day', async () => {
  const handlers = {};
  let notification, opened;
  const self = { location: { origin }, addEventListener: (type, handle) => { handlers[type] = handle; },
    registration: { showNotification: async (title, options) => { notification = { title, ...options }; } },
    clients: { matchAll: async () => [], openWindow: async url => { opened = url; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin/calendar/phone-reminders.js'), 'utf8'), { self, URL });
  let pending;
  const slot = Date.parse('2026-11-13T14:00:00Z');
  handlers.push({ data: { json: () => ({ date: '2026-11-14', day: '2026-11-13', slot, post: true, text: 'Private simcha details' }) }, waitUntil: work => { pending = work; } });
  await pending;
  assert.equal(notification.title, 'Simcha reminder');
  assert.equal(notification.tag, 'simcha-' + slot);
  assert(!JSON.stringify(notification).includes('Private simcha details'));
  handlers.notificationclick({ notification: { ...notification, close() {} }, waitUntil: work => { pending = work; } });
  await pending;
  assert.equal(opened, origin + '/admin/calendar/?simcha=2026-11-14&post=1');
  handlers.push({ data: { json: () => ({ test: true }) }, waitUntil: work => { pending = work; } });
  await pending;
  assert.equal(notification.title, 'Calendar test alert');
  assert.equal(notification.data, origin + '/admin/calendar/');
});
