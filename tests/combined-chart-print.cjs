const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const artifacts = process.env.COMBINED_CHART_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
    '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

function nativePdf(pdf, expectedPages, width, height, label) {
  const result = spawnSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
  assert.equal(result.status, 0, label + ': readable PDF');
  const pages = [...result.stdout.matchAll(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)];
  assert.equal(pages.length, expectedPages, label + ': physical page count');
  const bottoms = [];
  for (const physical of pages) {
    assert.equal(Number(physical[1]), width, label + ': paper width');
    assert.equal(Number(physical[2]), height, label + ': paper height');
    const address = [...physical[3].matchAll(/<word\b[^>]*yMin="([\d.]+)"[^>]*>Bais<\/word>/g)];
    assert.equal(address.length, 1, label + ': one footer');
    assert.ok(Number(address[0][1]) > height * 0.8, label + ': footer below chart');
    bottoms.push(Number(address[0][1]));
    assert.ok(/>\d{1,2}:\d{2}<\/word>/.test(physical[3]), label + ': selectable times');
  }
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 0.1, label + ': shared footer position');
  if (artifacts) fs.writeFileSync(path.join(artifacts, label + '.pdf'), pdf);
}

function pdfContent(pdf, label) {
  const result = spawnSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
  assert.equal(result.status, 0, label + ': PDF text extraction');
  return [...result.stdout.matchAll(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)]
    .map(physical => {
      const width = Number(physical[1]), height = Number(physical[2]);
      const words = [...physical[3].matchAll(/<word\b[^>]*xMin="([\d.]+)"[^>]*yMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g)];
      for (const word of words) {
        assert.ok(Number(word[1]) >= -0.1 && Number(word[2]) >= -0.1 && Number(word[3]) <= width + 0.1 && Number(word[4]) <= height + 0.1,
          label + ': printed text stays on the paper: ' + word[5]);
      }
      const inkWidth = Math.max(...words.map(word => Number(word[3]))) - Math.min(...words.map(word => Number(word[1])));
      // Poppler can split a clock time beside a zero-width bidi isolate at some font sizes.
      const normalizedWords = words.map(word => word[5]).join(' ').replace(/[\u2066-\u2069]/g, '')
        .replace(/\b(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/g,
          (_, hours, minutes, seconds) => `${hours}:${minutes}${seconds ? ':' + seconds : ''}`)
        .trim().split(/\s+/).sort();
      return { width, height, inkWidth, normalizedWords, words: words.map(word => word[5]).sort() };
    });
}

async function smallerPaperPdfs(page, reference, label) {
  const original = pdfContent(reference, label + '-tabloid');
  for (const paper of [
    { label: 'letter-landscape', size: 'letter landscape', width: 792, height: 612, margin: '0' },
    { label: 'letter-portrait', size: 'letter portrait', width: 612, height: 792, margin: '0' },
    { label: 'letter-margins', size: 'letter landscape', width: 792, height: 612, margin: '0.25in', marginPoints: 18 },
    { label: 'service-letter', format: 'Letter', landscape: true, width: 792, height: 612 },
    { label: 'service-ledger', format: 'Ledger', landscape: false, width: 1224, height: 792 }
  ]) {
    // Android's print service can retain its own paper instead of honoring @page.
    // Override the requested size so native printing must lay out on that smaller box.
    const override = paper.size ? await page.addStyleTag({ content: `@page { size: ${paper.size}; margin: ${paper.margin}; }` }) : null;
    try {
      const pdf = await page.pdf({ preferCSSPageSize: !paper.format, printBackground: true,
        ...(paper.format ? { format: paper.format, landscape: paper.landscape } : {}) });
      const actual = pdfContent(pdf, label + '-' + paper.label);
      assert.equal(actual.length, original.length, label + ': same physical page count on ' + paper.label);
      actual.forEach((physical, index) => {
        assert.equal(physical.width, paper.width);
        assert.equal(physical.height, paper.height);
        assert.deepEqual(physical.normalizedWords, original[index].normalizedWords,
          label + ': every time, heading, parsha, room mark and footer survives ' + paper.label);
        const ratio = physical.inkWidth / Math.min(original[index].width,
          physical.width - 2 * (paper.marginPoints || 0),
          (physical.height - 2 * (paper.marginPoints || 0)) * original[index].width / original[index].height);
        const referenceRatio = original[index].inkWidth / original[index].width;
        assert.ok(Math.abs(ratio - referenceRatio) < 0.003,
          label + ': uses the available paper width on ' + paper.label + ': ' + ratio + ' vs ' + referenceRatio);
      });
      if (artifacts) fs.writeFileSync(path.join(artifacts, label + '-' + paper.label + '.pdf'), pdf);
    } finally { if (override) await override.evaluate(el => el.remove()); }
  }
}

async function chartGeometry(page, selector) {
  return page.locator(selector).evaluate(host => {
    const nodes = [host, ...host.querySelectorAll('.page')], styles = nodes.map(el => el.getAttribute('style'));
    host.style.setProperty('transform', 'none', 'important');
    nodes.forEach(el => el.style.setProperty('zoom', '1', 'important'));
    try {
      return [...host.querySelectorAll('.page')].map(chart => {
        const box = chart.getBoundingClientRect(), body = chart.querySelector('.combined-chart-body');
        const tables = [...chart.querySelectorAll('table')];
        const rows = tables.flatMap(table => [...table.tBodies[0].rows]);
        const bounds = rows.map(row => row.getBoundingClientRect());
        const cells = [...chart.querySelectorAll('.cell')];
        const parsha = chart.querySelector('.parsha-cell').getBoundingClientRect();
        const chol = chart.querySelector('[data-season=weekday]')?.getBoundingClientRect();
        const shabbos = chart.querySelector('.cell:not([data-season=weekday])')?.getBoundingClientRect();
        const panel = chart.querySelector('.combined-morning-panel');
        const panelBox = panel?.getBoundingClientRect();
        const scheduleBox = panel?.querySelector('.sh-sched')?.getBoundingClientRect();
        const inkOverflow = [];
        for (const holder of chart.querySelectorAll('table th,table td:not([data-combined-col=E]),.combined-morning-panel')) {
          const limits = holder.getBoundingClientRect(), walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
          for (let node; (node = walker.nextNode());) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.width && (rect.left < limits.left - 1 || rect.right > limits.right + 1 || rect.top < limits.top - 1 || rect.bottom > limits.bottom + 1)) inkOverflow.push(node.textContent);
            }
          }
        }
        return { width: box.width, height: box.height, rows: bounds.map(r => r.height),
          labels: rows.filter(row => row.lastElementChild.matches('.parsha-cell')).length,
          uniqueDates: new Set(rows.map(row => row.dataset.weekSerial)).size,
          totalRows: rows.length, headings: tables.map(table => [...table.querySelectorAll('.combined-group-head th')].map(th => th.textContent)),
          rightParsha: !chol || (parsha.x > chol.x && (!shabbos || chol.x > shabbos.x)),
          editable: cells.some(cell => cell.isContentEditable),
          addedDates: chart.querySelectorAll('.combined-week-date').length,
          bottom: tables.at(-1).getBoundingClientRect().bottom - box.top,
          footer: chart.querySelector('.page-footer').getBoundingClientRect().top - box.top,
          bodyOverflow: body.scrollHeight > body.clientHeight + 1, inkOverflow,
          panelFits: !panelBox || (scheduleBox.top >= panelBox.top - 1 && scheduleBox.bottom <= panelBox.bottom + 1),
          fontSize: getComputedStyle(chart).getPropertyValue('--sheet-font-size'),
          legend: chart.querySelector('.chart-location-legend')?.textContent,
          times: (chart.textContent.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []).sort() };
      });
    } finally { nodes.forEach((node, index) => styles[index] === null ? node.removeAttribute('style') : node.setAttribute('style', styles[index])); }
  });
}

