// Current-week decoration must never become part of a printable chart.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.CHART_WEEK_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'chart-current-week-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.CHART_WEEK_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true });
  const errors = [], checks = [];
  const makePage = async (width, instant = '2026-11-11T17:00:00Z') => {
    const context = await browser.newContext({ viewport:{ width, height:950 }, timezoneId:'Asia/Jerusalem' });
    await context.addInitScript(() => localStorage.setItem('zmanim-nocount', '1'));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date(instant)); return { context, page };
  };
  const inspect = async page => page.evaluate(async () => {
    const { currentChartWeek } = await import('/js/ui/chart-week-indicator.js');
    const { buildAutomaticCharts } = await import('/js/publish.js');
    const { loadTables } = await import('/js/data-loader.js');
    const { resolveSettings } = await import('/js/settings.js');
    const { websiteNow } = await import('/js/website-clock.js');
    const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), websiteNow());
    const serial = currentChartWeek(state, resolveSettings(state.settings));
    const rows = [...document.querySelectorAll(`.pages tr[data-week-serial="${serial}"]`)];
    const boxes = [...document.querySelectorAll('.chart-current-week-arrow')].map((arrow, index) => {
      const a = arrow.getBoundingClientRect(), r = rows[index].getBoundingClientRect(), p = rows[index].closest('.page').getBoundingClientRect();
      return { serial, row:[r.top,r.bottom,r.left,r.right], arrow:[a.top,a.bottom,a.left,a.right], page:[p.left,p.right], centered:Math.abs((a.top+a.bottom-r.top-r.bottom)/2) < .6, inMargin:a.left >= r.right && a.right <= p.right };
    });
    return { serial, labels:rows.map(row => row.querySelector('.parsha-cell').innerText), rows:rows.length, arrows:boxes, badge:document.querySelector('.chart-current-week-badge')?.textContent,
      badgeHidden:document.querySelector('.chart-current-week-badge')?.hidden, pageDecorations:document.querySelectorAll('.page [class*="chart-current-week"]').length,
      width:innerWidth, scrollWidth:document.documentElement.scrollWidth };
  });
  try {
    for (const width of [320,375,393,768,1440]) {
      const { context, page } = await makePage(width);
      await page.goto(origin + '/chart/'); await page.locator('.chart-current-week-arrow').first().waitFor(); await settle(page);
      let value = await inspect(page);
      assert.equal(value.rows, 2); assert(value.labels.every(label => label.includes('תולדות')));
      assert.equal(value.arrows.length, 2); assert(value.arrows.every(box => box.centered && box.inMargin), JSON.stringify(value));
      assert.equal(value.pageDecorations, 0, 'No marker, highlight or label is added to a printable sheet');
      assert(value.badge.includes('This week') && value.badge.includes('תולדות'));
      assert(value.scrollWidth <= width);
      await page.screenshot({ path:path.join(output, width + '-current-week.png'), fullPage:true });
      await page.setViewportSize({ width:width === 1440 ? 844 : width + 20, height:700 }); await settle(page);
      value = await inspect(page); assert(value.arrows.every(box => box.centered && box.inMargin), 'Markers follow resized charts');
      await page.setViewportSize({ width, height:950 }); await settle(page);
      if ([375,1440].includes(width)) {
        const pdf = await page.pdf({ preferCSSPageSize:true, printBackground:true });
        assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
        const text = execFileSync('pdftotext', ['-layout','-','-'], { input:pdf, encoding:'utf8' });
        assert(!text.includes('This week'));
        fs.writeFileSync(path.join(output, width + '-with-indicator.pdf'), pdf);
        const before = await page.locator('.pages .page').evaluateAll(pages => pages.map(page => page.innerHTML));
        await page.evaluate(() => document.querySelectorAll('.chart-current-week-layer,.chart-current-week-badge').forEach(node => node.remove()));
        const clean = await page.pdf({ preferCSSPageSize:true, printBackground:true });
        assert.deepEqual(await page.locator('.pages .page').evaluateAll(pages => pages.map(page => page.innerHTML)), before);
        assert.equal(execFileSync('pdftotext',['-layout','-','-'],{input:clean,encoding:'utf8'}), text);
        fs.writeFileSync(path.join(output, width + '-without-indicator.pdf'), clean);
        for (const [name, bytes] of [['with',pdf],['without',clean]]) execFileSync('pdftoppm',['-r','96','-png','-',path.join(output,width+'-'+name)],{input:bytes,stdio:['pipe','ignore','pipe']});
        execFileSync('python',['-c', 'from PIL import Image,ImageChops\nimport sys\nfrom pathlib import Path\np=Path(sys.argv[1]); w=sys.argv[2]\na=sorted(p.glob(w+"-with-*.png"));b=sorted(p.glob(w+"-without-*.png"))\nassert len(a)==len(b)==2\nfor x,y in zip(a,b):\n assert ImageChops.difference(Image.open(x).convert("RGB"),Image.open(y).convert("RGB")).getbbox() is None,(x,y)\n',output,String(width)]);
      }
      checks.push({ width, ...value, printedPixelsIdentical:[375,1440].includes(width) });
      if (width === 320) {
        await page.addStyleTag({ content:'@media screen { .pages .page { padding-right:3px !important; } }' });
        await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await settle(page);
        const tight = await inspect(page);
        assert(tight.arrows.every(box => box.inMargin) && tight.scrollWidth <= width, 'Very small saved margins never put a pointer outside the chart');
        assert.equal(tight.badgeHidden,false);
      }
      await context.close();
    }
    // A preview follows its chosen clock and never assigns a nearby row to a holiday gap.
    const { context, page } = await makePage(393);
    for (const instant of ['2026-11-18T17:00:00Z','2026-05-20T16:00:00Z','2026-10-01T16:00:00Z']) {
      await page.goto(origin + '/chart/?website-preview=' + encodeURIComponent(instant)); await page.locator('.pages .page').first().waitFor(); await settle(page);
      const value = await inspect(page);
      assert.equal(value.arrows.length, value.rows); assert.equal(value.badgeHidden, value.rows === 0);
      assert(value.arrows.every(box => box.centered && box.inMargin));
      if (instant.startsWith('2026-11-18')) assert(value.labels.every(label => label.includes('ויצא')));
      checks.push({ preview:instant, ...value });
    }
    // Determine the actual printed end of Shabbos, then advance across it by a minute.
    const end = await page.evaluate(async () => {
      const { buildAutomaticCharts } = await import('/js/publish.js'), { loadTables } = await import('/js/data-loader.js');
      const { resolveSettings } = await import('/js/settings.js'), { weekEndsMins } = await import('/js/upcoming.js');
      const { excelSerial } = await import('/js/zmanim/solar.js'), { websitePreviewInstant } = await import('/js/website-clock.js');
      const state = buildAutomaticCharts(await (await fetch('/data/published.json')).json(), await loadTables(), new Date('2026-11-14T17:00:00Z'));
      const settings = resolveSettings(state.settings), serial = excelSerial(new Date('2026-11-14T00:00:00Z'));
      const minute = Math.ceil(weekEndsMins(serial,state,settings));
      const time = String(Math.floor(minute / 60)).padStart(2,'0') + ':' + String(minute % 60).padStart(2,'0');
      return { serial, instant:websitePreviewInstant('2026-11-14',time,settings.timezone.id).instant.toISOString() };
    });
    await context.close();
    const live = await makePage(393); await live.page.clock.install({ time:new Date(Date.parse(end.instant)-30000) });
    await live.page.goto(origin+'/chart/'); await live.page.locator('.chart-current-week-arrow').first().waitFor(); await settle(live.page);
    assert.equal((await inspect(live.page)).serial, end.serial);
    await live.page.evaluate(() => { window.originalChartPages = document.querySelector('.pages'); });
    await live.page.clock.fastForward(61000); await live.page.clock.runFor(100);
    const after = await inspect(live.page); assert.equal(after.serial,end.serial+7); assert(after.labels.every(label=>label.includes('ויצא')));
    assert(await live.page.evaluate(() => window.originalChartPages === document.querySelector('.pages')), 'The weekly marker moves without rebuilding or flashing the charts');
    await live.page.getByRole('link',{name:'Back to Weekly Zmanim',exact:true}).click(); await live.page.locator('#week-host').waitFor();
    assert.equal(await live.page.locator('.chart-current-week-layer,.chart-current-week-badge').count(),0);
    checks.push({ automaticRollover:true, cleanupOnNavigation:true }); await live.context.close();
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(checks,null,2));
    console.log('Current-week layout, date previews, rollover and identical print/PDF pixels passed: '+output);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
