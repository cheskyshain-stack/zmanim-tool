// Local charts only: cover release/retirement, selected-pair printing and popup access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-early-overlap-'));
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const fixtures = [
  { date:'2026-12-02T17:00:00Z', current:'choref:5787:0' },
  { date:'2026-12-07T17:00:00Z', current:'choref:5787:0', upcoming:'choref:5787:1' },
  { date:'2026-12-14T17:00:00Z', current:'choref:5787:1' },
  { date:'2026-09-21T16:00:00Z', current:'kayitz:5786:1' },
  { date:'2026-09-28T16:00:00Z', current:'kayitz:5786:1', upcoming:'choref:5787:0' },
  { date:'2026-10-05T16:00:00Z', current:'choref:5787:0' },
];
const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true });
  const errors = [], checks = [];
  const create = async (width, date) => {
    const context = await browser.newContext({ viewport:{ width, height:950 }, reducedMotion:'reduce' });
    await context.addInitScript(() => localStorage.setItem('zmanim-nocount', '1'));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().startsWith('PDF failed')) console.error(message.text()); });
    if (date) await page.clock.setFixedTime(new Date(date));
    return { context, page };
  };
  const inspect = page => page.evaluate(async () => {
    const { loadTables } = await import('/js/data-loader.js'), { loadPublished } = await import('/js/publish.js');
    const { chartSpreads, chartDisplayForNow, spreadLabel } = await import('/js/ui/chart-view.js'), { resolveSettings } = await import('/js/settings.js');
    const state = await loadPublished({ automatic:true }), spreads = chartSpreads(state), display = chartDisplayForNow(spreads, state, resolveSettings(state.settings));
    const id = index => { const entry = spreads[index]; return `${entry.sheet.season}:${entry.sheet.hebrewYear}:${entry.index}`; };
    const sections = [...document.querySelectorAll('#chart-host .chart-spread')].map(section => ({
      label:section.querySelector('h2')?.textContent || '', date:section.querySelector('.week-nav-when').innerText,
      pages:section.querySelectorAll('.page').length, arrows:section.querySelectorAll('.chart-current-week-arrow').length,
      top:section.getBoundingClientRect().top, bottom:section.getBoundingClientRect().bottom,
      clocks:(section.querySelector('.pages').innerText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).sort(),
    }));
    return { current:id(display.current), upcoming:display.upcoming === null ? null : id(display.upcoming),
      expectedDates:(display.upcoming === null ? [display.current] : [display.upcoming, display.current]).map(index => spreadLabel(spreads[index]).english),
      sections, overflow:document.documentElement.scrollWidth > innerWidth + 1,
      controlIds:[...document.querySelectorAll('#chart-host button[id],#chart-host input[id]')].map(el => el.id) };
  });
  try {
    for (const width of [320,393,1440]) {
      const { context, page } = await create(width);
      for (const fixture of fixtures) {
        await page.clock.setFixedTime(new Date(fixture.date)); await page.goto(origin + '/chart/');
        await page.locator('.pages .page').first().waitFor(); await settle(page);
        const value = await inspect(page);
        assert.equal(value.current, fixture.current); assert.equal(value.upcoming, fixture.upcoming || null);
        assert.equal(value.sections.length, fixture.upcoming ? 2 : 1); assert(value.sections.every(section => section.pages === 2));
        assert(!value.overflow); assert.equal(new Set(value.controlIds).size, value.controlIds.length);
        value.sections.forEach((section, i) => assert(section.date.startsWith(value.expectedDates[i])));
        if (fixture.upcoming) {
          assert.equal(value.sections[0].label, 'New chart'); assert.equal(value.sections[1].label, 'Previous chart');
          assert(value.sections[1].top >= value.sections[0].bottom); assert.equal(value.sections[0].arrows, 0);
          await page.screenshot({ path:path.join(output, width + '-' + fixture.date.slice(0,10) + '.png'), fullPage:true });
          if (fixture.current === 'choref:5787:0' && width !== 320) {
            await page.evaluate(() => { window.print = () => { window.printCalls = (window.printCalls || 0) + 1; }; });
            for (const [selector, index] of [['#print-btn',0],['#chart-previous-print',1]]) {
              await page.locator(selector).click();
              const pdf = await page.pdf({ preferCSSPageSize:true, printBackground:true });
              const text = execFileSync('pdftotext', ['-layout','-','-'], { input:pdf, encoding:'utf8' });
              assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2, 'Print contains only the selected chart pair');
              assert.deepEqual((text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).sort(), value.sections[index].clocks);
              assert(!text.includes('Previous chart') && !text.includes('New chart') && !text.includes('This week'));
              fs.writeFileSync(path.join(output, width + '-' + index + '.pdf'), pdf);
              assert.equal(await page.locator('#chart-host .page:visible').count(), 4, 'Both pairs remain visible after printing');
            }
            // Exercise optional PDF wiring with a fast canvas adapter, observing its sheets and filename.
            await page.evaluate(async () => {
              window.open = () => null; window.pdfSheets = [];
              window.html2canvas = async el => { window.pdfSheets.push([...el.querySelectorAll('tr[data-week-serial]')].map(row => row.dataset.weekSerial)); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; return canvas; };
              window.jspdf = { jsPDF:class { addPage() {} addImage() {} output() { return new Blob(['local PDF adapter'], { type:'application/pdf' }); } } };
              const { renderChartBrowser } = await import('/js/ui/chart-view.js'), { loadPublished } = await import('/js/publish.js');
              renderChartBrowser(document.querySelector('#chart-host'), await loadPublished({ automatic:true }), { confine:true, highlightCurrentWeek:true, showUpcoming:true });
            });
            const names = [];
            for (const selector of ['#pdf-btn','#chart-previous-pdf']) {
              await page.evaluate(() => { window.pdfSheets = []; });
              const downloaded = page.waitForEvent('download'); downloaded.catch(() => {}); await page.locator(selector).click(); const download = await downloaded;
              names.push(download.suggestedFilename()); assert.equal((await page.evaluate(() => window.pdfSheets)).length, 2);
              await page.locator(selector).waitFor({ state:'visible' });
            }
            assert.notEqual(names[0], names[1], 'Each PDF is named for its own date range');
          }
        }
        checks.push({ width, date:fixture.date, current:value.current, upcoming:value.upcoming, pairCount:value.sections.length });
      }
      if (width === 393) {
        await page.clock.setFixedTime(new Date('2026-12-07T17:00:00Z'));
        await page.goto(origin + '/chart/'); await page.locator('[data-chart-previous]').waitFor();
        await page.evaluate(() => { const chart = document.querySelector('[data-chart-current] .page'); chart.click(); chart.click(); chart.click(); });
        await page.locator('.chart-next').waitFor();
        await page.locator('.chart-next').click(); assert.equal(await page.locator('#chart-host .page').count(), 2);
        await page.locator('.chart-today').click(); assert.equal(await page.locator('#chart-host .page').count(), 4);
      }
      await context.close();
    }
    // The popup remains one per browser and View Chart includes the upcoming part.
    const popup = await create(393, '2026-12-07T17:00:00Z');
    await popup.page.goto(origin + '/'); await popup.page.locator('.luach-announce[open]').waitFor();
    assert.equal(await popup.page.evaluate(() => localStorage.getItem('zmanim-chart-announced')), 'choref:5787:1');
    await popup.page.getByRole('link', { name:'View Chart', exact:true }).click(); await popup.page.locator('[data-chart-previous] .page').first().waitFor();
    assert.equal(await popup.page.locator('#chart-host .page').count(), 4);
    await popup.page.goto(origin + '/'); await popup.page.locator('.luach-menu').waitFor(); assert.equal(await popup.page.locator('.luach-announce').count(), 0);
    await popup.context.close();
    // Determine exact Motzaei Shabbos release and retirement boundaries using the existing schedule.
    for (const [date, expectedCount] of [['2026-12-05',2],['2026-12-12',1]]) {
      const live = await create(393);
      await live.page.goto(origin + '/chart/'); await live.page.locator('.page').first().waitFor();
      const instant = await live.page.evaluate(async date => {
        const { loadPublished } = await import('/js/publish.js'), { resolveSettings } = await import('/js/settings.js');
        const { weekEndsMins } = await import('/js/upcoming.js'), { excelSerial } = await import('/js/zmanim/solar.js'), { websitePreviewInstant } = await import('/js/website-clock.js');
        const state = await loadPublished({ automatic:true }), settings = resolveSettings(state.settings), minute = Math.ceil(weekEndsMins(excelSerial(new Date(date+'T00:00:00Z')), state, settings));
        return websitePreviewInstant(date, String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'), settings.timezone.id).instant.toISOString();
      }, date);
      await live.page.clock.install({ time:new Date(Date.parse(instant)-30000) });
      await live.page.goto(origin + '/chart/'); await live.page.locator('.page').first().waitFor(); await settle(live.page);
      assert.equal(await live.page.locator('.chart-spread').count(), expectedCount === 2 ? 1 : 2);
      await live.page.clock.fastForward(61000); await live.page.clock.runFor(100);
      assert.equal(await live.page.locator('.chart-spread').count(), expectedCount);
      const value = await inspect(live.page); assert.equal(value.current, expectedCount === 2 ? 'choref:5787:0' : 'choref:5787:1');
      await live.page.getByRole('link', { name:'Back to Weekly Zmanim', exact:true }).click(); await live.page.locator('#week-host').waitFor();
      assert.equal(await live.page.locator('.chart-current-week-layer,.chart-current-week-badge').count(), 0);
      await live.context.close();
    }
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2));
    console.log('Early-release overlap, separate printing/PDFs, popup and rollover passed: ' + output);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
