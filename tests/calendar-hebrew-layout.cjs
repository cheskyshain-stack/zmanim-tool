// Build first. Verify the two supplied reference months using real cell geometry.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.CALENDAR_HEBREW_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-hebrew-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/data/calendar.json') { res.setHeader('Content-Type', 'application/json'); return res.end('{"endpoint":""}'); }
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
  const checks = [], errors = [];
  try {
    for (const width of [320, 375, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        try {
          localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
          localStorage.setItem('zmanim-nocount', '1');
          const events = ['2028-04-18', '2027-12-30'].flatMap(date => Array.from({ length: 8 }, (_, index) => ({
            id: 'reference-' + date + '-' + index, date, endDate: date, title: 'אירוע לדוגמה עם כותרת ארוכה ' + index,
            type: ['custom', 'shalom-zachor', 'bar-mitzva-shabbos', 'bar-mitzva-dessert', 'kiddush', 'wedding', 'bar-mitzvah', 'announcement'][index], customCategory: index === 0 ? 'A'.repeat(60) : '', allDay: true, revision: 1,
          })));
          localStorage.setItem('lakewood-commons-calendar-preview-v1', JSON.stringify({ version: 1, events }));
        } catch { /* Initial opaque documents cannot use site storage. */ }
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port + '/admin/#calendar');
      await page.locator('.shul-calendar').waitFor();
      for (const month of ['2028-04', '2027-12']) {
        await page.locator('[data-cal-jump]').click(); await page.locator('.cal-dialog [name=month]').fill(month);
        await page.getByRole('button', { name: 'Show month', exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        assert(!/[a-z]/i.test(await page.locator('.cal-month-nav p').innerText()));
        assert.equal(await page.locator('.cal-month-nav p').getAttribute('dir'), 'rtl');
        const measured = await page.locator('[data-cal-day]').evaluateAll(buttons => buttons.map(button => {
          const cell = button.closest('td').getBoundingClientRect(), en = button.querySelector('.cal-english-day').getBoundingClientRect();
          const he = button.querySelector('.cal-hebrew-day').getBoundingClientRect(), facts = button.querySelector('.cal-facts');
          const event = button.querySelector(innerWidth <= 700 ? '.cal-mobile-events' : '.cal-grid-events');
          return { date: button.dataset.calDay, enLeft: en.left - cell.left, enTop: en.top - cell.top,
            heRight: cell.right - he.right, heBottom: cell.bottom - he.bottom,
            factsGap: facts.innerText ? he.top - facts.getBoundingClientRect().bottom : null,
            eventsGap: event?.innerText ? he.top - event.getBoundingClientRect().bottom : null,
            facts: facts.innerText, hebrew: button.querySelector('.cal-hebrew-day').innerText };
        }));
        for (const day of measured) {
          assert(day.enLeft >= 0 && day.enLeft < 13 && day.enTop >= 0 && day.enTop < 13, JSON.stringify({ width, day, reason: 'English date at top left' }));
          assert(day.heRight >= 0 && day.heRight < 11 && day.heBottom >= 0 && day.heBottom < 11, JSON.stringify({ width, day, reason: 'Hebrew date at bottom right' }));
          assert(day.factsGap === null || day.factsGap >= 2, JSON.stringify({ width, day, reason: 'Holiday text clears Hebrew date' }));
          assert(day.eventsGap === null || day.eventsGap >= 2, JSON.stringify({ width, day, reason: 'Events clear Hebrew date' }));
          assert(!/[a-z]/i.test(day.facts), 'All built-in day labels use Hebrew');
          assert(!/[׳״]/.test(day.hebrew), 'Compact Hebrew day numbers follow the reference');
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, month + '-' + width + '.png'), fullPage: true });
        const target = month === '2028-04' ? '2028-04-18' : '2027-12-30';
        await page.locator(`[data-cal-day="${target}"]`).click();
        const panel = width <= 700 ? page.locator('.cal-dialog') : page.locator('.cal-day-panel');
        await panel.locator('.cal-event-card').first().waitFor();
        assert.equal(await panel.locator('.cal-event-card').count(), 8);
        if (width <= 700) await page.keyboard.press('Escape');
        checks.push({ width, month, days: measured.length, allDatesAligned: true, HebrewLabels: true, crowdedEventsFit: true });
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors, output }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