function assertGeometry(frames, count, label, size = [1632, 1056]) {
  assert.equal(frames.length, count, label + ': preview pages');
  for (const frame of frames) {
    assert.equal(frame.width, size[0], label + ': preview paper width');
    assert.ok(Math.abs(frame.height - size[1]) < 0.05, label + ': preview paper height');
    assert.ok(Math.max(...frame.rows) - Math.min(...frame.rows) < 1, label + ': equal week rows');
    assert.equal(frame.labels, frame.totalRows, label + ': one parsha per row');
    assert.equal(frame.uniqueDates, frame.totalRows, label + ': matching dates appear once');
    assert.ok(frame.rightParsha, label + ': weekday right, Shabbos left, parsha far right');
    for (const headings of frame.headings) assert.deepEqual(headings, ['שבת', 'ימות החול', 'פרשה'], label + ': shared top headings');
    assert.ok(!frame.editable, label + ': read-only times');
    assert.equal(frame.addedDates, 0, label + ': no added parsha dates');
    assert.ok(frame.bottom < frame.footer, label + ': footer clear of the table');
    assert.ok(!frame.bodyOverflow, label + ': body fits');
    assert.deepEqual(frame.inkOverflow, [], label + ': every value fits its cell');
    assert.ok(frame.panelFits, label + ': complete morning panel');
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-print-navigation', 'classic');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.UTC(2026, 9, 12, 15, 10) - 1000 }));
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-12T15:10:00Z'));
    await page.goto(origin + '/chart/');
    await page.locator('.pages .page').first().waitFor();
    const originalPublic = await page.locator('.pages').evaluate(host => [...host.querySelectorAll('.cell')].map(cell => ({ serial: cell.dataset.serial, col: cell.dataset.col, season: cell.dataset.season, html: cell.innerHTML })));
    await page.locator('#chart-print-layout').selectOption('combined');
    await page.evaluate(() => document.fonts.ready);
    let frames = await chartGeometry(page, '.pages'); assertGeometry(frames, 1, 'public');
    const newPublic = await page.locator('.pages').evaluate(host => [...host.querySelectorAll('.cell')].map(cell => ({ serial: cell.dataset.serial, col: cell.dataset.col, season: cell.dataset.season, html: cell.innerHTML })));
    const sortCells = cells => cells.sort((a, b) => `${a.serial}:${a.season}:${a.col}`.localeCompare(`${b.serial}:${b.season}:${b.col}`));
    assert.deepEqual(sortCells(newPublic), sortCells(originalPublic), 'Public source chart cells are unchanged');
    assert.ok(frames[0].legend.includes('*בעזרת נשים') && frames[0].legend.includes('**באולם השמחות'), 'Morning stars are included in the combined footer');
    const publicPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    nativePdf(publicPdf, 1, 1224, 792, 'public-combined');
    await smallerPaperPdfs(page, publicPdf, 'public');
    const misleadingQueries = await page.addStyleTag({ content: '@media print { .pages { width: 60% !important; } .page.is-combined-chart { zoom: 0.6 !important; } }' });
    try {
      await smallerPaperPdfs(page, publicPdf, 'misleading-phone-queries');
    } finally { await misleadingQueries.evaluate(el => el.remove()); }
    await page.reload(); await page.locator('.is-combined-chart').waitFor();
    assert.equal(await page.locator('#chart-print-layout').inputValue(), 'combined', 'Choice survives refresh');
    await page.locator('#chart-print-layout').selectOption('combined-letter');
    await page.evaluate(() => document.fonts.ready);
    assertGeometry(await chartGeometry(page, '.pages'), 1, 'public-letter', [1056, 816]);
    const letterCells = await page.locator('.pages').evaluate(host => [...host.querySelectorAll('.cell')].map(cell => ({ serial: cell.dataset.serial, col: cell.dataset.col, season: cell.dataset.season, html: cell.innerHTML })));
    assert.deepEqual(sortCells(letterCells), sortCells(originalPublic), 'Letter option keeps all source cells');
    assert.match(await page.locator('#print-page-size').textContent(), /letter landscape/);
    const letterPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    nativePdf(letterPdf, 1, 792, 612, 'public-combined-letter');
    assert.deepEqual(pdfContent(letterPdf, 'letter')[0].normalizedWords, pdfContent(publicPdf, 'tabloid')[0].normalizedWords, 'Letter prints all the information');
    await smallerPaperPdfs(page, letterPdf, 'public-letter');
    await page.reload(); await page.locator('.is-combined-letter').waitFor();
    assert.equal(await page.locator('#chart-print-layout').inputValue(), 'combined-letter', 'Letter choice survives refresh');
    await page.locator('#chart-print-layout').selectOption('separate');
    assert.equal(await page.locator('#combined-chart-print-run').count(), 0, 'Switching layout clears the print copy');
    assert.ok(!await page.locator('body').evaluate(el => el.classList.contains('has-combined-chart-print')), 'Original printing restored');
    nativePdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }), 2, 792, 612, 'public-separate');

    await page.goto(origin + '/admin/#charts'); await page.locator('#chart-print-layout').waitFor();
    for (const fixture of [
      { year: 5787, season: 'choref' }, { year: 5787, season: 'kayitz' },
      { year: 5786, season: 'choref', split: true }, { year: 5788, season: 'choref' },
      { year: 5789, season: 'kayitz' }, { year: 5784, season: 'choref', molad: 'yiddish' },
      { year: 5787, season: 'choref', molad: 'compact', pad: 0.75, ink: 'mono' },
      { year: 5787, season: 'kayitz', language: 'en', pad: 0.15 },
      { year: 5787, season: 'choref', count: 1 },
      { year: 5787, season: 'choref', edits: true },
      { year: 5787, season: 'choref', layout: 'combined-letter' },
      { year: 5787, season: 'kayitz', layout: 'combined-letter' },
      { year: 5786, season: 'choref', split: true, layout: 'combined-letter' },
      { year: 5787, season: 'choref', edits: true, layout: 'combined-letter' },
      { year: 5784, season: 'choref', molad: 'yiddish', pad: 0.75, layout: 'combined-letter' }
    ]) {
      const label = Object.entries(fixture).map(([key, value]) => key + '-' + value).join('_');
      const source = await page.evaluate(async fixture => {
        const { DEFAULT_SETTINGS, resolveSettings } = await import('/js/settings.js');
        const { loadTables } = await import('/js/data-loader.js');
        const { computeSeasonWeeks, computeWeekdayWeeks } = await import('/js/sheets/weeks.js');
        const { defaultPageSizes, alignPageSizesTo } = await import('/js/pagination.js');
        const { buildSheetPages, renderSheet } = await import('/js/ui/sheet-view.js');
        const settings = { ...DEFAULT_SETTINGS, sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, paddingX: fixture.pad ?? 0.5, paddingY: fixture.pad ?? 0.35, splitSpringDst: Boolean(fixture.split) },
          language: fixture.language || 'he', showMolad: Boolean(fixture.molad), moladFormat: fixture.molad || 'compact', chartInk: fixture.ink || 'colour' };
        const tables = await loadTables(), resolved = resolveSettings(settings);
        const weeks = computeSeasonWeeks(fixture.season, fixture.year, resolved, tables).weeks;
        const weekdays = computeWeekdayWeeks(fixture.season, fixture.year, resolved, tables).weeks;
        const sizes = defaultPageSizes(weeks.length, fixture.count || 3, fixture.season);
        const shabbos = { id: 'test-shabbos', season: fixture.season, hebrewYear: fixture.year, createdAt: '2026-10-12', weeks, pageSizes: sizes, style: { ...settings.sheetStyle }, overrides: {} };
        const weekday = { id: 'test-weekday', season: 'weekday', linkedSheetId: shabbos.id, linkedSeason: fixture.season, hebrewYear: fixture.year, createdAt: '2026-10-12', weeks: weekdays, pageSizes: alignPageSizesTo(weeks, sizes, weekdays), style: { ...settings.sheetStyle }, overrides: {} };
        const state = { settings, sheets: [shabbos, weekday], rules: [] };
        if (fixture.edits) {
          shabbos.overrides[weeks[0].serial] = { H: '<u>12:48</u>' };
          weekday.overrides[weekdays[0].serial] = { C: '<u>12:49</u>' };
          state.rules = [{ id: 'combined-rule', enabled: true, columnKeys: ['choref:C'], condition: { always: true }, mode: 'append', value: '12:47' }];
        }
        const originals = [...buildSheetPages(shabbos, state, { showMolad: settings.showMolad, splitSpringDst: fixture.split }), ...buildSheetPages(weekday, state)];
        const values = originals.flatMap(original => [...original.querySelectorAll('.cell')].map(cell => ({ serial: cell.dataset.serial, col: cell.dataset.col, season: cell.dataset.season, html: cell.innerHTML })));
        const dates = [...new Set(originals.flatMap(original => [...original.querySelectorAll('tbody tr')].map(row => row.dataset.weekSerial)))].sort();
        window.combinedFixture = { state, shabbos, weekday };
        localStorage.setItem('zmanim-chart-print-layout', fixture.layout || 'combined');
        const host = document.querySelector('main'); host.classList.add('is-sheet-view');
        renderSheet(host, state, shabbos, () => renderSheet(host, state, shabbos, () => {}));
        await document.fonts.ready;
        return { values, dates, count: sizes.length, before: JSON.stringify(state) };
      }, fixture);
      await page.waitForTimeout(30);
      const actual = await page.locator('#pages').evaluate(host => ({
        values: [...host.querySelectorAll('.cell')].map(cell => ({ serial: cell.dataset.serial, col: cell.dataset.col, season: cell.dataset.season, html: cell.innerHTML })),
        dates: [...host.querySelectorAll('tbody tr')].map(row => row.dataset.weekSerial).sort()
      }));
      assert.deepEqual(sortCells(actual.values), sortCells(source.values), label + ': original time markup, room marks and saved values');
      assert.deepEqual(actual.dates, source.dates, label + ': every covered week, including weekday-only holidays');
      frames = await chartGeometry(page, '#pages');
      if (frames.some(frame => frame.inkOverflow.length)) {
        console.log(JSON.stringify({ label, frames: frames.map(({ times, ...rest }) => rest) }));
        if (artifacts) await page.screenshot({ path: path.join(artifacts, label + '-overflow.png'), fullPage: true });
      }
      const letter = fixture.layout === 'combined-letter';
      assertGeometry(frames, source.count, label, letter ? [1056, 816] : [1632, 1056]);
      if (!letter && !fixture.count && !fixture.molad && fixture.pad == null) {
        assert.ok(parseFloat(frames[0].fontSize) >= 9.5, label + ': normal charts keep readable type');
      }
      await page.locator('#chart-print-layout').focus();
      await page.evaluate(() => window.scrollTo(0, 25));
      const y = await page.locator('#chart-print-layout').evaluate(el => el.getBoundingClientRect().top);
      await page.locator('#chart-print-layout').selectOption('separate');
      await page.locator('#chart-print-layout').selectOption(fixture.layout || 'combined');
      const nextY = await page.locator('#chart-print-layout').evaluate(el => el.getBoundingClientRect().top);
      assert.ok(Math.abs(nextY - y) < 2, label + ': print picker stays in place');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'chart-print-layout', label + ': keyboard focus restored');
      const fixturePdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      nativePdf(fixturePdf, source.count, letter ? 792 : 1224, letter ? 612 : 792, label);
      if (fixture.split || (fixture.year === 5787 && fixture.season === 'kayitz' && !fixture.language)) {
        await smallerPaperPdfs(page, fixturePdf, label);
      }
      if (fixture.split) {
        await page.locator('#pages > .page').nth(1).evaluate(el => el.classList.add('page-excluded'));
        nativePdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }), source.count - 1, letter ? 792 : 1224, letter ? 612 : 792, 'excluded-middle-page' + (letter ? '-letter' : ''));
        await page.locator('#pages > .page').nth(1).evaluate(el => el.classList.remove('page-excluded'));
      }
      const after = await page.evaluate(() => JSON.stringify(window.combinedFixture.state));
      assert.equal(after, source.before, label + ': printing does not change saved schedules or styles');
      console.log(JSON.stringify({ label, pages: source.count, weeks: source.dates.length, font: frames[0].fontSize }));
    }
    const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phoneContext.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await phoneContext.addInitScript(() => localStorage.setItem('zmanim-chart-print-layout', 'combined'));
    const phone = await phoneContext.newPage(); phone.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 375]) {
      await phone.setViewportSize({ width, height: 812 });
      await phone.goto(origin + '/chart/'); await phone.locator('.is-combined-chart').waitFor();
      await phone.evaluate(() => document.fonts.ready);
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone fits screen at ' + width);
      assertGeometry(await chartGeometry(phone, '.pages'), 1, 'phone-' + width);
      const phonePdf = await phone.pdf({ preferCSSPageSize: true, printBackground: true });
      nativePdf(phonePdf, 1, 1224, 792, 'phone-' + width);
      await smallerPaperPdfs(phone, phonePdf, 'phone-' + width);
      await phone.locator('#chart-print-layout').selectOption('combined-letter');
      await phone.evaluate(() => document.fonts.ready);
      assertGeometry(await chartGeometry(phone, '.pages'), 1, 'phone-letter-' + width, [1056, 816]);
      const phoneLetterPdf = await phone.pdf({ preferCSSPageSize: true, printBackground: true });
      nativePdf(phoneLetterPdf, 1, 792, 612, 'phone-letter-' + width);
      assert.deepEqual(pdfContent(phoneLetterPdf, 'letter')[0].normalizedWords, pdfContent(phonePdf, 'tabloid')[0].normalizedWords, 'Phone Letter prints all chart information');
      assert.equal(await phone.locator('.chart-print-paper-hint').count(), 1, 'Phone explains the full-size paper selection');
      await phone.locator('a[href="/week/"]').first().click();
      await phone.locator('.weekly-reader').waitFor();
      assert.equal(await phone.locator('#combined-chart-print-run').count(), 0, 'Changing view clears the print copy');
      assert.match(await phone.locator('#print-page-size').textContent(), /letter portrait/, 'Leaving the chart restores the other page paper size');
    }
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('Verified combined chart contents, holiday rows, overrides, rules, both seasons, clock changes, molad, margins, paper sizes, persistence, focus and mobile printing.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
