// Build first. Uses real browser PDFs, PDF.js, and independent MuPDF inspection.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = process.env.CMYK_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cmyk-pdf-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/data/seats-sync.json') {
    res.setHeader('Content-Type', 'application/json'); return res.end('{"endpoint":""}');
  }
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const inspect = String.raw`
import sys,fitz,json,numpy as np
src=fitz.open(sys.argv[1]); dst=fitz.open(sys.argv[2]); assert len(src)==len(dst)
measurements=[]
for original,converted in zip(src,dst):
 assert abs(original.rect.width-converted.rect.width)<.01 and abs(original.rect.height-converted.rect.height)<.01
 images=converted.get_images(full=True); assert len(images)==1 and images[0][5]=='DeviceCMYK', images
 assert not converted.get_text(), 'Only this explicit CMYK copy is flattened'
 raw=dst.xref_stream(images[0][0]); a=np.frombuffer(raw,dtype=np.uint8).reshape(-1,4)
 assert ((a[:,:3]==0).all(axis=1)&(a[:,3]==255)).sum()>100,'Solid text uses pure black'
 assert ((a[:,:3]==0).all(axis=1)&(a[:,3]==0)).sum()>100,'White paper uses no ink'
 before=original.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)
 after=converted.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)
 b=np.frombuffer(before.samples,dtype=np.uint8).astype(float)
 c=np.frombuffer(after.samples,dtype=np.uint8).astype(float)
 mae=abs(b-c).mean(); assert mae<14, ('Layout or appearance changed',mae)
 measurements.append({'points':list(original.rect)[2:],'pixels':[images[0][2],images[0][3]],'meanPixelDifference':round(mae,3)})
for xref in range(1,dst.xref_length()):
 obj=dst.xref_object(xref)
 assert '/DeviceRGB' not in obj and '/ICCBased' not in obj
 if '/Type /XObject' not in obj:
  stream=dst.xref_stream(xref) or b''
  assert b' rg' not in stream and b' RG' not in stream
print(json.dumps(measurements))
`;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const requests = [], errors = [];
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
      localStorage.setItem('zmanim-nocount', '1');
      localStorage.setItem('zmanim-poster-bar-v1', JSON.stringify({ year: 5787, sheet: 'vasikinboth', design: 'new', margin: .2, marginDefault: .15 }));
    });
    const page = await context.newPage();
    page.on('request', req => requests.push({ url: req.url(), method: req.method() }));
    page.on('pageerror', e => errors.push(e.message));
    const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200); };
    const convert = async (name, source, button = '[data-cmyk-pdf]') => {
      const original = path.join(output, name + '.pdf'), converted = path.join(output, name + '-CMYK.pdf');
      fs.writeFileSync(original, source);
      await page.locator(button).click();
      await page.locator('#cmyk-pdf-file').setInputFiles(original);
      await page.locator('[data-convert]').click();
      await page.locator('[data-download]:visible').waitFor({ timeout: 120000 });
      assert.equal(await page.locator('.cmyk-pdf-status').textContent(), 'Your CMYK PDF is ready.');
      if (name === 'chart') await page.screenshot({ path: path.join(output, 'cmyk-dialog-desktop.png') });
      const downloadEvent = page.waitForEvent('download');
      await page.locator('[data-download]').click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), name + '-CMYK.pdf');
      await download.saveAs(converted);
      console.log(name, execFileSync('python', ['-c', inspect, original, converted], { encoding: 'utf8' }).trim());
      await page.locator('.cmyk-pdf-dialog [data-close]').click();
      return converted;
    };
    await page.goto(origin + '/chart/?count=off');
    await page.locator('.pages .page').first().waitFor(); await settle();
    assert(!requests.some(r => r.url.includes('pdfjs')), 'PDF.js stays unloaded on an ordinary visit');
    const chart = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    assert(execFileSync('pdftotext', ['-', '-'], { input: chart, encoding: 'utf8' }).includes('Bais'), 'Native printing retains selectable text');
    await convert('chart', chart);
    const controlsFit = async () => {
      const boxes = await page.locator('[data-cmyk-pdf]').evaluateAll(nodes => nodes.map(node => {
        const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, height: b.height, width: innerWidth };
      }));
      assert(boxes.length); assert(boxes.every(b => b.left >= 0 && b.right <= b.width && b.height >= 44));
    };
    // Mobile dialog, invalid/encrypted input, Escape, and cancellation.
    await page.setViewportSize({ width: 375, height: 812 });
    await controlsFit();
    await page.locator('[data-cmyk-pdf]').click();
    const geometry = await page.locator('.cmyk-pdf-dialog').evaluate(el => {
      const b = el.getBoundingClientRect(), close = el.querySelector('[data-close]').getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, close: [close.width, close.height] };
    });
    assert(geometry.left >= 0 && geometry.right <= 375 && geometry.top >= 0 && geometry.bottom <= 812);
    assert(geometry.scrollWidth <= geometry.clientWidth); assert(geometry.close.every(v => v >= 44));
    console.log('phone dialog', JSON.stringify(geometry));
    await page.screenshot({ path: path.join(output, 'cmyk-dialog-phone.png') });
    await page.locator('#cmyk-pdf-file').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid input') });
    await page.locator('[data-convert]').click();
    await page.getByRole('status').filter({ hasText: 'could not be read' }).waitFor();
    assert.equal(await page.locator('[data-download]:visible').count(), 0);
    const protectedPdf = path.join(output, 'protected.pdf');
    execFileSync('python', ['-c', 'import fitz,sys; d=fitz.open(); d.new_page(); d.save(sys.argv[1], encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw="owner",user_pw="test")', protectedPdf]);
    await page.locator('#cmyk-pdf-file').setInputFiles(protectedPdf); await page.locator('[data-convert]').click();
    await page.getByRole('status').filter({ hasText: 'password protected' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-cmyk-pdf]').click();
    await page.locator('#cmyk-pdf-file').setInputFiles(path.join(output, 'chart.pdf'));
    await page.locator('[data-convert]').click();
    await page.locator('.cmyk-pdf-dialog [data-close]').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('dialog.cmyk-pdf-dialog').count(), 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/admin/#posters/vasikinboth');
    await page.locator('.is-modern-vasikin').waitFor(); await settle();
    await convert('netz', await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    await page.setViewportSize({ width: 320, height: 812 }); await controlsFit();
    await page.locator('[data-cmyk-pdf]').click();
    const fitsSmallPhone = await page.locator('.cmyk-pdf-dialog').evaluate(el => {
      const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight && el.scrollWidth <= el.clientWidth;
    });
    assert(fitsSmallPhone); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    // A rotated, mixed-paper PDF exercises physical page geometry separately.
    const mixed = path.join(output, 'mixed.pdf');
    execFileSync('python', ['-c', 'import fitz,sys; d=fitz.open(); p=d.new_page(width=612,height=792); p.insert_text((40,50),"Portrait black text"); p.draw_rect(fitz.Rect(40,80,130,160),color=(1,0,0),fill=(1,0,0)); p=d.new_page(width=1224,height=792); p.insert_text((40,50),"Tabloid landscape text"); p.set_rotation(90); d.save(sys.argv[1])', mixed]);
    await convert('mixed', fs.readFileSync(mixed));
    const { seatsCreateState, seatsWriteName } = await import('../js/seats/model.js');
    const sample = seatsCreateState(), plan = sample.plans[0];
    plan.paper = 'letter'; plan.name = 'Synthetic CMYK test'; seatsWriteName(plan, 'A1', 0, 'Print Test');
    await page.evaluate(sample => localStorage.setItem('lakewood-commons-seats-v1', JSON.stringify(sample)), sample);
    await page.goto(origin + '/seats/');
    await page.locator('#seats-name').fill('Synthetic Test'); await page.locator('#seats-pin').fill('4444');
    await page.getByRole('button', { name: 'Open Seats', exact: true }).click();
    await page.getByRole('button', { name: 'View saved charts', exact: true }).click();
    await page.locator('.sharing-local-plan .saved-page-card[data-id="' + plan.id + '"]').click(); await settle();
    const seats = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.locator('#chart-more').evaluate(el => el.open = true);
    await convert('seats', seats, '[data-action="cmyk-pdf"]');
    await page.locator('#chart-more').evaluate(el => el.open = true);
    await page.getByRole('button', { name: 'Alphabetical seat list', exact: true }).click();
    await page.locator('[data-action="cmyk-pdf"]').click();
    await page.locator('.cmyk-pdf-dialog').waitFor(); await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    assert(!requests.some(r => r.method !== 'GET'), 'No file data is uploaded');
    assert(requests.filter(r => r.url.includes('pdfjs')).every(r => r.url.startsWith(origin + '/vendor/')), 'All conversion resources stay first party');
    await browser.close();
    console.log('CMYK conversion checks passed:', output);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
