// Run after build-offline.py, with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.SHACHARIS_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const choices = ['עשרה בטבת', 'בה"ב אחר סוכות', 'בה"ב אחר פסח'];
const chronologicalChoices = ['ראש השנה יום כיפור', 'סוכות', 'פסח', 'שבועות',
  'ראש חודש', 'בה"ב אחר סוכות', 'חנוכה', 'עשרה בטבת', 'פורים', 'בה"ב אחר פסח', 'שבעה עשר בתמוז', 'תשעה באב'];
const expected = [
  ['בית מדרש', '6:40'], ['בעזרת נשים', '7:00'], ['בית מדרש למטה', '7:15'],
  ['באולם השמחות', '7:35'], ['בית מדרש', '8:00'], ['בעזרת נשים', '8:20'], ['בית מדרש למטה', '8:40'],
];
const pdfPages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SHACHARIS_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    if (!process.env.SHACHARIS_ORIGIN) await context.route('**/*', route =>
      route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.parse('2026-10-09T12:00:00Z') }));
      if (!localStorage.getItem('zmanim-poster-bar-v1')) localStorage.setItem('zmanim-poster-bar-v1',
        JSON.stringify({ year: 5787, group: 'עשרה בטבת · שחרית', sheets: 'all', scope: 'all', margin: 0.35 }));
    });
    const page = await context.newPage(), errors = [], measured = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { response = await page.goto(origin + '/admin/?morning-check=' + attempt + '#posters/all'); if (response.ok()) break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    assert(response?.ok(), 'Admin page loads');
    const html = await response.text(), localHTML = fs.readFileSync(root + '/admin/index.html', 'utf8');
    for (const pattern of [/css\/app\.css\?v=[a-f0-9]+/, /css\/print\.css\?v=[a-f0-9]+/]) {
      assert.equal(html.match(pattern)?.[0], localHTML.match(pattern)?.[0], 'Tested print styles are served');
    }
    const imports = source => JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    for (const module of ['/js/ui/posters-view.js', '/js/posters/shacharis.js', '/js/posters/special-shacharis.js']) {
      assert.equal(imports(html)[module], imports(localHTML)[module], 'Tested module is served');
    }
    await page.locator('.poster.is-shacharis').waitFor();
    const settle = () => page.evaluate(() => { const advanced = document.querySelector('.special-print-settings'); if (advanced) advanced.open = true; return document.fonts.ready; });
    const chooseYear = async year => {
      while (Number(await page.locator('.poster-year-now').getAttribute('data-year')) !== year) {
        await page.locator(Number(await page.locator('.poster-year-now').getAttribute('data-year')) < year ? '#poster-year-next' : '#poster-year-back').click();
      }
      await settle();
    };
    const measure = async (copies, expectedRows = expected) => {
      const actual = await page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-run').evaluateAll(rows => rows.map(row =>
        [row.querySelector('.shacharis-handout-room').textContent, row.querySelector('.shacharis-handout-time').textContent]));
      assert.deepEqual(actual, expectedRows, 'Every time is paired with its written room');
      assert.equal(await page.locator('.poster.is-shacharis').count(), copies);
      assert.equal(await page.locator('.poster.is-shacharis.is-onepage .page-header').count(), copies, 'Morning handouts use the compact letterhead');
      assert.equal(await page.locator('.poster.is-shacharis .onepage-title,.poster.is-shacharis .onepage-sec-head').count(), copies * 2,
        'Compact title and Shacharis section bar are present');
      assert.equal(await page.locator('.poster.is-shacharis .poster-wordmark,.poster.is-shacharis .poster-rule').count(), 0, 'No framed Word-style letterhead');
      assert.equal(await page.locator('.shacharis-handout-shade').count(), 0, 'Morning rows have no highlight artwork');
      assert(await page.locator('.shacharis-handout-run').evaluateAll(rows => rows.every(row =>
        getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)')), 'Every morning row has the same plain background');
      assert.equal(await page.locator('.poster.is-shacharis u').count(), 0, 'Rooms replace location underlines');
      const footers = await page.locator('.poster.is-shacharis .poster-legend').allTextContents();
      assert.equal(footers.length, copies, 'Every copy includes the shul name and address footer');
      assert(footers.every(text => text === 'Bais Medrash of Lakewood Commons\n44 Coles Way Lakewood, NJ 08701'),
        'Morning handouts print the shul name above its address');
      const texts = await page.locator('.poster.is-shacharis').allTextContents();
      assert(texts.every(text => text === texts[0] && !text.includes('*') && !/מנחה|מעריב/.test(text)), 'Only morning times, without location stars');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone preview fits');
      await page.emulateMedia({ media: 'print' });
      const boxes = await page.locator('.poster.is-shacharis').evaluateAll(sheets => sheets.map(sheet => {
        const r = sheet.getBoundingClientRect(), cs = getComputedStyle(sheet);
        const content = [...sheet.querySelectorAll('.page-header,.onepage-title,.onepage-sec-head,.shacharis-handout-date,.shacharis-handout-days,.shacharis-handout-run,.shacharis-handout-note,.poster-legend,.poster-legend > div')]
          .map(el => el.getBoundingClientRect());
        const footer = sheet.querySelector('.poster-legend'), footerBox = footer.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height,
          inside: content.every(c => c.x >= r.x + parseFloat(cs.paddingLeft) - 1 && c.right <= r.right - parseFloat(cs.paddingRight) + 1
            && c.y >= r.y + parseFloat(cs.paddingTop) - 1 && c.bottom <= r.bottom - parseFloat(cs.paddingBottom) + 1),
          overflow: sheet.scrollHeight > sheet.clientHeight || sheet.scrollWidth > sheet.clientWidth,
          footerAtBottom: Math.abs(footerBox.bottom - (r.bottom - parseFloat(cs.paddingBottom))) <= 1,
          footerClear: sheet.querySelector('.halfpage-body').getBoundingClientRect().bottom <= footerBox.top - 6,
          footerRule: parseFloat(getComputedStyle(footer).borderTopWidth) > 0,
          footerTypeSize: parseFloat(getComputedStyle(footer).fontSize),
          datesFit: [...sheet.querySelectorAll('.shacharis-handout-date > div')]
            .every(label => label.scrollWidth <= label.clientWidth + 1),
          typeSize: parseFloat(getComputedStyle(sheet.querySelector('.shacharis-handout-run')).fontSize),
          rtl: [...sheet.querySelectorAll('.shacharis-handout-run')].every(row =>
            row.querySelector('.shacharis-handout-room').getBoundingClientRect().left >= row.querySelector('.shacharis-handout-time').getBoundingClientRect().right),
          paper: document.getElementById('print-page-size').textContent };
      }));
      for (const [i, box] of boxes.entries()) {
        assert.deepEqual([box.x, box.y, box.width, box.height], [i * 528, 0, 528, 816], 'Each copy is a real half Letter sheet');
        assert(box.inside && !box.overflow, 'Letterhead, rooms, times and note fit inside the print margins: ' + JSON.stringify(box));
        assert(box.footerAtBottom && box.footerClear && box.footerRule, 'Ruled footer sits at the bottom, clear of the schedule: ' + JSON.stringify(box));
        assert(Math.abs(box.footerTypeSize - 6.5 * 96 / 72) < 0.01, 'Morning handouts retain the approved fixed 6.5pt footer');
        assert(box.datesFit, 'Each weekday and parsha fits within its own date column');
        assert(box.rtl, 'Hebrew room on the right, its time on the left');
        assert(box.typeSize >= 20, 'Times remain large enough for a morning poster');
        assert(box.paper.includes('letter landscape'));
      }
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
      assert.equal(pdfPages(pdf), 1, 'One landscape sheet with no overflow page');
      assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 792 612\]/);
      await page.emulateMedia({ media: 'screen' });
      return { boxes, pdf };
    };
    for (const [choiceIndex, choice] of choices.entries()) for (const year of [5785, 5787, 5790]) for (const width of [1440, 375]) for (const copies of [1, 2]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('#poster-group').selectOption(choice);
      if (choiceIndex === 0) await page.locator('#poster-pick').selectOption('asarashacharis');
      await chooseYear(year);
      assert.deepEqual(await page.locator('#poster-group option').allTextContents(), chronologicalChoices, 'Each dropdown section is chronological in ' + year);
      if (choiceIndex > 0) {
        const title = await page.locator('.poster.is-shacharis .onepage-title').first().innerText();
        assert(title.startsWith(choice), 'The BHB title identifies which Yom Tov it follows');
        assert(!/חשון|אייר/.test(title), 'No month name in the BHB title');
        assert.equal(await page.locator('.poster.is-shacharis .onepage-sec-head').first().innerText(), 'שחרית');
        const expectedDates = await page.evaluate(async ({ year, month }) => {
          const { buildBehabShacharisPoster } = await import('/js/posters/shacharis.js');
          const { loadState } = await import('/js/storage.js');
          const { resolveSettings } = await import('/js/settings.js');
          const { dateFromSerial } = await import('/js/zmanim/solar.js');
          const { loadTables } = await import('/js/data-loader.js');
          return buildBehabShacharisPoster(year, month, resolveSettings(loadState().settings), await loadTables()).days
            .map(serial => dateFromSerial(serial).toISOString().slice(0, 10));
        }, { year, month: choiceIndex === 1 ? 8 : 2 });
        assert.deepEqual(await page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-date')
          .evaluateAll(dates => dates.flatMap(date => date.dataset.dates.split(' '))), expectedDates, 'All three actual BHB dates appear on the printed handout');
        const expectedParshas = year === 5785
          ? choiceIndex === 1 ? ['וירא', 'וירא', 'חיי שרה'] : ['אחרי מות - קדושים', 'אחרי מות - קדושים', 'אמור']
          : choiceIndex === 1 ? ['לך לך', 'לך לך', 'וירא'] : ['בהר', 'בהר', 'בחוקותי'];
        assert.deepEqual(await page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-date > div').allTextContents(),
          [`יום ב' ה' ${expectedParshas[0]}`, `יום ב' ${expectedParshas[2]}`],
          'Each BHB morning has its weekday and upcoming Shabbos parsha on the first line, including combined readings');
        assert(!/[A-Za-z]|\b20\d{2}\b/.test(await page.locator('.shacharis-handout-dates').first().innerText()),
          'Printed BHB dates and parshas are entirely Hebrew');
        const datePositions = await page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-date')
          .evaluateAll(dates => dates.map(date => date.getBoundingClientRect().x));
        assert(datePositions.length === 2 && datePositions[0] > datePositions[1], 'BHB dates read chronologically from right to left');
        if (year === 5787 && choiceIndex === 1) {
          assert.equal(await page.locator('.shacharis-handout-hebrew-date').count(), 0, 'Calendar dates are omitted');
        }
      } else {
        const header = page.locator('.poster.is-shacharis').first();
        assert.deepEqual(await header.locator('.shacharis-handout-date > div').allTextContents(),
          [`יום ${year === 5785 ? 'ו' : 'א'}' ויחי`], 'Asara shows its actual weekday and upcoming parsha');
        assert.equal(await header.locator('.shacharis-handout-hebrew-date').count(), 0);
        assert.equal(await header.locator('.shacharis-handout-date').count(), 1);
      }
      await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
      await settle();
      assert.equal(await page.locator('input[name=poster-sheets],input[name=poster-scope],input[name=poster-break]').count(), 0,
        'A standalone half-page poster does not offer unrelated layouts');
      const note = choiceIndex === 0 || (choiceIndex === 1 && year !== 5785) ? 'סליחות קודם שחרית' : null;
      assert.deepEqual(await page.locator('.shacharis-handout-note').allTextContents(), note ? Array(copies).fill(note) : [],
        'Only the years and rounds with sunrise after 7:05 print the Selichos note');
      if (note) assert.equal(await page.locator('.shacharis-handout-row').filter({ has: page.locator('.shacharis-handout-note') })
        .locator('.shacharis-handout-time').first().innerText(), '6:40', 'The note stays with the 6:40 minyan');
      const result = await measure(copies);
      measured.push({ choice, year, width, copies, typeSize: result.boxes[0].typeSize });
      if (output && year === 5787 && width === 1440 && copies === 1) {
        await page.locator('.poster.is-shacharis').screenshot({ path: path.join(output, choiceIndex + '-poster.png') });
        fs.writeFileSync(path.join(output, choiceIndex + '-one.pdf'), result.pdf);
      }
    }
    for (const [year, note] of [[5786, 'סליחות קודם שחרית (יום ב׳ וה׳ לך לך)'],
      [5793, 'סליחות קודם שחרית (יום ה׳ לך לך, יום ב׳ וירא)']]) {
      await page.locator('#poster-group').selectOption(choices[1]);
      await chooseYear(year);
      for (const copies of [1, 2]) for (const margin of ['0.35', '0.75']) {
        await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
        await page.locator('#poster-margin').selectOption(margin); await settle();
        assert.deepEqual(await page.locator('.shacharis-handout-note').allTextContents(), Array(copies).fill(note),
          'A mixed round clearly prints only the dates that need Selichos before Shacharis');
        const result = await measure(copies);
        measured.push({ choice: choices[1], year, width: 375, copies, margin, note, typeSize: result.boxes[0].typeSize });
        if (output && year === 5786 && copies === 1 && margin === '0.35') {
          await page.locator('.poster.is-shacharis').screenshot({ path: path.join(output, 'mixed-dates-poster.png') });
          fs.writeFileSync(path.join(output, 'mixed-dates-one.pdf'), result.pdf);
        }
      }
    }
    await page.locator('#poster-margin').selectOption('0.35'); await settle();
    const rcMeasured = [];
    for (const year of [5785, 5787, 5790]) {
      await page.locator('#poster-group').selectOption('ראש חודש');
      await chooseYear(year);
      const available = await page.evaluate(async year => {
        const { buildRoshChodeshShacharisPoster, ROSH_CHODESH_SHACHARIS_MONTHS, shacharisDayGroups } = await import('/js/posters/shacharis.js');
        const { loadState } = await import('/js/storage.js');
        const { resolveSettings } = await import('/js/settings.js');
                const { dateFromSerial } = await import('/js/zmanim/solar.js');
        const { loadTables } = await import('/js/data-loader.js');
        const settings = resolveSettings(loadState().settings);
        const tables = await loadTables();
        return ROSH_CHODESH_SHACHARIS_MONTHS.map(month => buildRoshChodeshShacharisPoster(year, month, settings))
          .filter(Boolean).sort((a, b) => a.span.from - b.span.from).map(poster => ({ month: poster.month,
            title: poster.title, dayLabel: poster.dayLabel, rows: poster.rows.map(row => [row.room, row.text]),
            dates: shacharisDayGroups(poster.days, settings, tables).map(group => ({
              dates: group.days.map(serial => dateFromSerial(serial).toISOString().slice(0, 10)).join(' '), title: group.label })) }));
      }, year);
      assert.deepEqual(await page.locator('#poster-pick option').evaluateAll(options => options.map(option => option.value)),
        available.map(poster => 'roshchodesh' + poster.month), 'Months with weekday schedules appear in date order');
      assert.equal(await page.locator('#poster-pick').locator('..').evaluate(el => el.childNodes[0].textContent.trim()), 'Month');
      const shevatWeekday = await page.evaluate(async year => {
        const { dateFromHebrew, excelWeekday } = await import('/js/hebrew-calendar.js');
        return excelWeekday(dateFromHebrew(1, 11, year));
      }, year);
      assert.equal(await page.locator('#poster-pick option[value=roshchodesh11]').count(), shevatWeekday === 7 ? 0 : 1,
        'Skip Shevat when entirely on Shabbos, keeping its weekday occurrences in ' + year);
      assert(available.every(poster => !poster.dayLabel.includes('שבת')), 'No Shabbos handouts appear');
      for (const poster of available.filter(poster => [8, 9, 10, 11, 13, 14].includes(poster.month))) {
        for (const width of [1440, 375]) for (const copies of [1, 2]) {
          await page.setViewportSize({ width, height: 1100 });
          await page.locator('#poster-pick').selectOption('roshchodesh' + poster.month);
          await page.locator(`label[for=poster-copies-${copies === 1 ? 'one' : 'two'}]`).click();
          await settle();
          assert.equal(await page.locator('input[name=poster-sheets],input[name=poster-scope],input[name=poster-break]').count(), 0);
          assert((await page.locator('.onepage-title').first().innerText()).startsWith(poster.title));
          assert.equal(await page.locator('.shacharis-handout-days').count(), 0, 'The weekday appears once in the date header');
          const dates = page.locator('.poster.is-shacharis').first().locator('.shacharis-handout-date');
          assert.deepEqual(await dates.evaluateAll(nodes => nodes.map(node => node.dataset.dates)), poster.dates.map(day => day.dates));
          assert.deepEqual(await dates.locator(':scope > div').allTextContents(), poster.dates.map(day => day.title));
          assert.equal(await dates.locator('.shacharis-handout-hebrew-date').count(), 0, 'No calendar date line');
          const columns = await dates.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
          assert(columns.every(column => Math.abs(column.width - columns[0].width) < 1), 'Equal-width date columns');
          if (columns.length === 2) assert(columns[0].x > columns[1].x, 'Two Rosh Chodesh dates read from right to left');
          assert(!/[A-Za-z]|\b20\d{2}\b/.test(await page.locator('.shacharis-handout-dates').first().innerText()), 'Rosh Chodesh dates and parshas stay Hebrew');
          assert.equal(await page.locator('.shacharis-handout-note').count(), 0, 'No fast-day Selichos note on Rosh Chodesh');
          assert(page.url().endsWith('#posters/roshchodesh' + poster.month), 'The address identifies the selected month');
          const result = await measure(copies, poster.rows);
          rcMeasured.push({ year, month: poster.month, width, copies, typeSize: result.boxes[0].typeSize });
          if (output && year === 5787 && width === 1440 && copies === 1) {
            await page.locator('.poster.is-shacharis').screenshot({ path: path.join(output, 'rc-' + poster.month + '-poster.png') });
            fs.writeFileSync(path.join(output, 'rc-' + poster.month + '-one.pdf'), result.pdf);
          }
        }
      }
    }
    await chooseYear(5786);
    await page.locator('#poster-pick').selectOption('roshchodesh11'); await settle();
    await chooseYear(5787);
    assert.equal(await page.locator('#poster-pick option[value=roshchodesh11]').count(), 0);
    assert.notEqual(await page.locator('#poster-pick').inputValue(), 'roshchodesh11', 'A month now falling entirely on Shabbos switches to an available month');
    const replacement = await page.locator('#poster-pick').inputValue();
    assert(page.url().endsWith('#posters/' + replacement), 'The address follows the weekday replacement month');
    await page.reload(); await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
    assert.equal(await page.locator('#poster-pick').inputValue(), replacement, 'The weekday replacement survives reload');
    await page.locator('#poster-pick').selectOption('roshchodesh14'); await settle();
    await page.reload(); await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
    assert.equal(await page.locator('#poster-pick').inputValue(), 'roshchodesh14', 'Selected leap-year month survives reload');
    await chooseYear(5786);
    assert.equal(await page.locator('#poster-pick option[value=roshchodesh14]').count(), 0, 'Adar II disappears in a common year');
    assert(page.url().endsWith('#posters/' + await page.locator('#poster-pick').inputValue()), 'The address follows the available replacement month');
    await page.locator('#poster-group').selectOption(choices[2]); await settle();
    await chooseYear(5785); // Include the long אחרי מות - קדושים label at the largest margin.
    for (const margin of ['0.15', '0.75', '0.35']) {
      await page.locator('#poster-margin').selectOption(margin); await settle(); await measure(2);
    }
    await page.locator('label[for=poster-ink-mono]').click(); await settle(); await measure(2);
    await page.reload(); await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
    assert(await page.locator('#poster-copies-two').isChecked(), 'Copies setting survives reload');
    assert(await page.locator('#poster-ink-mono').isChecked());
    assert.equal(await page.locator('#poster-margin').inputValue(), '0.35');
    await measure(2);
    for (const [oldGroup, newGroup] of [['בה"ב חשון · שחרית', choices[1]], ['בה"ב אייר · שחרית', choices[2]]]) {
      await page.evaluate(group => {
        const saved = JSON.parse(localStorage.getItem('zmanim-poster-bar-v1'));
        saved.group = group; saved.sheet = null;
        localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify(saved));
      }, oldGroup);
      await page.goto(origin + '/admin/?legacy-group=' + encodeURIComponent(oldGroup) + '#posters/all');
      await page.locator('.poster.is-shacharis').first().waitFor(); await settle();
      assert.equal(await page.locator('#poster-group').inputValue(), newGroup, 'Previously saved BHB choice survives the rename');
      await measure(2);
    }
    for (const key of ['asarashacharis', 'behabcheshvan', 'behabiyar']) {
      await page.goto(origin + '/admin/#posters/' + key); await page.locator('.poster.is-shacharis').first().waitFor(); await settle(); await measure(2);
    }
    await page.locator('#poster-group').selectOption('עשרה בטבת'); await settle();
    await page.locator('#poster-pick').selectOption('asarabteves');
    await page.locator('label[for=poster-sheets-all]').click(); await settle();
    assert.equal(await page.locator('.poster.is-shacharis').count(), 0, 'The full Asara schedule remains separate');
    assert.equal(await page.locator('.halfpage-body.is-asara').count(), 2, 'Existing compact Asara copies remain available');
    assert.equal(await page.locator('.halfpage-body.is-asara .onepage-sec-head').first().innerText(), 'שחרית');
    assert((await page.locator('#poster-sheet').innerText()).includes('מנחה'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, cases: measured.length, roshChodeshCases: rcMeasured.length, measured, rcMeasured, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
