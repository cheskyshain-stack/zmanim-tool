// Full-season single-sheet charts keep their times while using one-line menus.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.FULL_SEASON_OUTPUT;
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
  const origin = process.env.FULL_SEASON_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], checks = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 375 });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/admin/#charts');
      await page.locator('.pages .page').first().waitFor();
      for (const fixture of [
        { year: 5787, season: 'choref', molad: 'off' },
        { year: 5787, season: 'choref', molad: 'compact', split: true },
        { year: 5785, season: 'choref', molad: 'yiddish', split: true },
        { year: 5787, season: 'kayitz', molad: 'compact' },
        { year: 5787, season: 'choref', molad: 'compact', edits: true },
        { year: 5787, season: 'kayitz', molad: 'off', language: 'en' },
      ]) {
        const baseline = await page.evaluate(async fixture => {
          const { loadTables } = await import('/js/data-loader.js');
          const { buildAutomaticCharts } = await import('/js/publish.js');
          const { renderSheet, buildSheetPages } = await import('/js/ui/sheet-view.js');
          const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), new Date('2026-10-19T12:00:00Z'));
          state.settings.showMolad = fixture.molad !== 'off'; state.settings.moladFormat = fixture.molad;
          if (fixture.language) state.settings.language = fixture.language;
          const sheet = state.sheets.find(s => s.id === `auto-${fixture.season}-${fixture.year}`);
          const companion = state.sheets.find(s => s.linkedSheetId === sheet.id);
          sheet.pageSizes = [sheet.weeks.length]; companion.pageSizes = [companion.weeks.length];
          sheet.style.splitSpringDst = Boolean(fixture.split);
          sheet.columnWidths = {}; companion.columnWidths = {};
          if (fixture.edits) {
            sheet.overrides[sheet.weeks[0].serial] = { H: '<u>6:11</u><br>שקיעה <b>6:29</b>', C: '<u>1:23</u><br><b>4:56</b><div>דרשה 5:01</div>' };
            sheet.overrides[sheet.weeks[1].serial] = { H: '<b>6:12</b><br>חשוב<br>שקיעה 6:30' };
            state.rules.push({ id: 'full-season-test', enabled: true, condition: { always: true }, columnKeys: ['choref:I','kayitz:L'], mode: 'append', value: '12:10' });
          }
          const source = document.createElement('div'); source.className = 'pages';
          source.style.cssText = 'position:absolute;left:-100000px;width:1056px';
          document.body.append(source);
          for (const s of [sheet, companion]) source.append(...buildSheetPages(s, state, {
            showMolad: state.settings.showMolad, splitSpringDst: Boolean(s.style.splitSpringDst), compactFullSeason: false,
          }));
          const original = [...source.querySelectorAll('.page')].map(p => ({
            times: (p.innerText.match(/\d{1,2}:\d{2}/g) || []).sort(),
            underlined: [...p.querySelectorAll('u')].map(u => u.textContent.trim()), rows: p.querySelectorAll('tbody tr').length,
          }));
          source.remove();
          window.fullSeasonFixture = { state, sheet, companion, redraw: () => renderSheet(document.querySelector('#main'), state, sheet, () => {}) };
          const saved = JSON.stringify(state); fullSeasonFixture.redraw();
          return { original, saved };
        }, fixture);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        assert.equal(await page.locator('#pages .page.is-full-season').count(), 2);
        assert(await page.locator('#page-overflow-warning').isHidden());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.locator('#pages .weekday-table col[data-colkey=H-sunset]').count(), 0);
        assert.equal(await page.locator('#pages col[data-colkey=H-sunset]').count(), fixture.split ? 2 : 1);
        const actual = await page.locator('#pages .page').evaluateAll(pages => pages.map(p => ({
          times: (p.innerText.match(/\d{1,2}:\d{2}/g) || []).sort(),
          underlined: [...p.querySelectorAll('u')].map(u => u.textContent.trim()), rows: p.querySelectorAll('tbody tr').length,
        })));
        assert.deepEqual(actual, baseline.original, 'Every original time, underline and week is preserved');
        assert.equal(await page.locator('#pages .cell br').count(), 0, 'Time menus use one line');
        if (fixture.edits) {
          const first = fullSeason => `.cell[data-serial="${fullSeason}"]`;
          const serials = await page.evaluate(() => fullSeasonFixture.sheet.weeks.slice(0,2).map(w => w.serial));
          assert.equal(await page.locator(first(serials[0])+'[data-col=H-sunset]').textContent(), '6:29');
          assert.equal(await page.locator(first(serials[1])+'[data-col=H-sunset]').textContent(), '');
          assert((await page.locator(first(serials[1])+'[data-col=H]').textContent()).includes('חשוב'));
        }
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        const paperZoom = await page.addStyleTag({ content: '#pages .page { zoom:1 !important; }' });
        const geometry = await page.locator('#pages .page').evaluateAll(pages => pages.map(p => {
          const box = p.getBoundingClientRect(), footer = p.querySelector('.page-footer').getBoundingClientRect(), style = getComputedStyle(p);
          const last = [...p.querySelectorAll('table')].at(-1).getBoundingClientRect();
          const clipping = [...p.querySelectorAll('.cell,th,.parsha-cell')].filter(c => {
            const range = document.createRange(); range.selectNodeContents(c);
            const cell = c.closest('td,th').getBoundingClientRect();
            return [...range.getClientRects()].some(r => r.width > .1 && r.height > .1 && (r.left < cell.left - 1 || r.right > cell.right + 1 || r.top < cell.top - 1 || r.bottom > cell.bottom + 1));
          }).map(c => c.textContent);
          const panelsFit = [...p.querySelectorAll('.shacharis-panel')].every(panel => {
            const rect = panel.getBoundingClientRect(), content = panel.firstElementChild.getBoundingClientRect();
            return content.left >= rect.left - .5 && content.right <= rect.right + .5 && content.top >= rect.top - .5 && content.bottom <= rect.bottom + .5;
          });
          return { height:box.height, font:parseFloat(style.getPropertyValue('--sheet-font-size')), clipping, panelsFit,
            footer:footer.bottom-box.top, fits:last.bottom <= footer.top + .5 && footer.bottom <= box.bottom - parseFloat(style.paddingBottom) + .5 };
        }));
        assert(geometry.every(p => p.height <= 816.004 && p.fits && p.panelsFit && !p.clipping.length), JSON.stringify({ width, fixture, geometry }));
        if (fixture.year === 5787 && fixture.season === 'choref' && fixture.split)
          assert(geometry.every(p => p.font >= 6.5), 'The reviewed full-season layout retains substantially larger type');
        await paperZoom.evaluate(node => node.remove());
        const pdf = await page.pdf({ preferCSSPageSize:true, printBackground:true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(b => b === '/MediaBox [0 0 792 612]'));
        const texts = execFileSync('pdftotext', ['-layout','-','-'], { input:pdf, encoding:'utf8' }).split('\f').filter(s=>s.trim());
        const normalized = texts.map(s => s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/(\d)\s*:\s*(\d{2})/g,'$1:$2'));
        assert.deepEqual(normalized.map(s => (s.match(/\d{1,2}:\d{2}/g)||[]).sort()), baseline.original.map(p => p.times), 'Every time is present on its own physical sheet');
        assert(texts.every(s=>s.includes('Bais Medrash')));
        assert.equal(await page.evaluate(() => JSON.stringify(fullSeasonFixture.state)), baseline.saved, 'Fitting does not change saved styles, rules, overrides or page sizes');
        const name = `${width}-${fixture.season}-${fixture.year}-${fixture.molad}${fixture.split?'-split':''}${fixture.edits?'-edits':''}${fixture.language?'-en':''}`;
        if (output) fs.writeFileSync(path.join(output,name+'.pdf'),pdf);
        await page.emulateMedia({ media:'screen' });
        if (output) await page.locator('#pages').screenshot({ path:path.join(output,name+'.png') });
        await page.evaluate(() => fullSeasonFixture.redraw());
        assert.deepEqual(await page.locator('#pages .page').evaluateAll(pages=>pages.map(p=>parseFloat(getComputedStyle(p).getPropertyValue('--sheet-font-size')))),geometry.map(p=>p.font));
        checks.push({ width, fixture, geometry });
      }
      // Exercise the actual page-count control, storage and reopening from Saved.
      await page.goto(origin+'/admin/#generate');
      await page.locator('label[for=season-choref]').click();
      await page.locator('input[name=hebrewYear]').fill('5787');
      await page.locator('#gen-form button[type=submit]').click();
      await page.locator('input[name=numPages]').fill('1');
      await page.locator('input[name=numPages]').dispatchEvent('change');
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page.is-full-season').first().waitFor();
      assert.equal(await page.locator('#pages .page.is-full-season').count(),2);
      await page.locator('#explain-times-toggle').click();
      const sunset = page.locator('#pages .cell[data-col=H-sunset]').first();
      const printedSunset = (await sunset.textContent()).trim();
      await sunset.click();
      await page.locator('.time-explain-dialog[open]').waitFor();
      assert.equal(await page.locator('.time-explain-dialog .calc-open-printed').innerText(),printedSunset);
      assert(!(await page.locator('.time-explain-dialog').innerText()).includes('Calculation not recorded'));
      await page.keyboard.press('Escape');
      await page.locator('#explain-times-toggle').click();
      await page.locator('#show-zmanim-toggle').click();
      await sunset.click();
      const friday = await sunset.evaluate(c => String(Number(c.dataset.serial)-1));
      assert.equal(await page.locator('#zmanim-reference-date').inputValue(),friday,'Sunset selects Friday rather than Shabbos');
      assert.equal(await page.locator('[data-reference-group=other]').getAttribute('aria-pressed'),'true');
      await page.locator('#show-zmanim-toggle').click();
      await page.goto(origin+'/admin/#saved');
      await page.locator('.saved-list .open-btn').first().click();
      assert.equal(await page.locator('#pages .page.is-full-season').count(),2);
      await page.goto(origin+'/admin/#generate');
      await page.locator('label[for=season-choref]').click();
      await page.locator('input[name=hebrewYear]').fill('5787');
      await page.locator('#gen-form button[type=submit]').click();
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page').first().waitFor();
      assert.equal(await page.locator('#pages .page').count(),6);
      assert.equal(await page.locator('#pages .page.is-full-season,#pages col[data-colkey=H-sunset]').count(),0);
      assert(await page.locator('#pages .cell[data-col=H] br').count()>0,'Multi-page charts retain the previous candle/sunset layout');
      await page.goto(origin+'/admin/#charts');
      await page.locator('.pages .page').first().waitFor();
      assert.equal(await page.locator('.pages .page.is-full-season,col[data-colkey=H-sunset]').count(),0,'The standard multi-page seasonal charts keep their previous layout');
      await context.close();
    }
    assert.deepEqual(errors,[]);
    if (output) fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({ checks,errors },null,2));
    console.log(JSON.stringify({ checks,errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
