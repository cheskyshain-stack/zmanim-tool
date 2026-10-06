// Run after build-offline.py. Requires Playwright, pdftotext and pdftoppm.
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
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

async function verifyPdf(page, count, label, neutral = true, selector = '#pages') {
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const tableTops = await page.locator(selector + ' .page').evaluateAll(charts => charts.map(chart =>
    Math.ceil(chart.querySelector('table').getBoundingClientRect().top - chart.getBoundingClientRect().top)));
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const text = spawnSync('pdftotext', ['-bbox', '-', '-'], { input: pdf, encoding: 'utf8' });
  assert.equal(text.status, 0, label + ': extract PDF text');
  const pages = [...text.stdout.matchAll(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)];
  assert.equal(pages.length, count, label + ': physical page count');
  for (const [index, physical] of pages.entries()) {
    assert.equal(Number(physical[1]), 792, label + ': landscape Letter width');
    assert.equal(Number(physical[2]), 612, label + ': landscape Letter height');
    assert(physical[3].includes('Bais'), label + ': selectable footer text on page ' + (index + 1));
    assert(/<word\b[^>]*>\d{1,2}:\d{2}<\/word>/.test(physical[3]), label + ': selectable times on page ' + (index + 1));
  }
  let chromatic = 0, black = 0, gray = 0;
  for (let index = 0; index < count; index++) {
    const rendered = spawnSync('pdftoppm', ['-f', String(index + 1), '-singlefile', '-r', '96', '-'], { input: pdf, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(rendered.status, 0, label + ': render physical PDF page: ' + rendered.stderr);
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(rendered.stdout.toString('latin1', 0, 100));
    assert(header, label + ': RGB raster header');
    const width = Number(header[1]), height = Number(header[2]), pixels = rendered.stdout.subarray(header[0].length);
    assert.equal(width, 1056);
    assert.equal(height, 816);
    assert.equal(pixels.length, width * height * 3);
    // The building photograph stays in colour above the table. Check the actual
    // printed table, shadows, footer and paper beneath it, including antialiased text.
    for (let at = tableTops[index] * width * 3; at < pixels.length; at += 3) {
      const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 1) chromatic++;
      if (Math.max(r, g, b) === 0) black++;
      if (r === g && g === b && r > 180 && r < 245) gray++;
    }
  }
  assert(black > 100, label + ': solid black print text');
  if (neutral) {
    assert.equal(chromatic, 0, label + ': no tinted pixels in the printed chart or paper');
    assert(gray > 1000, label + ': gray row shading remains');
  } else {
    assert(chromatic > 1000, label + ': a chosen custom colour still prints in colour mode');
  }
  if (process.env.CHART_PRINT_COLOR_DIR) fs.writeFileSync(path.join(process.env.CHART_PRINT_COLOR_DIR, label + '.pdf'), pdf);
  await page.emulateMedia({ media: 'screen' });
  console.log(JSON.stringify({ label, pages: count, chromatic, black, gray }));
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/chart/?count=off');
    await page.locator('.pages .page').first().waitFor();
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(249, 246, 239)', 'Public screen keeps its cream background');
    await verifyPdf(page, 2, 'Public chart', true, '.pages');
    await page.goto(origin + '/admin/#generate');
    await page.locator('label[for=season-choref]').click();
    await page.locator('input[name=hebrewYear]').fill('5787');
    await page.locator('#gen-form button[type=submit]').click();
    await page.locator('#page-form button[type=submit]').click();
    await page.locator('#pages .page').first().waitFor();
    await verifyPdf(page, 6, 'Default chart');
    const reopen = async () => {
      await page.reload();
      await page.locator('[data-section="saved"]').click();
      await page.locator('.saved-list .open-btn').first().click();
      await page.locator('#pages .page').first().waitFor();
    };
    // An existing browser has the old default in both settings and saved sheets.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      state.settings.sheetStyle.accentColor = '#c9ced5';
      state.sheets.forEach(sheet => { sheet.style.accentColor = '#c9ced5'; });
      localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
    });
    await reopen();
    await verifyPdf(page, 6, 'Saved old default');
    await page.locator('label[for=chart-ink-mono]').click();
    await verifyPdf(page, 6, 'Black and white');
    // Restore a genuine custom colour through the same saved-state loading path.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      state.settings.chartInk = 'colour';
      state.settings.sheetStyle.accentColor = '#335c81';
      state.sheets.forEach(sheet => { sheet.style.accentColor = '#335c81'; });
      localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
    });
    await reopen();
    await verifyPdf(page, 6, 'Custom colour', false);
    await page.locator('label[for=chart-ink-mono]').click();
    await verifyPdf(page, 6, 'Custom black and white');
    await page.locator('label[for=chart-ink-colour]').click();
    await verifyPdf(page, 6, 'Custom colour restored', false);
    assert.deepEqual(errors, [], 'No browser errors');
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
