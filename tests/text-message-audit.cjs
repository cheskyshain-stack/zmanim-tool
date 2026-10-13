const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.TEXT_AUDIT_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.TEXT_AUDIT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], checks = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        window.auditCopy = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.auditCopy = text; } } });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      const open = async date => {
        await page.clock.setFixedTime(new Date(date));
        await page.goto(origin + '/texts/?audit=' + Date.now());
        await page.locator('.tx-title').waitFor();
        assert.equal(await page.locator('a').count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      };
      await open('2026-08-25T16:00:00Z');
      for (const year of [5785, 5787, 5788, 5790]) {
        const fixture = await page.evaluate(async year => {
          const { roshHashana } = await import('/js/hebrew-calendar.js');
          return new Date(Date.UTC(1899, 11, 30) + (roshHashana(year - 3761) - 16) * 86400000 + 16 * 3600000).toISOString();
        }, year);
        await open(fixture);
        await page.locator('.tx-title').click({ clickCount: 3 });
        await page.locator('#tx-kind-yomtov-on').waitFor();
        const messages = await page.locator('.tx-card').evaluateAll(cards => cards.map(card => ({ id: card.dataset.id, text: card.querySelector('textarea').value })));
        assert.equal(new Set(messages.map(message => message.id)).size, messages.length, 'No duplicate message cards');
        const get = id => messages.find(message => message.id === id)?.text;
        for (const type of ['erev-rh', 'erev-yk', 'erev-sukkos', 'erev-shmini', 'erev-pesach', 'erev-shvii', 'chm-sukkos', 'chm-pesach', 'hoshana-rabba', 'netz-rh', 'netz-yk', 'taanis-gedalia']) {
          assert(get(`${type}-${year}`), `${type} appears in the relevant year`);
        }
        const rc = await page.evaluate(async year => {
          const { buildRoshChodeshShacharisPoster } = await import('/js/posters/shacharis.js');
          const { resolveSettings, DEFAULT_SETTINGS } = await import('/js/settings.js');
          const settings = resolveSettings(DEFAULT_SETTINGS), out = [];
          for (const month of [8, 9, 10, 11, 12, 13, 14, 1, 2, 3, 4, 5, 6]) {
            const p = buildRoshChodeshShacharisPoster(year, month, settings);
            out.push({ month, days: p?.days, rows: p?.rows.map(row => row.text + (row.mark === '**' ? 'sh' : row.mark === '*' ? 'en' : row.underlined ? 'd' : 'm')).join(', ') });
          }
          return out;
        }, year);
        for (const item of rc) {
          const text = get(`rosh-chodesh-${year}-${item.month}`);
          if (!item.rows) assert(!text, 'Shabbos-only or absent month has no weekday message');
          else assert(text?.endsWith(' Shacharis ' + item.rows), 'Rosh Chodesh quotes the handout, including Teves');
        }
        if (year === 5787) {
          assert(get('erev-yk-5787').includes('11:50m'));
          assert(get('erev-shmini-5787').includes('9:40d 11:05m'));
          assert(get('rosh-chodesh-5787-10').includes('6:44m'));
        }
        const chanukahWeeks = messages.filter(message => /^week-/.test(message.id) && /Shacharis \(.*Chanuka/.test(message.text));
        const expectedWeeks = await page.evaluate(async year => {
          const { buildChanukahPoster } = await import('/js/posters/chanukah.js');
          const { resolveSettings, DEFAULT_SETTINGS } = await import('/js/settings.js');
          const { excelWeekday } = await import('/js/hebrew-calendar.js');
          return new Set(buildChanukahPoster(year, resolveSettings(DEFAULT_SETTINGS)).days.map(day => day.serial + 7 - excelWeekday(day.serial))).size;
        }, year);
        assert.equal(chanukahWeeks.length, expectedWeeks, 'Every Chanukah weekday week has a message in ' + year);
        if (expectedWeeks > 1) assert(chanukahWeeks.some(message => /Shacharis \((?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)/.test(message.text)), 'A partial week retains its ordinary mornings');
        assert(messages.some(message => message.text.includes('Mincha (Sunday only): 12:30d')));
        assert(await page.locator('.tx-body').evaluateAll(boxes => boxes.every(box => box.clientHeight + 2 >= box.scrollHeight)), 'Every editable message fits its textarea');
        checks.push({ width, year, messages: messages.length, chanukahWeeks: chanukahWeeks.length });
        if (output) fs.writeFileSync(path.join(output, `${width}-${year}-messages.json`), JSON.stringify(messages, null, 2));
      }

      // These headers must refer only to weekday portions of a two-day Rosh Chodesh.
      await open('2026-11-01T16:00:00Z');
      const mixed = await page.evaluate(async () => {
        const { nextRoshChodesh } = await import('/js/rosh-chodesh-text.js');
        const { roshHashana, excelWeekday } = await import('/js/hebrew-calendar.js');
        const out = [];
        for (let year = 5784; year <= 5790 && out.length < 2; year++) {
          let from = roshHashana(year - 3761);
          for (let count = 0; count < 13; count++) {
            const rc = nextRoshChodesh(from); from = rc.last + 1;
            if (rc.year !== year) break;
            if (rc.first === rc.last || ![6, 7].includes(excelWeekday(rc.first))) continue;
            if (out.some(item => item.firstWeekday === excelWeekday(rc.first))) continue;
            const days = [rc.first, rc.last].filter(serial => excelWeekday(serial) !== 7);
            out.push({ ...rc, firstWeekday: excelWeekday(rc.first), days,
              date: new Date(Date.UTC(1899, 11, 30) + rc.first * 86400000 + 16 * 3600000).toISOString(),
              saturday: new Date(Date.UTC(1899, 11, 30) + (excelWeekday(rc.first) === 6 ? rc.last : rc.first) * 86400000 + 16 * 3600000).toISOString() });
          }
        }
        return out;
      });
      assert.equal(mixed.length, 2);
      for (const rc of mixed) {
        await open(rc.date);
        const card = page.locator(`.tx-card[data-id="rosh-chodesh-${rc.year}-${rc.month}"]`);
        assert.equal(await card.count(), 1);
        assert((await card.locator('.tx-date').innerText()).startsWith(rc.firstWeekday === 6 ? 'Fri' : 'Sun'));
        await open(rc.saturday);
        assert.equal(await page.locator(`.tx-card[data-id="rosh-chodesh-${rc.year}-${rc.month}"]`).count(), rc.firstWeekday === 6 ? 0 : 1);
      }
      await open('2027-01-08T16:00:00Z');
      assert.equal(await page.locator('.tx-card[data-id="rosh-chodesh-5787-11"]').count(), 0);

      // Saved charts may be imported in any order. Messages must read the newest edits.
      await open('2026-10-20T16:00:00Z');
      const anchor = await page.evaluate(async () => {
        const { loadState } = await import('/js/storage.js');
        const { computeSeasonWeeks } = await import('/js/sheets/weeks.js');
        const { loadTables } = await import('/js/data-loader.js');
        const { resolveSettings } = await import('/js/settings.js');
        const state = loadState(), settings = resolveSettings(state.settings);
        const week = computeSeasonWeeks('choref', 5787, settings, await loadTables()).weeks.find(week => week.parsha.includes('לך'));
        const base = { weeks: [{ ...week, date: week.date.toISOString() }], hebrewYear: 5787, pageSizes: [1] };
        state.sheets = [
          { ...base, id: 'old-weekday', season: 'weekday', createdAt: '2026-08-01T00:00:00Z', overrides: { [week.serial]: { C: '1:09', B: '8:01' } } },
          { ...base, id: 'new-shabbos', season: 'choref', createdAt: '2026-10-01T00:00:00Z', overrides: { [week.serial]: { I: '<u>1:41</u>* / 2:06**' } } },
          { ...base, id: 'new-weekday', season: 'weekday', linkedSheetId: 'new-shabbos', createdAt: '2026-10-01T00:00:00Z', overrides: { [week.serial]: { C: '<u>1:43</u>*', B: '8:37**' } } },
        ];
        localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state)); return week.serial;
      });
      await page.reload(); await page.locator('.tx-title').waitFor();
      assert.match(await page.locator('.tx-card[data-id="erev-shabbos"] textarea').inputValue(), /1:41en, 2:06sh/);
      const weekly = page.locator(`.tx-card[data-id="week-${anchor}"]`);
      assert.match(await weekly.locator('textarea').inputValue(), /Mincha: 1:43en\nMariv: 8:37sh/);
      await weekly.locator('textarea').fill((await weekly.locator('textarea').inputValue()) + '\nReview note');
      await weekly.locator('.tx-copy').click();
      assert.equal(await page.evaluate(() => window.auditCopy), await weekly.locator('textarea').inputValue());
      await page.reload(); await page.locator('.tx-title').waitFor();
      assert(!(await page.locator(`.tx-card[data-id="week-${anchor}"] textarea`).inputValue()).includes('Review note'));
      if (output) await page.screenshot({ path: path.join(output, `${width}-edited-chart-messages.png`), fullPage: true });
      await page.evaluate(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
      await page.goto(origin + '/admin/#charts'); await page.locator('.pages .page').first().waitFor();
      const printed = await page.evaluate(async () => {
        const { loadTables } = await import('/js/data-loader.js');
        const { buildAutomaticCharts } = await import('/js/publish.js');
        const { DEFAULT_SETTINGS } = await import('/js/settings.js');
        const { renderSheet } = await import('/js/ui/sheet-view.js');
        const state = buildAutomaticCharts({ settings: DEFAULT_SETTINGS, rules: [], sheets: [] }, await loadTables(), new Date('2024-12-01T16:00:00Z'));
        const sheet = state.sheets.find(sheet => sheet.season === 'weekday' && sheet.linkedSeason === 'choref' && sheet.hebrewYear === 5785);
        document.body.classList.remove('is-texts');
        const host = document.querySelector('main'); host.className = 'is-sheet-view';
        renderSheet(host, state, sheet, () => {});
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const panels = [...document.querySelectorAll('.chanukah-highlight')];
        return { pages: document.querySelectorAll('.pages .page').length, panels: panels.map(panel => panel.innerText) };
      });
      assert(printed.panels.some(panel => panel.includes('6:53')), 'The chart displays the poster\'s agreed first minyan');
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, printed.pages);
      const paper = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
      assert(paper.includes('6:53'), 'The agreed time is selectable text on paper');
      if (output) fs.writeFileSync(path.join(output, `${width}-chanukah-chart.pdf`), pdf);
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
