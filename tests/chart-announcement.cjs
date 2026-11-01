const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.CHART_ANNOUNCEMENT_OUTPUT || '/tmp/chart-announcement';
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + '/')) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.CHART_ANNOUNCEMENT_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const checks = [], errors = [];
  const dates = [
    { kind: 'winter', instant: '2026-10-08T12:00:00Z', season: 'Winter Zmanim', id: 'choref:5787:0' },
    { kind: 'summer', instant: '2026-04-12T12:00:00Z', season: 'Summer Zmanim', id: 'kayitz:5786:0' },
    { kind: 'winter-part-two', instant: '2026-12-20T12:00:00Z', season: 'Winter Zmanim', id: 'choref:5787:1' },
  ];
  try {
    for (const width of [320, 393, 760, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('zmanim-nocount', '1'));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const ready = async () => { await page.locator('.luach-menu').waitFor(); await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); };
      for (const fixture of dates) {
        await page.clock.setFixedTime(new Date(fixture.instant));
        await page.goto(origin + '/?count=off'); await ready();
        const dialog = page.locator('.luach-announce[open]');
        await dialog.waitFor();
        assert.equal(await dialog.locator('.luach-announce-season').textContent(), fixture.season);
        assert.equal(await dialog.locator('h2').textContent(), 'New chart is up');
        assert.equal(await dialog.getByRole('link', { name: 'View Chart' }).getAttribute('href'), '/chart/');
        assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-chart-announced')), fixture.id);
        const measure = await dialog.evaluate(el => {
          const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
          const bounds = box(el);
          const nodes = [...el.querySelectorAll('button,a,h2,p,.luach-announce-icon')].map(box);
          return { bounds, nodes, overflow: el.scrollWidth > el.clientWidth, titleFont: getComputedStyle(el.querySelector('h2')).fontFamily,
            text: getComputedStyle(el.querySelector('h2')).color, button: getComputedStyle(el.querySelector('a')).backgroundImage };
        });
        assert(!measure.overflow && measure.bounds.left >= 0 && measure.bounds.right <= width);
        assert(measure.bounds.top >= 0 && measure.bounds.bottom <= 900);
        for (const box of measure.nodes) assert(box.left >= measure.bounds.left && box.right <= measure.bounds.right && box.top >= measure.bounds.top && box.bottom <= measure.bounds.bottom, 'Popup content stays inside its border');
        assert.match(measure.titleFont, /Georgia/);
        assert.match(measure.button, /linear-gradient/);
        assert((await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox()).height >= 44);
        await dialog.screenshot({ path: path.join(output, fixture.kind + '-' + width + '.png') });
        if (width === 393 && fixture.kind === 'winter') await page.screenshot({ path: path.join(output, 'winter-phone.png'), fullPage: true });
        if (fixture.kind === 'winter') await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        else if (fixture.kind === 'summer') await page.keyboard.press('Escape');
        else await page.mouse.click(1, 1);
        await page.locator('.luach-announce').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.luach-announce').count(), 0, 'Close removes the modal');
        await page.reload(); await ready();
        assert.equal(await page.locator('.luach-announce').count(), 0, 'A chart part is announced only once per browser');
        checks.push({ width, ...fixture, height: measure.bounds.height });
      }
      await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
      await page.goto(origin + '/?count=off'); await ready();
      assert.equal(await page.locator('.luach-announce').count(), 0, 'The expired announcement stays hidden');
      await page.evaluate(() => localStorage.setItem('zmanim-chart-announced', 'preview-must-not-change'));
      await page.goto(origin + '/?count=off&website-preview=2026-10-08T12%3A00%3A00.000Z'); await ready();
      await page.locator('.luach-announce[open]').waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-chart-announced')), 'preview-must-not-change');
      if (width === 1440) {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        fs.writeFileSync(path.join(output, 'home.pdf'), pdf);
        const text = execFileSync('pdftotext', ['-raw', '-', '-'], { input: pdf, encoding: 'utf8' });
        assert(!text.includes('New chart is up') && !text.includes('View Chart'), 'The announcement is excluded from paper');
      }
      await page.getByRole('link', { name: 'View Chart', exact: true }).click();
      await page.locator('#chart-host .page').first().waitFor();
      assert.equal(new URL(page.url()).pathname, '/chart/');
      assert.equal(new URL(page.url()).searchParams.get('website-preview'), '2026-10-08T12:00:00.000Z');
      assert.equal(await page.locator('#chart-host .page').count(), 2, 'View Chart opens the actual matching chart pair');
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, widths: [320, 393, 760, 1440], errors }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
