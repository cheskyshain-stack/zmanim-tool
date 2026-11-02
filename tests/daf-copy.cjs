const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../dist');
const live = process.env.LIVE_ORIGIN;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  if (!live) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = live || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'chrome', headless: true });
  const results = [], errors = [];
  try {
    for (const [width, height] of [[320, 568], [375, 812], [412, 915], [1440, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: width < 760 });
      await context.addInitScript(() => {
        try { localStorage.setItem('zmanim-nocount', '1'); } catch {}
      });
      // Check our embed lifecycle with an inert merchant form, without sending any payment data.
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/')) return route.continue();
        if (url.startsWith('https://secure.cardknox.com/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><label>Name <input id="donor-name"></label>' });
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/donate/?count=off&donation_check=' + Date.now());
      const campaigns = page.locator('.luach-campaign');
      await campaigns.first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await campaigns.locator('.luach-account-title').allTextContents(),
        ['Bais Medrash', 'Ravs Fund', 'Eiruv / Building Fund', 'Neileich', 'Keren Zichron Zechariah']);
      assert.equal(await page.locator('.luach-campaign-toggle[aria-expanded="true"]').count(), 0);
      assert.equal(await page.locator('.luach-payment-tab:visible').count(), 0, 'Payment choices start collapsed');
      assert.equal(await page.locator('.luach-frame').count(), 0, 'No merchant forms load before a method is selected');
      assert.equal(await page.locator('[data-method="zelle"]').count(), 1);
      if (process.env.ARTIFACT_DIR && width === 375) await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, 'campaigns-collapsed.png'), fullPage: true });
      await page.evaluate(() => {
        window.copyWrites = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copyWrites.push(text) } });
      });
      const layouts = [];
      for (let index = 0; index < 5; index++) {
        const campaign = campaigns.nth(index), toggle = campaign.locator('.luach-campaign-toggle');
        const card = campaign.locator('[data-method="card"]'), daf = campaign.locator('[data-method="shul"]');
        const title = await campaign.locator('.luach-account-title').innerText();
        await toggle.click();
        assert.equal(await page.locator('.luach-campaign-toggle[aria-expanded="true"]').count(), 1);
        assert.equal(await page.locator('.luach-payment-tab:visible').count(), index === 3 ? 3 : 2);
        assert.equal(await campaign.locator('.luach-payment-panel:visible').count(), 0, 'Details wait for the payment-method click');
        const position = await toggle.evaluate(node => ({ top: node.getBoundingClientRect().top,
          cap: document.querySelector('.luach-bar').getBoundingClientRect().bottom }));
        assert(Math.abs(position.top - position.cap - 8) < 2, title + ' is aligned below the header: ' + JSON.stringify(position));
        await card.click();
        const frame = page.frameLocator('.luach-frame');
        assert.equal(await page.locator('.luach-frame').count(), 1);
        assert.equal(await campaign.locator('iframe').getAttribute('src'), await campaign.locator('.luach-give-go').getAttribute('href'));
        assert.equal(await campaign.locator('iframe').getAttribute('title'), title + ' donation form');
        assert.equal(await campaign.locator('iframe').getAttribute('allow'), 'payment');
        if (index === 3) assert.equal(await campaign.locator('.luach-frame-website').getAttribute('href'), 'https://www.neileich.org/');
        assert.match(await campaign.locator('.luach-frame-where').innerText(), /secure\.cardknox\.com/);
        await frame.locator('#donor-name').fill('Preserved ' + title);
        await campaign.locator('iframe').evaluate(node => window.savedDonationFrame = node);
        await daf.click();
        const dafPanel = campaign.locator('.luach-payment-panel:not([hidden])');
        assert.equal(await dafPanel.count(), 1);
        assert.match(await dafPanel.innerText(), new RegExp('Designate your gift for ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        const providers = dafPanel.locator('.luach-daf-provider');
        assert.deepEqual(await providers.locator('img').evaluateAll(images => images.map(img => img.alt)),
          ['The Donors Fund', 'Pledger', 'OJC Fund', 'Matbia', 'iMaaser']);
        await page.waitForFunction(id => [...document.getElementById(id).querySelectorAll('.luach-daf-provider img')].every(img => img.complete && img.naturalWidth > 0), await dafPanel.getAttribute('id'));
        const rows = await providers.evaluateAll(links => links.map(link => {
          const row = link.getBoundingClientRect(), logo = link.querySelector('img').getBoundingClientRect(), arrow = link.querySelector('svg').getBoundingClientRect();
          return { height:row.height, fits:logo.left >= row.left && logo.right <= arrow.left - 16 && arrow.right <= row.right };
        }));
        assert(rows.every(row => row.height >= 44 && row.height <= 57 && row.fits));
        for (const provider of await providers.all()) {
          assert.equal(await provider.getAttribute('target'), '_blank');
          assert.equal(await provider.getAttribute('data-tax-id'), '26-4527675');
        }
        const provider = providers.last();
        assert.equal(await provider.getAttribute('href'), 'https://app.imaaser.org/donor/login');
        await provider.evaluate(link => link.addEventListener('click', event => event.preventDefault(), {once:true}));
        await provider.click();
        const einCopy = dafPanel.locator('.luach-copy-btn');
        assert.equal(await einCopy.innerText(), 'Copy EIN');
        await einCopy.click();
        await page.waitForFunction(id => document.getElementById(id).querySelector('.luach-copy-btn').textContent === 'Copied', await dafPanel.getAttribute('id'));
        assert((await einCopy.boundingBox()).height >= 44);
        if (index === 3) {
          const zelle = campaign.locator('[data-method="zelle"]');
          await zelle.click();
          const panel = campaign.locator('.luach-payment-panel.is-zelle');
          assert(await panel.isVisible());
          assert.equal(await panel.locator('.luach-zelle-recipient').innerText(), 'Bais Medrash of Lakewood Commons');
          assert.equal(await panel.locator('.luach-copy-value').innerText(), 'donations@neileich.org');
          const copy = panel.locator('.luach-copy-btn');
          assert.equal(await copy.innerText(), 'Copy email');
          await copy.click();
          assert((await copy.boundingBox()).height >= 44);
          assert(await panel.locator('.luach-copy-value').evaluate(node => {
            const text = document.createRange(); text.selectNodeContents(node);
            const bounds = node.closest('.luach-copy').getBoundingClientRect();
            return [...text.getClientRects()].every(rect => rect.left >= bounds.left && rect.right <= bounds.right);
          }));
          if (process.env.ARTIFACT_DIR) await page.screenshot({path:path.join(process.env.ARTIFACT_DIR, `neileich-zelle-${width}.png`),fullPage:true});
        }
        await card.click();
        assert.equal(await frame.locator('#donor-name').inputValue(), 'Preserved ' + title);
        assert(await campaign.locator('iframe').evaluate(node => node === window.savedDonationFrame));
        if (width === 375) {
          await page.setViewportSize({width:812,height:375});
          assert.equal(await frame.locator('#donor-name').inputValue(), 'Preserved ' + title);
          await page.setViewportSize({width,height});
          assert.equal(await frame.locator('#donor-name').inputValue(), 'Preserved ' + title);
        }
        await card.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await daf.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Home');
        assert.equal(await card.getAttribute('aria-expanded'), 'true');
        assert(await card.evaluate(node => node === document.activeElement));
        await campaign.getByRole('button', {name:'Close the donation form'}).click();
        assert.equal(await page.locator('.luach-frame').count(), 0);
        assert(await campaign.locator('.luach-give-go').evaluate(node => node === document.activeElement));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        layouts.push({title, position, methods:index === 3 ? 3 : 2});
      }
      assert.deepEqual(await page.evaluate(() => window.copyWrites), ['26-4527675','donations@neileich.org']);
      await page.reload();
      await campaigns.first().waitFor();
      assert.equal(await page.locator('.luach-payment-tab:visible').count(),0);
      await campaigns.first().locator('.luach-campaign-toggle').click();
      await campaigns.first().locator('[data-method="shul"]').click();
      const copy = campaigns.first().locator('.luach-copy-btn').filter({hasText:'Copy EIN'});
      await page.evaluate(() => {
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}});
        document.execCommand = () => false;
      });
      await copy.click();
      const retry = campaigns.first().getByRole('button',{name:'Try again',exact:true});
      await retry.waitFor();
      await page.evaluate(() => {
        window.retryWrites=[];
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.retryWrites.push(text)}});
      });
      await retry.click();
      await campaigns.first().getByRole('button',{name:'Copied',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.retryWrites),['26-4527675']);
      if (process.env.ARTIFACT_DIR && width === 375) {
        await page.reload();
        await campaigns.first().waitFor();
        const neileich = campaigns.nth(3);
        await neileich.locator('.luach-campaign-toggle').click();
        await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'neileich-payment-choices.png')});
        await neileich.locator('[data-method="zelle"]').click();
        const top = await neileich.locator('.luach-campaign-toggle').evaluate(node => node.getBoundingClientRect().top);
        assert(Math.abs(top - 72) < 2);
        await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'neileich-zelle-screen.png')});
      }
      results.push({width,height,layouts,clipboard:'EIN once, Zelle and retry verified',forms:'all five, method switching retains entries'});
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ origin, results, errors }));
  } finally {
    await browser.close();
    if (!live) server.close();
  }
})().catch(error => { console.error(error); if (!live) server.close(); process.exitCode = 1; });
