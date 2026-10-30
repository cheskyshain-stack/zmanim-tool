const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = process.env.SEASON_SPLIT_OUTPUT;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.SEASON_SPLIT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const fixtures = Array.from({ length: 7 }, (_, index) => 5784 + index).flatMap(year => ['choref', 'kayitz'].map(season => ({
        season, year, count: season === 'choref' && [5784, 5787, 5790].includes(year) ? 3 : 2,
      })));
      for (const fixture of fixtures) {
        await page.goto(origin + '/admin/?split-check=' + fixture.season + '-' + fixture.year + '#generate');
        await page.locator('label[for=season-' + fixture.season + ']').click();
        await page.locator('input[name=hebrewYear]').fill(String(fixture.year));
        await page.locator('#gen-form button[type=submit]').click(); await settle();
        assert.equal(await page.locator('input[name=numPages]').inputValue(), String(fixture.count));
        assert.equal(await page.locator('.page-size').count(), fixture.count, 'The allocation inputs match the default page count');
        const sizes = await page.locator('.page-size').evaluateAll(inputs => inputs.map(input => Number(input.value)));
        assert(Math.max(...sizes) - Math.min(...sizes) <= 1, 'Default parts stay evenly balanced');
        if (fixture.season === 'choref' && [5784, 5787].includes(fixture.year)) assert.deepEqual(sizes, [10, 9, 9]);
        if (fixture.season === 'choref' && fixture.year === 5790) assert.deepEqual(sizes, [9, 10, 9], 'Match the approved PDF, with Chanukah on the middle chart');
        await page.locator('#page-form button[type=submit]').click(); await page.locator('#pages .page').first().waitFor(); await settle();
        assert.equal(await page.locator('#pages .page').count(), fixture.count * 2);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const times = await page.locator('#pages').evaluate(el => [...new Set(el.innerText.match(/(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?![\d:])/g) || [])]);
        await page.emulateMedia({ media: 'print' }); await settle();
        const geometry = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => {
          const box = page.getBoundingClientRect(), footer = page.querySelector('.page-footer').getBoundingClientRect();
          const tables = [...page.querySelectorAll('table')].map(table => table.getBoundingClientRect());
          return { height: page.offsetHeight, footerInside: footer.bottom <= box.bottom + 1,
            tablesClear: tables.every(table => table.bottom <= footer.top + 1), overflow: page.scrollHeight > page.clientHeight + 1 };
        }));
        assert(geometry.every(g => g.height === 816 && g.footerInside && g.tablesClear && !g.overflow), JSON.stringify({ fixture, geometry }));
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, fixture.count * 2);
        assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 792 612]'));
        const text = execFileSync('pdftotext', ['-raw', '-', '-'], { input: pdf, encoding: 'utf8' });
        for (const time of times) assert(text.includes(time), 'PDF retains ' + time);
        if (output) fs.writeFileSync(path.join(output, width + '-' + fixture.season + '-' + fixture.year + '.pdf'), pdf);
        await page.emulateMedia({ media: 'screen' });
        checks.push({ width, ...fixture, sizes, nativePages: fixture.count * 2 });
      }
      await page.goto(origin + '/chart/?count=off&website-preview=2026-09-15T23%3A22%3A00.000Z');
      await page.locator('#chart-host .page').first().waitFor(); await settle();
      assert.equal(await page.locator('#chart-host .page').count(), 2);
      const automatic = await page.evaluate(async () => {
        const { loadPublished } = await import('/js/publish.js');
        const state = await loadPublished({ automatic: true });
        return state.sheets.filter(s => s.season !== 'weekday').map(s => ({ season: s.season, year: s.hebrewYear, sizes: s.pageSizes }));
      });
      for (const sheet of automatic) {
        const leap = [5784, 5787, 5790].includes(sheet.year);
        assert.equal(sheet.sizes.length, sheet.season === 'choref' && leap ? 3 : 2);
        assert(Math.max(...sheet.sizes) - Math.min(...sheet.sizes) <= 1);
        if (sheet.season === 'choref' && [5784, 5787].includes(sheet.year)) assert.deepEqual(sheet.sizes, [10, 9, 9]);
      }
      assert.deepEqual(automatic.find(s => s.season === 'kayitz' && s.year === 5786).sizes, [11, 11]);
      if (output) await page.screenshot({ path: path.join(output, width + '-public-summer.png'), fullPage: true });
      checks.push({ width, public: automatic });
      await page.goto(origin + '/chart/?count=off&website-preview=2029-11-23T15%3A00%3A00.000Z');
      await page.locator('#chart-host .page').first().waitFor(); await settle();
      assert((await page.locator('.week-nav-when').innerText()).includes('December 1, 2029'), 'The first public part ends before Chanukah');
      assert(!(await page.locator('#chart-host .shacharis-panel').innerText()).includes('חנוכה'));
      if (output) await page.screenshot({ path: path.join(output, width + '-public-before-chanukah.png'), fullPage: true });
      await page.goto(origin + '/chart/?count=off&website-preview=2029-12-07T15%3A00%3A00.000Z');
      await page.locator('#chart-host .page').first().waitFor(); await settle();
      assert((await page.locator('.week-nav-when').innerText()).includes('December 8, 2029'));
      assert((await page.locator('.week-nav-when').innerText()).includes('February 9, 2030'));
      assert((await page.locator('#chart-host .pages').innerText()).includes('חנוכה'));
      if (output) await page.screenshot({ path: path.join(output, width + '-public-chanukah-middle.png'), fullPage: true });
      await page.goto(origin + '/chart/?count=off&website-preview=2030-03-01T15%3A00%3A00.000Z');
      await page.locator('#chart-host .page').first().waitFor(); await settle();
      assert((await page.locator('.week-nav-when').innerText()).includes('February 16, 2030'));
      assert(!(await page.locator('#chart-host .pages').innerText()).includes('חנוכה'), 'No Chanukah remainder is printed on the third part');
      if (output) await page.screenshot({ path: path.join(output, width + '-public-after-chanukah.png'), fullPage: true });
      checks.push({ width, publicChanukah: 'middle part only', secondPartStarts: '2029-12-08', thirdPartStarts: '2030-02-16' });
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
