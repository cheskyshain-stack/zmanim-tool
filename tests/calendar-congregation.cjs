// Build first. Only synthetic sessions and intercepted calendar records are used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), endpoint = 'https://calendar.example.test';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-congregation-'));
console.log('Calendar screenshots: ' + output);
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const types = ['shalom-zachor','kiddush','vort','aufruf','wedding','bar-mitzva-shabbos','bar-mitzva-dessert','custom'];

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.CONGREGATION_SITE || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless:true });
  const checks = [], errors = [], unexpected = [];
  try {
    for (const month of ['2026-11','2026-08','2027-05','2027-06','2028-04']) {
      const context = await browser.newContext({ viewport:{ width:375, height:640 }, serviceWorkers:'block' });
      await context.addInitScript(() => {
        try {
          localStorage.setItem('zmanim-nocount', '1');
          sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify({ token:'c'.repeat(64), expires:new Date('2299-01-01T00:00:00Z').getTime(), user:{ id:'fixture-viewer', role:'viewer', name:'Example viewer', email:'viewer@example.test', active:true } }));
        } catch { /* Initial opaque document. */ }
      });
      await context.route('**/data/calendar.json', route => route.fulfill({ contentType:'application/json', body:JSON.stringify({ endpoint }) }));
      const status = { total:1, unread:1, deletedCount:0, editCount:0, canPost:false, canEdit:false, canDelete:false };
      await context.route(endpoint + '/**', route => {
        const request = route.request(), url = new URL(request.url());
        const headers = { 'Access-Control-Allow-Origin':new URL(origin).origin, 'Access-Control-Allow-Headers':'Authorization,Content-Type', 'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
        let body;
        if (url.pathname === '/api/session') body = { user:{ id:'fixture-viewer', role:'viewer', name:'Example viewer', active:true } };
        else if (url.pathname === '/api/events' && request.method() === 'GET') {
          const events = [], date = new Date(url.searchParams.get('from') + 'T12:00:00Z');
          while (date.toISOString().slice(0, 10) <= url.searchParams.get('to')) {
            const iso = date.toISOString().slice(0, 10);
            if (date.getUTCDay() === 6) for (const [index, type] of [...types].reverse().entries()) events.push({ id:'fixture-' + iso + '-' + index, title:'Example event ' + index, description:'Details for example ' + index, type, customCategory:type === 'custom' ? 'Community learning' : '', date:iso, endDate:iso, allDay:true, revision:1, createdBy:'fixture-editor' });
            date.setUTCDate(date.getUTCDate() + 1);
          }
          body = { events };
        } else if (url.pathname === '/api/announcements/status') body = status;
        else if (['/api/announcements/open','/api/announcements'].includes(url.pathname)) body = { ...status, messages:[{ id:'fixture-announcement', text:'Example Shul announcement', sequence:1, createdAt:'2026-11-01T12:00:00Z', read:false, revision:1 }], nextBefore:null };
        else if (url.pathname === '/api/announcements/read') body = { ...status, unread:0 };
        else { unexpected.push(request.method() + ' ' + url.pathname); body = {}; }
        return route.fulfill({ status:200, headers, contentType:'application/json', body:JSON.stringify(body) });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.clock.setFixedTime(new Date(month + '-15T17:00:00Z'));
      await page.goto(origin + '/admin/calendar/');
      await page.locator('[data-cal-day]:not([disabled])').first().waitFor();
      for (const [width, height] of [[320,568],[375,640],[393,852],[768,1024],[1440,900],[844,390]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const geometry = await page.evaluate(() => {
          const box = element => { const r = element.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
          return { width:innerWidth, height:innerHeight, visualHeight:visualViewport?.height, readerHeight:document.querySelector('.is-cal-congregation').style.getPropertyValue('--cal-reader-height'), pageWidth:document.documentElement.scrollWidth, pageHeight:document.documentElement.scrollHeight,
            header:box(document.querySelector('.cal-editor-header')), calendar:box(document.querySelector('.shul-calendar')), controls:[...document.querySelectorAll('.cal-reader-heading button,.cal-reader-back,.cal-month-nav button,.cal-toolbar > button')].map(box),
            days:[...document.querySelectorAll('[data-cal-day]')].map(button => {
              const parsha = button.querySelector('.cal-parsha'), words = [];
              if (parsha && getComputedStyle(parsha).visibility !== 'hidden') {
                const text = parsha.firstChild;
                for (const word of parsha.textContent.matchAll(/\S+/g)) { const range = document.createRange(); range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length); words.push({ text:word[0], fragments:[...range.getClientRects()].map(r => ({ left:r.left, right:r.right, top:r.top, bottom:r.bottom })) }); }
              }
              const markers = button.querySelector('.cal-mobile-events');
              return { date:button.dataset.calDay, cell:box(button.closest('td')), english:box(button.querySelector('.cal-english-day')), hebrew:box(button.querySelector('.cal-hebrew-day')), words,
                markers:markers ? box(markers) : null, colors:markers ? [...markers.querySelectorAll('i')].map(box) : [], count:markers?.querySelector('.cal-event-total').textContent,
                countFits:!markers || markers.querySelector('.cal-event-total').scrollWidth <= markers.querySelector('.cal-event-total').clientWidth,
                facts:[...button.querySelectorAll('.cal-facts > span')].filter(label => getComputedStyle(label).visibility !== 'hidden').map(label => ({ text:label.textContent, ...box(label) })),
                label:parsha && getComputedStyle(parsha).visibility !== 'hidden' ? box(parsha) : null };
            }) };
        });
        assert(geometry.pageWidth <= width && geometry.pageHeight <= height, JSON.stringify({ month, width, height, reason:'Page does not scroll', visual:geometry.visualHeight, readerHeight:geometry.readerHeight, pageWidth:geometry.pageWidth, pageHeight:geometry.pageHeight, calendar:geometry.calendar }));
        assert.equal(geometry.header.height, width >= 760 ? 78 : 64, 'The shared Shul header stays visible');
        assert(Math.abs(geometry.calendar.top - geometry.header.bottom) <= 1 && geometry.calendar.bottom <= height + 1, 'Calendar fits below the Shul header');
        assert(geometry.days.every(day => day.cell.height <= 129), 'Month rows remain compact on tall screens');
        if (width === 393 && height === 852) assert(geometry.days.every(day => day.cell.height <= 77), 'Tall phones keep compact month rows');
        assert(geometry.controls.every(control => control.height >= 44 && control.left >= 0 && control.right <= width + 1), 'Navigation controls fit and retain 44px touch targets');
        for (const day of geometry.days) {
          assert(day.cell.bottom <= height + 1 && day.cell.right <= width + 1, JSON.stringify({ month, width, height, day }));
          for (const word of day.words) assert(word.fragments.length === 1 && word.fragments[0].left >= day.cell.left - 1 && word.fragments[0].right <= day.cell.right + 1, JSON.stringify({ reason:'Whole parsha words', month, width, height, day }));
          if (day.markers) {
            assert.equal(day.count, '8 events'); assert.equal(day.colors.length, 8);
            assert(day.countFits, 'The complete event count remains visible');
            assert(day.colors.every(color => color.width > 0 && color.height > 0));
            if (height > 460) assert(day.markers.bottom <= day.hebrew.top - 1, JSON.stringify({ reason:'Event markers clear Hebrew date', month, width, height, day }));
          }
          if (day.label) assert(day.label.bottom <= (day.markers?.top || day.hebrew.top) - 1, JSON.stringify({ reason:'Parsha clears event markers and dates', month, width, height, day }));
          for (const fact of day.facts) assert(fact.top >= day.english.bottom && fact.bottom <= (day.markers?.top || day.hebrew.top) - .5, JSON.stringify({ reason:'Holiday labels clear dates and events', month, width, height, day }));
        }
        await page.screenshot({ path:path.join(output, month + '-' + width + '-' + height + '.png'), fullPage:true });
        checks.push({ month, width, height, pageHeight:geometry.pageHeight, calendarHeight:geometry.calendar.height, days:geometry.days.length, wholeParshaWords:true, multipleEventColors:8 });
      }
      if (month === '2026-11') {
        await page.setViewportSize({ width:375, height:640 });
        await page.locator('[data-cal-step="1"]').click(); await page.locator('[data-cal-day="2026-12-31"]:not([disabled])').waitFor();
        assert(await page.locator('[data-cal-step="1"]').isDisabled());
        assert(await page.locator('[data-cal-day="2027-01-01"]').isDisabled());
        await page.locator('[data-cal-day="2026-12-31"]').click(); await page.keyboard.press('Escape');
        await page.locator('[data-cal-day="2026-12-31"]').focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('[data-cal-day][aria-pressed="true"]').getAttribute('data-cal-day'), '2026-12-31');
        await page.locator('[data-cal-jump]').click();
        assert.equal(await page.locator('[name=month]').getAttribute('min'), '2026-10'); assert.equal(await page.locator('[name=month]').getAttribute('max'), '2026-12');
        await page.locator('[name=month]').fill('2027-01'); await page.locator('.cal-dialog form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable:true, bubbles:true })));
        await page.getByText('Choose last month, this month or next month.', { exact:true }).waitFor(); await page.keyboard.press('Escape');
        await page.locator('[data-cal-today]').click(); await page.locator('[data-cal-day="2026-11-15"]:not([disabled])').waitFor();
        const saturday = page.locator('td.cal-shabbos:not(.cal-outside) [data-cal-day]').first();
        await saturday.click(); await page.locator('.cal-dialog .cal-event-card').first().waitFor(); assert.equal(await page.locator('.cal-dialog .cal-event-card').count(), 8);
        assert.deepEqual(await page.locator('.cal-dialog .cal-event-card').evaluateAll(nodes => nodes.map(node => [...node.classList].find(name => name.startsWith('cal-type-')).slice(9))), types, 'Day details automatically group event types');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name:/^Notifications/ }).click(); await page.getByText('Example Shul announcement', { exact:true }).waitFor(); await page.keyboard.press('Escape');
        await page.locator('[data-cal-options]').click(); assert.equal(await page.getByRole('link', { name:'Schedule messages', exact:true }).count(), 0); assert.equal(await page.locator('.cal-dialog .cal-legend > span').count(), 8); await page.keyboard.press('Escape');
        await page.locator('[data-cal-step="-1"]').click(); await page.locator('[data-cal-day="2026-10-01"]:not([disabled])').waitFor(); assert(await page.locator('[data-cal-step="-1"]').isDisabled());
        await page.clock.setFixedTime(new Date('2026-12-01T17:00:00Z')); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.locator('[data-cal-day="2026-12-01"]:not([disabled])').waitFor();
        await page.getByRole('link', { name:'Back to congregation page' }).click(); await page.locator('.luach-coming-soon-card').waitFor(); assert.equal(new URL(page.url()).pathname, '/');
        assert(await page.getByRole('button', { name:'Community calendar, coming soon' }).isDisabled());
        assert.equal(await page.locator('.luach-coming-soon-card').evaluate(card => getComputedStyle(card).backgroundColor), 'rgb(236, 238, 239)');
        for (const width of [320,375,393,1440]) { await page.setViewportSize({ width, height:900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path:path.join(output, 'home-coming-soon-' + width + '.png'), fullPage:true }); }
        await page.goBack(); await page.locator('[data-cal-options]').waitFor(); await page.locator('[data-cal-options]').click(); await page.getByRole('button', { name:'Sign out', exact:true }).click();
        await page.getByRole('heading', { name:'Calendar sign in', exact:true }).waitFor();
        assert.equal(await page.locator('body').evaluate(body => body.classList.contains('cal-reader-page')), false, 'Signing out restores normal sign-in page scrolling');
        await context.route(endpoint + '/api/session', route => {
          const headers = { 'Access-Control-Allow-Origin':new URL(origin).origin, 'Access-Control-Allow-Headers':'Authorization,Content-Type', 'Access-Control-Allow-Methods':'GET,OPTIONS' };
          return route.fulfill({ status:route.request().method() === 'OPTIONS' ? 204 : 200, headers, contentType:'application/json', body:route.request().method() === 'OPTIONS' ? '' : JSON.stringify({ user:{ id:'fixture-owner', role:'owner', name:'Example owner', active:true } }) });
        });
        await page.evaluate(() => {
          localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at:Date.now() }));
          sessionStorage.setItem('lakewood-commons-calendar-session-v1', JSON.stringify({ token:'c'.repeat(64), expires:new Date('2299-01-01T00:00:00Z').getTime(), user:{ id:'fixture-owner', role:'owner', name:'Example owner', active:true } }));
        });
        await page.goto(origin + '/admin/#calendar'); await page.locator('.cal-brand [data-cal-add]:not([disabled])').waitFor();
        await page.locator('[data-cal-view]').selectOption('viewer'); await page.locator('.is-cal-congregation [data-cal-day]:not([disabled])').first().waitFor();
        const preview = await page.locator('.shul-calendar').boundingBox(); assert(preview.y + preview.height <= 901, 'Congregation preview fits below the main admin controls');
        await page.locator('[data-cal-options]').click(); await page.locator('[data-cal-view]').selectOption('owner');
        assert(await page.locator('[data-cal-access]').isVisible()); assert.equal(await page.locator('.is-cal-congregation').count(), 0);
      }
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, unexpected }, null, 2));
    console.log(JSON.stringify({ passed:true, geometryChecks:checks.length, errors, productionMutations:0, output }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error.stack); server.close(); process.exitCode = 1; });
