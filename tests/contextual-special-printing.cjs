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
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, sheet: 'asarabteves', group: 'עשרה בטבת', workflow: 'single' }));
      });
      if (!process.env.SPECIAL_JOB_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
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
            return { width: poster.offsetWidth, height: poster.offsetHeight,
              footerSize: footer ? parseFloat(getComputedStyle(footer).fontSize) : null,
              footerWeight: footer ? getComputedStyle(footer).fontWeight : null,
              half: poster.classList.contains('is-halfpage'),
              within: rect.left >= box.left - 1 && rect.top >= box.top - 1 && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1,
              overflows: poster.scrollWidth > poster.clientWidth + 1 || poster.scrollHeight > poster.clientHeight + 1 };
          });
          return { width: box.width, height: box.height, posters };
        }));
        assert.equal(geometry.length, count, label + ': physical frame count');
        assert(geometry.every(frame => frame.posters.every(poster => poster.within && !poster.overflows)), label + ': every poster fits its paper frame');
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
      await page.locator('#poster-year').selectOption('5789'); await settle();
      await print('friday-detailed-wide-margin', 3, false);
      if (output) await page.screenshot({ path: path.join(output, `${width}-controls.png`), fullPage: true });
      await noOverflow();

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
        assert.equal(await page.locator('.poster.is-halfpage').count(), 16, 'Bulk handouts retain all available schedules without duplicating the detailed Asara variant');
        await print('all-half-pages', 8, true);
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
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ nativePrintFixtures: results.length, widths: [320, 375, 1440], errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
