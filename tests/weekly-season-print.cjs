// Phone preview zoom must not enlarge a full-season print job past its own rows.
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.WEEKLY_SEASON_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const clocks = text => (text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s*:\s*/g, ':').match(/\d{1,2}:\d{2}/g) || []).sort();
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.WEEKLY_SEASON_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 393, 1440]) for (const date of ['2026-10-24', '2027-06-19']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 500, hasTouch: width < 500 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-20T12:00:00Z') }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
      await page.goto(origin + '/admin/#week');
      await page.locator('#week-print-rest').waitFor({ state: 'attached' });
      await page.evaluate(async date => {
        const { renderWeek } = await import('/js/ui/week-view.js');
        const { loadPublished } = await import('/js/publish.js');
        const { excelSerial } = await import('/js/zmanim/solar.js');
        const state = await loadPublished({ automatic: true }), host = document.querySelector('main');
        const draw = serial => renderWeek(host, state, draw, serial);
        await document.fonts.ready;
        draw(excelSerial(new Date(date + 'T00:00:00Z')));
        await document.fonts.ready;
        window.print = () => {};
        // Keep the print job mounted while inspecting it and generating a native PDF.
        const timeout = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => ms === 1500 ? 0 : timeout(fn, ms, ...args);
      }, date);
      const inspect = async label => {
        const cards = await page.locator('.week-card').evaluateAll(cards => cards.map(card => {
          const box = card.querySelector('.week-lines').getBoundingClientRect();
          const inner = card.querySelector('.week-lines-inner').getBoundingClientRect();
          const clipped = [...card.querySelectorAll('.week-time,.week-label')].filter(el => {
            const range = document.createRange(); range.selectNodeContents(el);
            return [...range.getClientRects()].some(r => r.width && r.height && (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1));
          }).map(el => el.textContent);
          return { title: card.querySelector('.week-title').textContent, overflow: inner.bottom - box.bottom,
            clipped, text: card.textContent, underlines: card.querySelectorAll('u').length,
            scale: Number(card.style.getPropertyValue('--fit-scale')) };
        }));
        assert(cards.length > 0);
        assert(cards.every(card => card.overflow <= 2 && !card.clipped.length), `${width}/${date}/${label}: ${JSON.stringify(cards.filter(card => card.overflow > 2 || card.clipped.length))}`);
        return cards;
      };
      const single = await inspect('single screen');
      await page.setViewportSize({ width: width + 60, height: 950 });
      await inspect('resized screen');
      await page.setViewportSize({ width, height: 950 });
      await inspect('restored screen');
      await page.emulateMedia({ media: 'print' });
      await inspect('single print');
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => document.querySelector('#week-print-rest').click());
      const bulk = await inspect('season screen');
      assert(bulk.length > single.length, 'The actual rest-of-season button creates a full print run');
      if (date === '2026-10-24') assert.equal(bulk.length, 53, 'The reported 53-page winter job is covered');
      await page.emulateMedia({ media: 'print' });
      const printed = await inspect('season print');
      assert.deepEqual(printed.map(card => clocks(card.text)), bulk.map(card => clocks(card.text)), 'Printing preserves every time');
      assert.deepEqual(printed.map(card => card.underlines), bulk.map(card => card.underlines), 'Printing preserves room underlines');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, bulk.length, 'One physical sheet per weekly card');
      assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 612 792]'), 'Portrait Letter throughout');
      const pages = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' }).split('\f').filter(text => text.trim());
      assert.equal(pages.length, bulk.length);
      pages.forEach((text, i) => {
        assert.deepEqual(clocks(text), clocks(bulk[i].text), `${width}/${date}/PDF page ${i + 1}: every clock remains visible`);
        assert(text.includes('44 Coles Way'), 'The full footer stays on its own sheet');
      });
      const result = { width, date, pages: bulk.length, maxOverflow: Math.max(...printed.map(card => card.overflow)), clippedText: 0 };
      results.push(result); console.log(JSON.stringify(result));
      if (output) fs.writeFileSync(path.join(output, `${width}-${date}.pdf`), pdf);
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
