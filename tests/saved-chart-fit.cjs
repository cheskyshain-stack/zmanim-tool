// Fractional screen placement must not shrink a correctly sized chart on paper.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.CHART_FIT_OUTPUT;
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
  const origin = process.env.CHART_FIT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], results = [];
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [375, 1440]) for (const mode of ['simple', 'classic']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width === 375, deviceScaleFactor: width === 375 ? 3 : 1 });
      await context.addInitScript(mode => {
        localStorage.setItem('zmanim-nocount', '1');
        localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
        localStorage.setItem('zmanim-print-navigation', mode);
      }, mode);
      if (!process.env.CHART_FIT_ORIGIN) await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.goto(origin + '/admin/#generate');
      await page.locator('label[for=season-choref]').click();
      await page.locator('input[name=hebrewYear]').fill('5787');
      await page.locator('#gen-form button[type=submit]').click();
      await page.locator('#page-form button[type=submit]').click();
      await page.locator('#pages .page').first().waitFor(); await settle();
      await page.goto(origin + '/admin/#saved'); await page.reload();
      await page.locator('.saved-list .open-btn').first().click(); await settle();
      const saved = await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1'));
      const original = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => ({ text: page.innerText, font: parseFloat(getComputedStyle(page).getPropertyValue('--sheet-font-size')) })));
      assert.equal(original.length, 6);
      assert(original.every(page => page.font >= 9.5), 'Normal winter charts start with readable text');
      for (const offset of [0.1, 0.2, 0.3]) {
        const placement = await page.addStyleTag({ content: `@media screen { main { transform: translateY(${offset}px); } }` });
        await page.locator('#print-navigation-mode').click(); await page.locator('#print-navigation-mode').click(); await settle();
        const after = await page.locator('#pages .page').evaluateAll(pages => pages.map(page => ({ text: page.innerText, font: parseFloat(getComputedStyle(page).getPropertyValue('--sheet-font-size')) })));
        assert.deepEqual(after, original, `${width}/${mode}/${offset}: fractional positioning preserves times and full font sizes`);
        assert(await page.locator('#page-overflow-warning').isHidden(), 'A correctly sized page has no overflow warning');
        assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), saved, 'Fitting never changes saved charts or settings');
        await placement.evaluate(element => element.remove());
        results.push({ width, mode, offset, fonts: after.map(page => page.font) });
      }
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 6, 'The job prints on six physical sheets');
      assert((pdf.toString('latin1').match(/\/MediaBox \[[^\]]+\]/g) || []).every(box => box === '/MediaBox [0 0 792 612]'), 'Every sheet is landscape Letter');
      const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
      assert(/\d{1,2}:\d{2}/.test(text), 'Printed times remain selectable text');
      if (output) {
        fs.writeFileSync(path.join(output, `${width}-${mode}.pdf`), pdf);
        await page.screenshot({ path: path.join(output, `${width}-${mode}.png`), fullPage: true });
      }

      // An actual content overflow still warns, and reopening recovers automatically.
      const overflow = await page.addStyleTag({ content: '#pages .page-header { min-height: 900px !important; }' });
      await page.locator('#print-navigation-mode').click(); await page.locator('#print-navigation-mode').click(); await settle();
      assert(await page.locator('#page-overflow-warning').isVisible(), 'Genuine overflow is still detected');
      await overflow.evaluate(element => element.remove());
      await page.locator('#print-navigation-mode').click(); await page.locator('#print-navigation-mode').click(); await settle();
      assert(await page.locator('#page-overflow-warning').isHidden(), 'Reopening restores a correctly fitting chart');
      assert.deepEqual(await page.locator('#pages .page').evaluateAll(pages => pages.map(page => parseFloat(getComputedStyle(page).getPropertyValue('--sheet-font-size')))), original.map(page => page.font));
      assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), saved);
      await context.close();
    }
    assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ fractionalFixtures: results.length, widths: [375, 1440], modes: ['simple', 'classic'], errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
