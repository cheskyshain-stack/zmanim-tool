// Printed morning groups follow their first weekday, including mixed holiday weeks.
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.WEEKLY_ORDER_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const fixtures = [
  { date: '2026-12-12', labels: [/^חנוכה$/, /^שחרית ראש חדש טבת$/], days: ['(יום א, יום ב, יום ג, יום ד)', '(יום ה, יום ו)'] },
  { date: '2025-09-27', labels: [/^סליחות$/, /צום גדליה/, /^סליחות$/], days: ['(יום א)', '(יום ה)', '(יום ו)'] },
  { date: '2026-09-19', labels: [/צום גדליה/, /^סליחות$/, /^סליחות$/], days: ['(יום ב)', '(יום ג, יום ד, יום ו)', '(יום ה)'] },
  { date: '2029-12-15', labels: [/^חנוכה$/, /^שחרית$/], days: ['(יום א)', ''] },
  { date: '2026-10-24', labels: [/^שחרית$/, /בה"ב/], days: ['', '(יום ב, יום ה)'] },
];
const clocks = text => (text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s*:\s*/g, ':').match(/\d{1,2}:\d{2}/g) || []).sort();
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.WEEKLY_ORDER_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 500 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-21T12:00:00Z') }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'));
      await page.goto(origin + '/admin/#week');
      await page.locator('#week-print-rest').waitFor({ state: 'attached' });
      await page.evaluate(async () => {
        const { renderWeek } = await import('/js/ui/week-view.js');
        const { loadPublished } = await import('/js/publish.js');
        const { excelSerial } = await import('/js/zmanim/solar.js');
        const state = await loadPublished({ automatic: true }), host = document.querySelector('main');
        const draw = serial => renderWeek(host, state, draw, serial);
        window.drawOrderFixture = date => draw(excelSerial(new Date(date + 'T00:00:00Z')));
        await document.fonts.ready;
      });
      for (const fixture of fixtures) for (const layout of ['charts', 'combined']) {
        await page.evaluate(({ date, layout }) => {
          window.drawOrderFixture(date);
          const radio = document.querySelector('#week-layout-' + layout);
          radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
        }, { date: fixture.date, layout });
        await page.evaluate(() => document.fonts.ready);
        const inspect = async () => page.locator('.is-weekday-card .week-line').evaluateAll(rows => rows.map(row => {
          const label = row.querySelector('.week-label').cloneNode(true);
          const days = label.querySelector('.week-days')?.textContent || '';
          label.querySelectorAll('.week-days').forEach(el => el.remove());
          label.querySelectorAll('br').forEach(el => el.replaceWith(' '));
          const box = row.closest('.week-lines').getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(row);
          return { label: label.textContent.replace(/\s+/g, ' ').trim(), days,
            times: row.querySelector('.week-time').textContent, underlines: row.querySelectorAll('u').length,
            clipped: [...range.getClientRects()].some(r => r.width && r.height && (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1)) };
        }));
        const rows = await inspect(), expected = [...fixture.labels, /^מנחה$/, /^מעריב$/];
        assert.equal(rows.length, expected.length);
        rows.forEach((row, i) => assert.match(row.label, expected[i], `${width}/${fixture.date}/${layout}/row ${i + 1}`));
        assert.deepEqual(rows.slice(0, fixture.days.length).map(row => row.days), fixture.days);
        assert(rows.every(row => !row.clipped), 'All reordered text fits');
        await page.emulateMedia({ media: 'print' });
        assert.deepEqual(await inspect(), rows, 'Print keeps the chronological groups, clocks and underlines');
        const cards = await page.locator('.week-card').allTextContents();
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const pages = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(text => text.trim());
        assert.equal(pages.length, layout === 'charts' ? cards.length : 1);
        assert.deepEqual(clocks(pages.join('\n')), clocks(cards.join('\n')), 'Every time survives native printing');
        const result = { width, date: fixture.date, layout, labels: rows.map(row => row.label), pages: pages.length };
        results.push(result);
        if (output && fixture.date === '2026-12-12') {
          fs.writeFileSync(path.join(output, `${width}-${layout}.pdf`), pdf);
          await page.locator(layout === 'charts' ? '.is-weekday-card' : '.week-pair').screenshot({ path: path.join(output, `${width}-${layout}.png`) });
        }
        await page.emulateMedia({ media: 'screen' });
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ fixtures: results.length, results, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
