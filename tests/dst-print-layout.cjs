// Run after build-offline.py. Set NODE_PATH to Playwright when it is not installed locally.
// Requires pdftotext (Poppler) on PATH to check footer placement on physical PDF pages.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

function verifyPdfFooters(pdf, count, label) {
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, count, label + ': physical page count');
  const result = spawnSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
  assert.equal(result.status, 0, label + ': PDF text extraction: ' + (result.error?.message || result.stderr));
  const pages = [...result.stdout.matchAll(/<page\b[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)];
  assert.equal(pages.length, count, label + ': extracted physical page count');
  const addressPositions = pages.map((page, index) => {
    const addresses = [...page[2].matchAll(/<word\b[^>]*yMin="([\d.]+)"[^>]*>Bais<\/word>/g)];
    assert.equal(addresses.length, 1, label + ': page ' + (index + 1) + ' has its own address exactly once');
    assert(Number(addresses[0][1]) > Number(page[1]) * 0.75,
      label + ': page ' + (index + 1) + ' address stays at the bottom, below its chart');
    return Number(addresses[0][1]);
  });
  assert(Math.max(...addressPositions) - Math.min(...addressPositions) < 0.01,
    label + ': every physical PDF page has the same footer position');
}

async function verifyChartFrames(page, count, label, selector = '#pages') {
  const frames = await page.locator(selector).evaluate(host => {
    const pages = [...host.querySelectorAll('.page')];
    const elements = [host, ...pages];
    const styles = elements.map(el => el.getAttribute('style'));
    try {
      elements.forEach(el => el.style.setProperty('zoom', '1', 'important'));
      host.style.setProperty('transform', 'none', 'important');
      return pages.map(page => {
        const box = page.getBoundingClientRect();
        const tables = [...page.querySelectorAll('table')];
        const legend = page.querySelector('.chart-location-legend');
        const marks = [...new Set(tables.flatMap(table =>
          [...table.textContent.matchAll(/\d{1,2}:\d{2}(?::\d{2})?\s*(\*{1,2})(?!\*)/g)].map(match => match[1])))].sort();
        const hasUnderlinedTime = tables.some(table => [...table.querySelectorAll('u')]
          .some(el => /\d{1,2}:\d{2}/.test(el.textContent)));
        for (const panel of page.querySelectorAll('.shacharis-panel')) {
          const box = panel.getBoundingClientRect();
          const schedule = panel.querySelector('.sh-sched').getBoundingClientRect();
          const style = getComputedStyle(panel);
          if (Math.abs((schedule.top + schedule.bottom - box.top - box.bottom) / 2) > 0.5)
            throw Error('The combined Shacharis information must stay centered in the whole panel');
          if (schedule.top < box.top - 0.5 || schedule.bottom > box.bottom + 0.5)
            throw Error('The combined Shacharis information must fit inside the panel');
          const holiday = panel.querySelector('.chanukah-highlight');
          if (holiday) {
            let previous = holiday.previousElementSibling;
            while (previous?.classList.contains('sh-gap')) previous = previous.previousElementSibling;
            const gap = holiday.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
            if (gap < 0 || gap > parseFloat(style.fontSize) * 2)
              throw Error('Chanukah must stay together with the regular information without overlap');
          }
        }
        if (Boolean(legend?.querySelector('.chart-location-downstairs')) !== hasUnderlinedTime)
          throw Error('The footer must explain only the underlined times on its page');
        const keys = [...(legend?.querySelectorAll(':scope > bdi') || [])]
          .map(el => el.textContent.match(/^\*{1,2}/)[0]).sort();
        if (JSON.stringify(keys) !== JSON.stringify(marks)) throw Error('The footer must explain only its page’s stars');
        if (legend) {
          const expectedHeight = parseFloat(getComputedStyle(legend).lineHeight);
          if (legend.scrollWidth > legend.clientWidth + 1
            || Math.abs(legend.getBoundingClientRect().height - expectedHeight) > 1)
            throw Error('The full downstairs sentence and room stars must fit together on one line');
        }
        if (legend) {
          const entries = [...legend.children].map(entry => entry.getBoundingClientRect());
          for (let i = 1; i < entries.length; i++) {
            if (entries[i - 1].left < entries[i].right - 1)
              throw Error('Location entries must read from right to left');
          }
          const downstairs = legend.querySelector('.chart-location-downstairs');
          if (downstairs) {
            if (downstairs.textContent !== 'All underlined מנינים will be בבית מדרש למטה')
              throw Error('The downstairs note must use the full original wording');
            const runs = [...downstairs.childNodes].map(node => {
              const range = document.createRange(); range.selectNodeContents(node);
              return range.getBoundingClientRect();
            });
            for (let i = 1; i < runs.length; i++) {
              if (runs[i - 1].right > runs[i].left + 1)
                throw Error('The full sentence must read left to right with isolated Hebrew runs');
            }
            if (entries.some(entry => Math.abs(entry.top - downstairs.getBoundingClientRect().top) > 3))
              throw Error('The room stars must share the line with the full downstairs sentence');
          }
          for (const entry of legend.querySelectorAll(':scope > bdi')) {
            const text = entry.firstChild, count = text.data.startsWith('**') ? 2 : 1;
            const range = document.createRange();
            range.setStart(text, 0); range.setEnd(text, count);
            const mark = range.getBoundingClientRect();
            range.setStart(text, count); range.setEnd(text, text.length);
            const room = range.getBoundingClientRect();
            if (mark.left < room.right - 1 || Math.abs(mark.top - room.top) > 1)
              throw Error('Each star count must stay on the right of its own Hebrew room');
          }
        }
        return { top: tables[0].getBoundingClientRect().top - box.top,
          bottom: tables.at(-1).getBoundingClientRect().bottom - box.top,
          height: box.height };
      });
    } finally {
      elements.forEach((el, index) => styles[index] === null
        ? el.removeAttribute('style') : el.setAttribute('style', styles[index]));
    }
  });
  assert.equal(frames.length, count, label + ': frame count');
  for (const edge of ['top', 'bottom']) {
    const values = frames.map(frame => frame[edge]);
    assert(Math.max(...values) - Math.min(...values) <= 1 / 64,
      label + ': matching chart ' + edge + ' edges: ' + values.join(', '));
  }
  frames.forEach(frame => assert(Math.abs(frame.height - 816) <= 1 / 64,
    label + ': exact landscape Letter page height'));
  return frames;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chrome' }),
  });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/')
      || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const publicPage = await context.newPage();
    publicPage.on('pageerror', error => errors.push('Public: ' + error.message));
    await publicPage.goto(origin + '/chart/?count=off');
    await publicPage.locator('.pages .page').first().waitFor();
    await publicPage.evaluate(() => document.fonts.ready);
    await publicPage.waitForTimeout(100);
    await verifyChartFrames(publicPage, 2, 'Congregation chart', '.pages');
    await publicPage.setViewportSize({ width: 375, height: 812 });
    await publicPage.waitForTimeout(100);
    await verifyChartFrames(publicPage, 2, 'Congregation chart on a phone', '.pages');
    await publicPage.close();
    const settled = async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
    };
    const generate = async (year, count = 3, season = 'choref') => {
      await page.goto(origin + `/admin/?year=${year}&pages=${count}&season=${season}#generate`);
      await page.locator(`label[for=season-${season}]`).click();
      await page.locator('input[name=hebrewYear]').fill(String(year));
      await page.locator('#gen-form button[type=submit]').click();
      if (count !== 3) {
        await page.locator('input[name=numPages]').fill(String(count));
        await page.locator('input[name=numPages]').dispatchEvent('change');
      }
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page').first().waitFor();
      await settled();
    };
    const cells = () => page.locator('#pages .page[data-sheet-label="שבת חורף"]').evaluateAll(pages =>
      Object.fromEntries(pages.flatMap(page => [...page.querySelectorAll('.cell')]
        .map(cell => [cell.dataset.serial + ':' + cell.dataset.col, cell.innerText]))));
    const verify = async (count, label) => {
      const measurements = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => {
        const box = page.getBoundingClientRect();
        const rows = [...page.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height);
        const body = [...page.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect().height);
        const headers = [...page.querySelectorAll('thead tr')].map(row => row.getBoundingClientRect().height);
        return { height: box.height, spread: Math.max(...body) - Math.min(...body),
          headerFits: Math.min(...headers) >= Math.max(...body) - 1,
          equalSections: !page.querySelector('.chart-sections') || Math.max(...rows) - Math.min(...rows) < 1,
          fits: page.querySelector('.page-footer').getBoundingClientRect().bottom <= box.bottom + 1,
          label: page.dataset.sheetLabel };
      }));
      assert.equal(measurements.length, count, label + ': page count');
      measurements.forEach((measurement, index) => {
        assert(Math.abs(measurement.height - 816) <= 2, label + ': sheet height ' + index);
        assert(measurement.spread < 1, label + ': equal rows ' + index + ' ' + measurement.spread);
        assert(measurement.headerFits && measurement.equalSections, label + ': header heights ' + index);
        assert(measurement.fits, label + ': footer fits ' + index);
        assert.equal(measurement.label, index % 2 ? 'Weekday' : 'שבת חורף', label + ': print order');
      });
      assert(await page.locator('#page-overflow-warning').isHidden(), label + ': overflow warning');
      await verifyChartFrames(page, count, label);
      return measurements;
    };

    await generate(5787);
    assert.equal(await page.locator('.chart-sections').count(), 0, 'Existing layouts start with one header');
    const menu = page.locator('#pages .page[data-sheet-label="שבת חורף"]').last().locator('.cell[data-col=L]').first();
    const serial = await menu.getAttribute('data-serial');
    // Older saved overrides still display even though chart cells can no longer edit them.
    await page.evaluate(serial => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      const sheet = state.sheets.find(sheet => sheet.season === 'choref');
      sheet.overrides[serial] ||= {};
      sheet.overrides[serial].L = '12:47';
      localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
    }, serial);
    await page.goto(origin + '/admin/#saved');
    await page.reload();
    await page.locator('.saved-list .open-btn').first().click();
    await settled();
    const original = await cells();
    await page.locator('label[for=chart-dst-headers-separate]').click();
    await settled();
    const separate = await cells();
    for (const [key, text] of Object.entries(separate)) assert.equal(text, original[key], 'Unchanged time ' + key);
    assert.equal(separate[serial + ':L'], '12:47', 'Saved Erev Shabbos override stays in the winter section');
    const sections = await page.locator('.chart-sections table').evaluateAll(tables => tables.map(table => ({
      columns: table.rows[0].cells.length,
      names: [...table.tBodies[0].rows].map(row => row.querySelector('.parsha-cell').innerText),
    })));
    assert.deepEqual(sections.map(section => section.columns), [9, 12]);
    assert.deepEqual(sections[0].names, ['כי תשא', 'ויקהל · שקלים', 'פקודי']);
    assert.equal(sections[1].names[0], 'ויקרא · זכור');
    console.log('Separate headers:', JSON.stringify(await verify(6, '5787')));

    const savedCell = page.locator(`.chart-sections .cell[data-serial="${serial}"][data-col=L]`);
    const savedState = await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1'));
    assert(await page.locator('#pages .cell').evaluateAll(cells => cells.every(cell => !cell.isContentEditable)), 'All chart cells are read-only');
    await savedCell.click();
    await page.keyboard.type('12:48');
    await page.locator('#chart-dst-headers-label').click();
    assert.equal(await savedCell.innerText(), '12:47', 'Typing cannot change a saved chart time');
    assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), savedState, 'Clicking and typing cannot save chart edits');
    await page.locator('label[for=chart-dst-headers-one]').click();
    assert.equal(await page.locator('.chart-sections').count(), 0);
    assert.equal((await cells())[serial + ':L'], '12:47', 'Saved overrides survive switching back');
    await page.locator('label[for=chart-dst-headers-separate]').click();
    await page.goto(origin + '/admin/#saved');
    await page.reload();
    await page.locator('.saved-list .open-btn').first().click();
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'Saved choice survives reload');
    assert.equal(await page.locator('.chart-sections').count(), 1);

    const publicTables = await page.evaluate(async () => {
      const { buildSheetPages } = await import('/js/ui/sheet-view.js');
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      return buildSheetPages(state.sheets.find(sheet => sheet.season === 'choref'), state, { readOnly: true })
        .map(page => page.querySelectorAll('table').length);
    });
    assert.deepEqual(publicTables, [1, 1, 1], 'Public charts keep their existing layout');
    await page.locator('label[for=chart-molad-on]').click();
    await settled();
    await verify(6, 'Compact molad');
    const offsets = await page.locator('.chart-sections .parsha-cell-centered').evaluateAll(cells => cells.map(cell => {
      const td = cell.getBoundingClientRect(), name = cell.querySelector('.parsha-cell-name').getBoundingClientRect();
      return Math.abs((td.top + td.bottom - name.top - name.bottom) / 2);
    }));
    assert(offsets.length > 0 && offsets.every(offset => offset < 1), 'Compact molad names stay centered');
    await page.locator('label[for=chart-molad-format-yiddish]').click();
    await settled();
    await verify(6, 'Yiddish molad');
    assert.equal(await page.locator('.chart-sections .parsha-cell-centered').count(), 0, 'Yiddish stays stacked');
    await page.locator('label[for=chart-molad-off]').click();

    await page.setViewportSize({ width: 375, height: 812 });
    await settled();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    const controls = await page.locator('[aria-labelledby=chart-dst-headers-label]').boundingBox();
    assert(controls.x >= 0 && controls.x + controls.width <= 375, 'Clock-change switch fits on mobile');
    await page.setViewportSize({ width: 1500, height: 1000 });
    await settled();
    await page.emulateMedia({ media: 'print' });
    await verify(6, 'Printed 5787');
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    verifyPdfFooters(pdf, 6, 'Desktop split headers');
    await page.emulateMedia({ media: 'screen' });

    await generate(5786);
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'New layouts remember the choice');
    await verify(6, '5786');
    await generate(5787, 1);
    await verify(2, 'Whole season');
    await page.emulateMedia({ media: 'print' });
    const compactPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    verifyPdfFooters(compactPdf, 2, 'Desktop whole season');
    await page.emulateMedia({ media: 'screen' });

    await generate(5787, 8);
    await verify(16, 'Short winter pages');

    // Open the Weekday companion with a page break exactly at the clock change.
    await page.evaluate(async () => {
      const { renderSheet } = await import('/js/ui/sheet-view.js');
      const { resolveSettings } = await import('/js/settings.js');
      const { inSpringDstWindow } = await import('/js/sheets/common.js');
      const { alignPageSizesTo } = await import('/js/pagination.js');
      const { saveState } = await import('/js/storage.js');
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      const sheet = state.sheets.find(sheet => sheet.season === 'choref' && sheet.pageSizes.length === 1);
      const at = sheet.weeks.findIndex(week => inSpringDstWindow(new Date(week.date), resolveSettings(state.settings)));
      sheet.pageSizes = [at, sheet.weeks.length - at];
      const weekday = state.sheets.find(candidate => candidate.linkedSheetId === sheet.id);
      weekday.pageSizes = alignPageSizesTo(sheet.weeks, sheet.pageSizes, weekday.weeks);
      const draw = () => renderSheet(document.querySelector('main'), state, weekday, event => {
        if (event.save) { saveState(state); draw(); }
      });
      draw();
    });
    await settled();
    assert.equal(await page.locator('.chart-sections').count(), 0, 'A cutover page break needs no second header');
    await verify(4, 'Cutover boundary');
    assert(await page.locator('#chart-dst-headers-separate').isChecked(), 'Companion shows its winter layout choice');
    await page.locator('label[for=chart-ink-mono]').click();
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-app-state-v1')).settings.sheetStyle.splitSpringDst),
      'Companion padding and ink controls preserve the winter preference');
    await page.locator('label[for=chart-dst-headers-one]').click();
    assert(await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      return state.sheets.filter(sheet => sheet.season === 'choref' && sheet.pageSizes.length === 2)
        .every(sheet => !sheet.style.splitSpringDst);
    }), 'Companion saves the choice on its winter chart');
    await generate(5787, 3, 'kayitz');
    assert.equal(await page.locator('#chart-dst-headers-label, .chart-sections').count(), 0, 'Summer has no winter option');

    // A saved companion can have different margins, fonts and letterhead sizes.
    // Reserve common chart bounds without overwriting either sheet's saved choices.
    await page.evaluate(async () => {
      const { renderSheet } = await import('/js/ui/sheet-view.js');
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      const shabbos = state.sheets.find(sheet => sheet.season === 'kayitz');
      const weekday = state.sheets.find(sheet => sheet.linkedSheetId === shabbos.id);
      Object.assign(shabbos.style, { fontSizePt: 13, headerScale: 1.25, paddingY: 0.25 });
      Object.assign(weekday.style, { fontFamily: 'Arial', fontSizePt: 11, headerScale: 0.9, paddingY: 0.45 });
      const original = JSON.stringify([shabbos.style, weekday.style]);
      state.settings.footerNote = 'First note\nSecond note\nThird note\nFourth note';
      const draw = () => renderSheet(document.querySelector('main'), state, shabbos, event => {
        if (event.save) draw();
      });
      draw();
      window.duplexStyleFixture = { state, original };
    });
    await settled();
    await verifyChartFrames(page, 6, 'Different saved styles');
    assert(await page.evaluate(() => {
      const { state, original } = window.duplexStyleFixture;
      const shabbos = state.sheets.find(sheet => sheet.season === 'kayitz');
      const weekday = state.sheets.find(sheet => sheet.linkedSheetId === shabbos.id);
      return JSON.stringify([shabbos.style, weekday.style]) === original;
    }), 'Alignment preserves both saved styles');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('#chart-pad-y-more').click();
    await settled();
    await verifyChartFrames(page, 6, 'Padding changed on a phone');
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.locator('#chart-pad-y-original').click();
    await settled();
    await page.evaluate(async () => {
      const { syncPageHeights } = await import('/js/ui/sheet-view.js');
      document.querySelector('#sheet-stack').classList.add('is-side-by-side');
      syncPageHeights(document.querySelector('#pages'));
    });
    await verifyChartFrames(page, 6, 'Side by side');
    assert.equal(await page.evaluate(() => {
      const { state } = window.duplexStyleFixture;
      return state.sheets.find(sheet => sheet.season === 'kayitz').style.fontSizePt;
    }), 13, 'Automatic alignment preserves the saved font size');

    // Start on a phone rather than resizing a chart already fitted on a desktop.
    // The latter cannot catch overflow hidden by the phone's reduced screen preview.
    const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36' });
    await phoneContext.route('**/*', route => route.request().url().startsWith(origin + '/')
      || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await phoneContext.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const phone = await phoneContext.newPage();
    phone.on('pageerror', error => errors.push('Phone: ' + error.message));
    const generatePhone = async count => {
      await phone.goto(origin + `/admin/?phone-pages=${count}#generate`);
      await phone.locator('label[for=season-choref]').click();
      await phone.locator('input[name=hebrewYear]').fill('5787');
      await phone.locator('#gen-form button[type=submit]').click();
      if (count !== 3) {
        await phone.locator('input[name=numPages]').fill(String(count));
        await phone.locator('input[name=numPages]').dispatchEvent('change');
      }
      await phone.locator('#page-form button[type=submit]').click();
      await phone.locator('label[for=chart-dst-headers-separate]').click();
      await phone.evaluate(() => document.fonts.ready);
      await phone.waitForFunction(() => !document.querySelector('.toast'));
      assert(await phone.locator('#page-overflow-warning').isHidden(), 'Phone chart fits without an overflow warning');
      assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone chart stays within screen width');
      await verifyChartFrames(phone, count * 2, 'Phone frame');
    };
    await generatePhone(3);
    const phoneCell = phone.locator('#pages .cell').first();
    const phoneState = await phone.evaluate(() => localStorage.getItem('zmanim-app-state-v1'));
    const phoneText = await phoneCell.innerText();
    await phoneCell.tap();
    assert(await phone.evaluate(() => {
      const active = document.activeElement;
      return !active.isContentEditable && !active.matches('input,textarea');
    }), 'Tapping a chart time does not focus a keyboard input');
    await phone.keyboard.type('12:48');
    assert.equal(await phoneCell.innerText(), phoneText, 'A phone tap cannot edit the chart');
    assert.equal(await phone.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), phoneState, 'Phone taps preserve saved data');
    const phonePdf = await phone.pdf({ preferCSSPageSize: true, printBackground: true });
    verifyPdfFooters(phonePdf, 6, 'Phone split headers');
    if (process.env.DST_MOBILE_PDF) fs.writeFileSync(process.env.DST_MOBILE_PDF, phonePdf);
    const phoneFontSizes = await phone.locator('#pages .page').evaluateAll(pages => pages.map(el => getComputedStyle(el).getPropertyValue('--sheet-font-size')));
    assert.equal(new Set(phoneFontSizes).size, 1, 'Phone print job uses one shared font scale');
    assert.equal(await phone.evaluate(() => JSON.parse(localStorage.getItem('zmanim-app-state-v1')).sheets[0].style.fontSizePt), 10,
      'Automatic fit preserves the saved font choice');
    await generatePhone(1);
    verifyPdfFooters(await phone.pdf({ preferCSSPageSize: true, printBackground: true }), 2, 'Phone whole season');
    await phoneContext.close();
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('Verified read-only cells, saved overrides, full location notes, persistence, public charts, both molad formats, mobile controls, and each physical PDF footer on desktop and phone.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
