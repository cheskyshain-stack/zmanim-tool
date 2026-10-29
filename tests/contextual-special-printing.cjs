// Fractional screen placement must not shrink a correctly sized chart on paper.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.SPECIAL_JOB_OUTPUT;
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
  const origin = process.env.SPECIAL_JOB_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], results = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        const year = Number((new URLSearchParams(location.search).get('headings') || '5787').split('-')[0]);
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse(`${year - 3761}-10-19T12:00:00Z`) }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, sheet: 'asarabteves', group: 'עשרה בטבת', workflow: 'single', margin: 0.75 }));
      });
      if (!process.env.SPECIAL_JOB_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
      page.on('pageerror', error => errors.push(error.message));
      const settle = async () => {
        await page.locator('.poster,.page').first().waitFor({ state: 'attached' });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      };
      const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      const radio = async (key, value) => { await page.locator(`label[for="${key}-${value}"]`).click(); await settle(); await noOverflow(); };
      const times = () => page.locator('.poster').evaluateAll(posters => posters.flatMap(poster => poster.innerText.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []).sort());
      const print = async (label, count, landscape) => {
        await settle(); await page.emulateMedia({ media: 'print' });
        const geometry = await page.locator('[data-job-frame]').evaluateAll(frames => frames.map(frame => {
          const box = frame.getBoundingClientRect();
          const posters = [...frame.querySelectorAll('.poster')].map(poster => {
            const rect = poster.getBoundingClientRect();
            const footer = poster.querySelector('.poster-legend');
            const title = poster.querySelector('.onepage-title');
            const next = title?.nextElementSibling;
            const titleWithSchedule = !poster.classList.contains('is-halfpage') ||
              title?.parentElement.classList.contains('halfpage-content')
              && next.offsetTop >= title.offsetTop + title.offsetHeight - 1
              && next.offsetTop - title.offsetTop - title.offsetHeight < 8
              && parseFloat(getComputedStyle(title).fontSize) === 24
              && [...poster.querySelectorAll('.onepage-sec-head:not(.is-day-heading)')].every(head => getComputedStyle(head).fontSize === getComputedStyle(title).fontSize);
            return { width: poster.offsetWidth, height: poster.offsetHeight,
              padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(getComputedStyle(poster)[key])),
              titleWithSchedule,
              footerClear: !poster.classList.contains('is-halfpage') ||
                poster.querySelector('.halfpage-body').offsetTop + poster.querySelector('.halfpage-body').offsetHeight <= footer.offsetTop - 5,
              footerSize: footer ? parseFloat(getComputedStyle(footer).fontSize) : null,
              footerWeight: footer ? getComputedStyle(footer).fontWeight : null,
              half: poster.classList.contains('is-halfpage'),
              within: rect.left >= box.left - 1 && rect.top >= box.top - 1 && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1,
              overflows: poster.scrollWidth > poster.clientWidth + 1 || poster.scrollHeight > poster.clientHeight + 1 };
          });
          return { width: box.width, height: box.height, posters };
        }));
        assert.equal(geometry.length, count, label + ': physical frame count');
        if (label === 'asara-regular-new') assert(geometry.every(frame => frame.posters.every(poster => poster.padding.every(value => Math.abs(value - 14.4) < 0.1))),
          'The new compact default has 0.15in margins on all four sides');
        assert(geometry.every(frame => frame.posters.every(poster => poster.within && !poster.overflows && poster.footerClear)), label + ': every poster fits its paper frame with the schedule clear of the footer');
        assert(geometry.every(frame => frame.posters.every(poster => poster.titleWithSchedule)), label + ': half-page titles sit with their day/schedule group and match section heading sizes');
        assert(geometry.every(frame => frame.posters.every(poster => !poster.half
          || Math.abs(poster.footerSize - 6.5 * 96 / 72) < 0.01 && poster.footerWeight === '400')), 'Half-page footers retain fixed regular 6.5pt type');
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, count, label + ': native PDF sheet count');
        const expected = landscape ? '/MediaBox [0 0 792 612]' : '/MediaBox [0 0 612 792]';
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === expected), label + ': correct Letter orientation');
        const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
        assert(/\d{1,2}:\d{2}/.test(text), 'Schedule times stay selectable in the PDF');
        if (output) fs.writeFileSync(path.join(output, `${width}-${label}.pdf`), pdf);
        await page.emulateMedia({ media: 'screen' }); await settle();
        results.push({ width, label, count, landscape, geometry });
      };
      const add = async (side, group, key) => {
        await page.locator(`[data-job-action="${side}"]`).first().click();
        await page.locator('[data-add-group]').selectOption(group); await settle();
        if (key) await page.locator('[data-add-choice]').selectOption(key);
        await page.locator('.special-add-page button[type=submit]').click(); await settle(); await noOverflow();
      };
      await page.goto(origin + '/admin/#posters/asarabteves'); await page.locator('#poster-design-new').waitFor({ state: 'attached' }); await settle();
      assert(await page.locator('#poster-design-new').isChecked(), 'New design is the default even with older saved controls');
      assert.equal(await page.locator('#poster-margin').inputValue(), '0.15', 'An older remembered wide margin adopts the requested narrower default');
      await page.reload(); await settle();
      assert.equal(await page.locator('#poster-margin').inputValue(), '0.15', 'The narrower default survives refresh');
      assert.equal(await page.locator('#poster-own-new,#poster-workflow-label,#poster-set-layout-label,.special-half-pairs').count(), 0, 'Custom creation and separate print-workflow settings are removed');
      const positions = await page.locator('#poster-year-label,#poster-group-label,#poster-design-label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().top));
      assert(positions[0] < positions[1] && positions[1] < positions[2], 'Year, Occasion, Design order');
      assert.equal(await page.locator('.special-asara-options input[type=radio]').count(), 3);
      const originalTimes = await times();
      await print('asara-regular-new', 1, true);
      await radio('poster-design', 'old'); assert.equal(await page.locator('.is-halfpage').count(), 0);
      assert.deepEqual(await times(), originalTimes, 'Old and new regular Asara retain every time');
      await print('asara-regular-old', 1, false);
      await radio('poster-asara-option', 'shacharis');
      assert.equal(await page.locator('.poster.is-shacharis').count(), 1, 'Morning-only handout stays available under Old design');
      await print('asara-shacharis-only', 1, true);
      await radio('poster-asara-option', 'locations');
      assert.equal(await page.locator('.is-asara-detailed').count(), 1, 'Detailed morning plus afternoon stays available under Old design');
      assert.equal(await page.locator('.shacharis-handout-row').count(), 7);
      assert.deepEqual(await times(), originalTimes, 'The detailed option keeps the complete schedule');
      await print('asara-locations', 1, true);
      await radio('poster-design', 'new'); await radio('poster-asara-option', 'full');
      await add('half', 'חנוכה', 'chanukah');
      await print('paired-asara-chanukah', 1, true);
      await add('page', 'בה"ב אחר סוכות', 'behabcheshvan');
      await print('second-half-sheet', 2, true);
      await add('page', 'סוכות', 'sukkos');
      const selectedTimes = await times();
      await print('mixed-full-and-paired-halves', 3, false);
      await radio('poster-design', 'old');
      assert.equal(await page.locator('.poster.is-shacharis').count(), 1, 'BHB remains present with its one available design');
      await print('old-design-splits-pair', 4, false);
      await radio('poster-design', 'new');
      assert.deepEqual(await times(), selectedTimes, 'Switching back keeps every selected schedule and time');
      await page.reload(); await page.locator('#poster-design-new').waitFor({ state: 'attached' }); await settle();
      await print('remembered-job', 3, false);
      await radio('poster-asara-option', 'locations');
      await page.locator('.special-print-settings summary').click();
      await page.locator('#poster-margin').selectOption('0.75'); await settle();
      await page.locator('#poster-year').selectOption('5785'); await settle();
      assert.match(await page.locator('.poster.is-asara-detailed .shacharis-handout-date').first().innerText(), /יום ו'/,
        'The Friday fixture is an actual Friday fast day');
      await print('friday-detailed-wide-margin', 3, false);
      if (output) await page.screenshot({ path: path.join(output, `${width}-controls.png`), fullPage: true });
      await noOverflow();

      for (const year of [5787, 5804]) for (const margin of [0.15, 0.75]) {
        await page.clock.setFixedTime(new Date(`${year - 3761}-10-19T12:00:00Z`));
        await page.evaluate(({ year, margin }) => localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year, margin, marginDefault: 0.15, design: 'new', sheet: 'chanukah',
          printPages: [{ id: 'chanukah-headings', left: 'chanukah', right: '' }],
        })), { year, margin });
        await page.goto(origin + `/admin/?headings=${year}-${margin}#posters/chanukah`); await settle();
        assert.equal(await page.locator('#poster-year').inputValue(), String(year), 'The dense fixture uses its actual Hebrew year');
        assert(await page.locator('.onepage-times').evaluateAll(nodes => nodes.every(node => parseFloat(getComputedStyle(node).fontSize) >= 9.5 * 96 / 72 - 0.01)),
          'Dense Chanukah schedules keep at least 9.5pt times alongside the fixed 18pt headings');
        await print(`chanukah-${year}-${margin}-headings`, 1, true);
        if (output && width === 1440 && year === 5787 && margin === 0.15) {
          await page.locator('.poster').screenshot({ path: path.join(output, 'chanukah-headings.png') });
        }
      }
      await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));

      // Paired schedules must also honor New = compact, including old saved selections.
      for (const year of [5785, 5787, 5790]) for (const key of ['pair', 'slichostzom', 'yomkippur']) {
        await page.evaluate(({ year, key }) => localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year, sheet: key, group: 'ראש השנה יום כיפור', design: 'new', orientation: 'landscape',
          printPages: [{ id: 'paired-design', left: key, right: '' }],
        })), { year, key });
        await page.goto(origin + `/admin/?paired=${key}-${year}#posters/${key}/landscape`); await settle();
        const compact = page.locator('.poster.is-onepage');
        assert.equal(await compact.count(), 1, 'New paired design uses the compact page');
        assert.equal(await page.locator('.poster.is-pair,#poster-orient-label').count(), 0, 'New paired design does not use the bordered poster or its orientation controls');
        assert(await compact.evaluate(poster => ['::before', '::after'].every(part => getComputedStyle(poster, part).content === 'none')), 'Compact page has no decorative poster border');
        const compactTimes = await times();
        if (output && year === 5787 && key === 'pair') await page.screenshot({ path: path.join(output, `${width}-paired-compact.png`), fullPage: true });
        await noOverflow(); await print(`${key}-${year}-compact`, 1, false);
        await radio('poster-design', 'old');
        assert.equal(await page.locator(key === 'yomkippur' ? '.poster:not(.is-onepage)' : '.poster.is-pair.is-landscape').count(), 1, 'Old design restores the framed poster and supported saved orientation');
        assert.deepEqual(await times(), compactTimes, 'Paired designs contain exactly the same schedule times');
        await print(`${key}-${year}-old`, 1, false);
        await radio('poster-design', 'new'); await page.reload(); await settle();
        assert.equal(await page.locator('.poster.is-onepage').count(), 1, 'Reload retains the compact paired design');
        assert.deepEqual(await times(), compactTimes, 'Returning to compact keeps every paired schedule time');
      }

      for (const year of [5785, 5787, 5790]) for (const key of ['slichos', 'tzomgedalia', 'afteryk']) {
        await page.evaluate(({ year, key }) => localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({
          year, sheet: key, design: 'new', printPages: [{ id: 'small-page', left: key, right: '' }],
        })), { year, key });
        await page.goto(origin + `/admin/?small=${key}-${year}#posters/${key}`); await settle();
        assert.equal(await page.locator('.poster.is-halfpage').count(), 1, 'Small schedules use the half-page design');
        assert.equal(await page.locator('[data-job-action=half]').count(), 1, 'Small schedules offer the other half');
        assert.equal(await page.locator('#poster-break-label').count(), 0, 'Half pages do not offer a second column');
        const halfTimes = await times();
        await print(`${key}-${year}-half`, 1, true);
        if (width === 375 && year === 5787) {
          await page.locator('.special-print-settings summary').click();
          await page.locator('#poster-margin').selectOption('0.75'); await settle();
          await print(`${key}-${year}-half-wide-margin`, 1, true);
          if (output) await page.screenshot({ path: path.join(output, `${width}-${key}-half.png`), fullPage: true });
        }
        await radio('poster-design', 'old');
        assert.equal(await page.locator('.poster.is-halfpage').count(), 0, 'Old small-schedule posters remain full size');
        assert.deepEqual(await times(), halfTimes, 'Half-page and old designs keep exactly the same times');
        await print(`${key}-${year}-old`, 1, false);
      }

      await page.evaluate(() => localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, design: 'new',
        sheet: 'slichos', printPages: [{ id: 'whole-occasion', left: 'slichos', right: '' }] })));
      await page.goto(origin + '/admin/?whole=1#posters/slichos'); await settle();
      const wholeKey = 'occasion:ראש השנה יום כיפור';
      await page.locator('#poster-pick').selectOption(wholeKey); await settle();
      assert.equal(await page.locator('#poster-pick').inputValue(), wholeKey, 'Hebrew whole-occasion selection stays selected');
      assert.equal(decodeURIComponent(new URL(page.url()).hash), '#posters/occasion/ראש השנה יום כיפור');
      assert.equal(await page.locator('.poster.is-onepage:not(.is-halfpage)').count(), 1);
      const wholeHeadings = (await page.locator('.onepage-sec-head').allTextContents()).join('\n');
      assert(['סליחות', 'ראש השנה', 'צום גדליה', 'שובה', 'יום כיפור', 'אחר יום כיפור'].every(heading => wholeHeadings.includes(heading)),
        'The whole occasion contains its core schedule sections: ' + wholeHeadings);
      await print('whole-yomim-noraim', 1, false);
      await page.reload(); await settle();
      assert.equal(await page.locator('#poster-pick').inputValue(), wholeKey, 'Reload retains the whole-occasion page');
      await page.locator('#poster-pick').selectOption('roshhashana'); await settle();
      await page.goBack(); await page.waitForFunction(key => document.querySelector('#poster-pick')?.value === key, wholeKey); await settle();
      await page.goForward(); await page.waitForFunction(() => document.querySelector('#poster-pick')?.value === 'roshhashana'); await settle();
      await page.locator('#poster-group').selectOption('סוכות'); await settle();
      await page.locator('#poster-pick').selectOption('occasion:סוכות'); await settle();
      await print('whole-sukkos', 1, false);
      await page.reload(); await settle();
      assert.equal(await page.locator('#poster-pick').inputValue(), 'occasion:סוכות');
      const wholeTimes = await times(); await radio('poster-design', 'old');
      assert.deepEqual(await times(), wholeTimes, 'The whole-occasion page remains available with its only design');
      await print('whole-sukkos-fallback', 1, false);
      // A removed chart layout in browser storage must open as separate Letter pages.
      for (const remembered of ['combined', 'combined-letter']) {
        await page.evaluate(value => localStorage.setItem('zmanim-chart-print-layout', value), remembered);
        await page.goto(origin + '/admin/#charts'); await page.locator('.page').first().waitFor(); await settle();
        assert.equal(await page.locator('.is-combined-chart').count(), 0);
        assert.equal(await page.locator('#chart-print-layout').getAttribute('type'), 'hidden');
        assert.equal(await page.locator('#chart-print-layout').inputValue(), 'separate');
        assert(!/11\s*[×x]\s*17|Together/.test(await page.locator('.chart-print-layout').innerText()));
        await page.emulateMedia({ media: 'print' });
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        if (output) fs.writeFileSync(path.join(output, `${width}-chart-${remembered}.pdf`), pdf);
        const chartFrames = await page.locator('.page').count();
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, chartFrames, 'Separate chart pages must not split across extra sheets');
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 792 612]'));
        await page.emulateMedia({ media: 'screen' });
      }
      if (width === 375) {
        await page.evaluate(() => localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, workflow: 'halves',
          margin: 0.35, halfPagePairs: [{ id: 'saved-pair', left: 'asarabteves', leftShacharis: 'locations', right: 'chanukah' }] })));
        await page.goto(origin + '/admin/?migration=1#posters/halfpages'); await page.reload(); await settle();
        assert(await page.locator('#poster-asara-option-locations').isChecked(), 'Previously saved room-name layout is carried forward');
        await print('migrated-pair', 1, true);
        await page.locator('[data-job-action=swap]').click(); await settle(); await page.reload(); await settle();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zmanim-poster-bar-v1')).printPages);
        assert.deepEqual(saved.map(page => [page.left, page.right]), [['chanukah', 'asaralocations']], 'Swap and reload retain each half and its design');
        await print('swapped-migrated-pair', 1, true);
        await page.locator('[data-job-action=unpair]').click(); await settle();
        await print('separated-pair', 2, true);
        await page.locator('[data-job-action=page]').first().click();
        await page.locator('[data-job-action=all-halves]').click(); await settle();
        assert.equal(await page.locator('.poster.is-halfpage').count(), 20, 'Bulk handouts include Shiva Asar B\'Tammuz and the small schedules without duplicating the detailed Asara variant');
        await print('all-half-pages', 10, true);
        await page.locator('[data-job-action=page]').first().click(); await page.locator('[data-job-action=all]').click(); await settle();
        await print('all-available-pages', await page.locator('[data-job-frame]').count(), false);

        await page.evaluate(async () => {
          const { loadState } = await import('/js/storage.js');
          const state = loadState();
          state.own = [{ id: 'retained-custom', name: 'Retained custom', group: 'סוכות', blocks: [{ heading: 'מנחה', day: 14, month: 7,
            rows: [{ mode: 'typed', text: '1:23', label: 'מנחה' }] }] }];
          localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
          localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, group: 'סוכות', sheet: 'own:retained-custom', workflow: 'single' }));
        });
        await page.goto(origin + '/admin/?retained=1#posters/own:retained-custom'); await page.reload(); await settle();
        assert((await page.locator('.poster').innerText()).includes('1:23'), 'Existing custom schedules remain available');
        await page.locator('.own-name').fill('Retained custom edit');
        assert.equal(await page.locator('.own-name').inputValue(), 'Retained custom edit');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'own-name', 'Editing an existing schedule retains focus');
        assert.equal(await page.locator('#poster-own-new').count(), 0);
        await print('retained-custom', 1, false);
        await page.locator('#poster-group').selectOption('ראש השנה יום כיפור'); await settle();
        await page.locator('#poster-pick').selectOption('slichos'); await settle();
        const allSlichosTimes = await times();
        await radio('poster-design', 'old');
        assert.deepEqual(await times(), allSlichosTimes, 'Standalone Selichos keeps every morning under either design');
      }
      // Test calendar navigation after reload fixtures, so this fixed clock does not
      // interfere with their remembered admin unlock timestamp.
      await page.goto(origin + '/admin/#posters/slichos'); await settle();
      await page.clock.setFixedTime(new Date('2026-09-23T16:00:00Z'));
      await page.locator('#poster-group').selectOption('ראש השנה יום כיפור'); await settle();
      await page.locator('#poster-page-now').click(); await settle();
      assert.equal(await page.locator('#poster-pick').inputValue(), 'afteryk', 'Current page includes the active schedule after Yom Kippur');
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ nativePrintFixtures: results.length, widths: [320, 375, 1440], errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
