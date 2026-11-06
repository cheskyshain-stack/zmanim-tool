const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'statistics-schedules-'));
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.STATISTICS_SITE || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = [], checks = [], activityQueries = [];
  const makeContext = async role => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(role => {
      if (!/^https?:$/.test(location.protocol)) return;
      try {
        localStorage.setItem('zmanim-nocount', '1'); localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        window.calendarOpenEvents = 0; addEventListener('zmanim-calendar-open', () => { window.calendarOpenEvents++; });
        if (role) sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify({ token: 'e'.repeat(64), expires: Date.now() + 86400000, user: { id: 'fixture-' + role, role, name: 'Example ' + role, email: role + '@example.test', active: true } }));
      } catch { /* Sandboxed third-party frames have no storage. */ }
    }, role);
    ctx.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', value => { if (value.type() === 'error') errors.push(value.text()); }); });
    const fulfill = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }, body: JSON.stringify(body) });
    await ctx.route('https://zmanim-calendar.cheskyshain.workers.dev/**', route => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
      if (url.pathname === '/api/activity' && req.method() === 'GET' && role === 'owner') {
        activityQueries.push(url.search); const start = url.searchParams.get('start'), end = url.searchParams.get('end'), snapshotAt = url.searchParams.get('asOf'), old = start < '2026-01-01';
        return fulfill(route, { schemaVersion: 1, timezone: 'America/New_York', range: { start, end }, snapshotAt, startedAt: '2026-11-05T12:00:00Z', coverage: old ? 'not-tracked' : 'partial', counts: Object.fromEntries(['signIns', 'registrations', 'eventsCreated', 'eventsEdited', 'eventsDeleted', 'announcementsPosted', 'announcementsDeleted', 'announcementOpens'].map((key, i) => [key, old ? 0 : i + 2])) });
      }
      if (url.pathname === '/api/session' && req.method() === 'GET') return fulfill(route, { user: { id: 'fixture-' + role, role, name: 'Example ' + role, email: role + '@example.test', active: true } });
      if (url.pathname === '/api/events' && req.method() === 'GET') return fulfill(route, { events: [] });
      if (url.pathname === '/api/announcements/status' && req.method() === 'GET') return fulfill(route, { total: 0, unread: 0, deletedCount: 0, canPost: role !== 'viewer', canDelete: role !== 'viewer' });
      throw new Error('Unexpected calendar request: ' + req.method() + ' ' + url.pathname);
    });
    await ctx.route('https://zmanim-traffic.cheskyshain.workers.dev/**', route => {
      const q = new URL(route.request().url()).searchParams, start = q.get('start'), end = q.get('end'), asOf = q.get('asOf');
      const dates = []; for (let date = start; date <= end; date = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) dates.push(date);
      const rows = [{ key: '/', views: 10, visits: 3 }, { key: '/seats/', views: 2, visits: 0 }, { key: '/admin/calendar/', views: 4, visits: 1 }, { key: '/texts/', views: 3, visits: 1 }, { key: '/admin/', views: 1, visits: 0 }];
      return fulfill(route, { schemaVersion: 2, timezone: 'America/New_York', range: { start, end, since: start + 'T05:00:00.000Z', until: asOf }, snapshotAt: asOf, fetchedAt: asOf, totals: { views: 20, visits: 5 }, byDay: dates.map((date, i) => ({ date, views: i ? 0 : 20, visits: i ? 0 : 5, status: 'complete' })), groups: { page: { status: 'complete', rows } }, coverage: { status: 'complete', detailStatus: 'complete', coveredHours: dates.length * 24, expectedHours: dates.length * 24 }, collection: { status: 'ok', errors: [] } });
    });
    return ctx;
  };
  try {
    let ctx = await makeContext('owner'), page = await ctx.newPage();
    await page.goto(origin + '/admin/#traffic'); await page.locator('.traffic-activity-grid dd').first().waitFor();
    assert.equal(await page.locator('.traffic-activity-grid dd').count(), 8);
    assert((await page.locator('#traffic-body').innerText()).includes('Calendar'));
    for (const width of [375, 393, 1440]) {
      await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, 'statistics-' + width + '.png'), fullPage: true }); checks.push({ statistics: width });
    }
    await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.locator('.traffic-activity-grid dd').first().waitFor();
    const todayQuery = new URLSearchParams(activityQueries.at(-1)); assert.equal(todayQuery.get('start'), todayQuery.get('end'));
    const heldSnapshot = todayQuery.get('asOf');
    await page.getByRole('button', { name: '7 days', exact: true }).click(); await page.locator('.traffic-activity-grid dd').first().waitFor(); assert.equal(new URLSearchParams(activityQueries.at(-1)).get('asOf'), heldSnapshot);
    await page.locator('#traffic-range-form [name=start]').fill('2020-01-01'); await page.locator('#traffic-range-form [name=end]').fill('2020-01-01'); await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.traffic-activity-grid dd')].length === 8 && [...document.querySelectorAll('.traffic-activity-grid dd')].every(node => node.textContent === 'Not tracked'));
    await page.goto(origin + '/admin/calendar/'); await page.locator('.shul-calendar').waitFor();
    assert.equal(await page.evaluate(() => window.calendarOpenEvents), 1);
    await page.locator('[data-cal-step="1"]').click(); await page.locator('[data-cal-step="-1"]').click();
    assert.equal(await page.evaluate(() => window.calendarOpenEvents), 1, 'Month changes never count extra page opens');
    await page.goto(origin + '/admin/calendar/?invitation-test=1#invite=synthetic-private-invitation'); await page.getByRole('heading', { name: 'Choose your calendar password', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, ''); assert.equal(await page.evaluate(() => window.calendarOpenEvents), 0, 'Invitation forms do not start analytics before account access');
    await ctx.close();
    const ownerRequests = activityQueries.length; ctx = await makeContext('viewer'); page = await ctx.newPage();
    await page.goto(origin + '/admin/#traffic'); await page.locator('#traffic-calendar-activity a[href="#calendar"]').waitFor(); assert.equal(activityQueries.length, ownerRequests); assert.equal(await page.locator('.traffic-activity-grid').count(), 0); await ctx.close();
    ctx = await makeContext(null); page = await ctx.newPage();
    for (const width of [375, 393, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.clock.setFixedTime(new Date('2026-08-01T15:00:00Z'));
      await page.goto(origin + '/schedules/'); await page.locator('.luach-menu').waitFor();
      assert.equal(new URL(page.url()).pathname, '/'); assert.equal(new URL(await page.locator('link[rel=canonical]').getAttribute('href')).pathname, '/'); assert((await page.title()).includes('Lakewood Commons Shul'));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(output, 'empty-schedules-home-' + width + '.png'), fullPage: true });
      await page.goto(origin + '/#schedules'); await page.locator('.luach-menu').waitFor(); assert.equal(new URL(page.url()).hash, ''); assert.equal(new URL(page.url()).pathname, '/'); checks.push({ emptySchedules: width });
    }
    await page.goto(origin + '/schedules/?website-preview=2026-08-01T15%3A00%3A00.000Z'); await page.locator('.luach-menu').waitFor(); assert.equal(new URL(page.url()).pathname, '/'); assert.equal(new URL(page.url()).searchParams.get('website-preview'), '2026-08-01T15:00:00.000Z');
    await page.goto(origin + '/schedules/?website-preview=2026-12-20T15%3A00%3A00.000Z'); await page.locator('.luach-sheets .poster').first().waitFor(); assert.equal(new URL(page.url()).pathname, '/schedules/');
    await page.goto(origin + '/week/'); await page.locator('#week-host').waitFor();
    await page.evaluate(() => { history.pushState(null, '', '/schedules/'); dispatchEvent(new PopStateEvent('popstate')); }); await page.locator('.luach-menu').waitFor();
    await page.goBack(); await page.locator('#week-host').waitFor(); await page.goForward(); await page.locator('.luach-menu').waitFor(); assert.equal(new URL(page.url()).pathname, '/');
    await page.clock.setFixedTime(new Date('2026-12-21T04:59:00Z')); await page.goto(origin + '/schedules/'); await page.locator('.luach-sheets .poster').first().waitFor();
    await page.clock.setFixedTime(new Date('2026-12-21T05:01:00Z')); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.locator('.luach-menu').waitFor(); assert.equal(new URL(page.url()).pathname, '/');
    await ctx.close(); assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, activityQueries, productionMutations: 0 }, null, 2)); console.log(JSON.stringify({ passed: true, checks, errors, output }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
