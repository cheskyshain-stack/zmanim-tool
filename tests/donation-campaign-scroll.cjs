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
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  const results = [], errors = [];
  try {
    for (const width of [375,1440]) {
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'no-preference'});
      await context.addInitScript(() => {
        localStorage.setItem('zmanim-nocount','1');
        window.scrollSamples=[];
        addEventListener('scroll',()=>window.scrollSamples.push({time:performance.now(),y:scrollY}));
      });
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/') ? route.continue() : route.abort());
      const page=await context.newPage();page.setDefaultTimeout(10000);
      page.on('pageerror',error=>errors.push(error.message));
      const open=async()=>{
        await page.goto(origin+'/donate/?scroll-check='+Date.now(),{waitUntil:'domcontentloaded'});
        await page.locator('.luach-campaign-toggle').first().waitFor();
        await page.evaluate(()=>document.fonts.ready);
      };
      const alignment=()=>page.locator('.luach-campaign-toggle[aria-expanded="true"]').evaluate(node=>({
        top:node.getBoundingClientRect().top,cap:document.querySelector('.luach-bar').getBoundingClientRect().bottom,y:scrollY,
      }));
      await open();
      await page.locator('.luach-campaign-toggle').last().evaluate(toggle => {
        toggle.addEventListener('click', () => {
          const panel = toggle.closest('.luach-campaign').querySelector('.luach-campaign-details');
          const started = performance.now();
          window.campaignOpeningSamples = [];
          const sample = () => {
            window.campaignOpeningSamples.push({time:performance.now()-started,height:panel.getBoundingClientRect().height});
            if (performance.now()-started < 320) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, {capture:true,once:true});
      });
      const beforeCampaign = await page.evaluate(()=>scrollY);
      await page.locator('.luach-campaign-toggle').last().click();
      await page.waitForTimeout(440);
      assert.equal(await page.evaluate(()=>scrollY),beforeCampaign,'Campaign selection reveals options without scrolling');
      const opening = await page.evaluate(()=>window.campaignOpeningSamples);
      const fullHeight = opening.at(-1).height;
      assert(opening.filter(sample=>sample.height>1 && sample.height<fullHeight-1).length>=3,'The campaign visibly unfolds over several frames');
      assert(opening.every((sample,index)=>!index || sample.height>=opening[index-1].height-.5),'The opening grows smoothly');
      assert.equal(await page.locator('.luach-campaign-details.is-opening').count(),0,'Opening cleanup removes clipping');
      await page.locator('.luach-campaign').last().locator('[data-method="shul"]').click();
      await page.waitForTimeout(440);
      const aligned=await alignment(), samples=await page.evaluate(()=>window.scrollSamples);
      assert(Math.abs(aligned.top-aligned.cap-8)<2,JSON.stringify(aligned));
      assert(samples.length>3,'The reveal is visibly animated');
      const duration=samples.at(-1).time-samples[0].time;
      assert(duration>=150 && duration<500, 'The reveal takes a short, visible time: '+duration);
      await page.locator('.luach-campaign-toggle').nth(1).evaluate(node=>node.click());
      await page.locator('.luach-campaign').nth(1).locator('[data-method="shul"]').evaluate(node=>node.click());
      await page.waitForTimeout(60);
      await page.locator('.luach-campaign-toggle').nth(3).evaluate(node=>node.click());
      await page.locator('.luach-campaign').nth(3).locator('[data-method="zelle"]').evaluate(node=>node.click());
      await page.waitForTimeout(440);
      assert.equal(await page.locator('.luach-campaign-toggle[aria-expanded="true"] .luach-account-title').innerText(),'Neileich');
      const replacement=await alignment();
      assert(Math.abs(replacement.top-replacement.cap-8)<2);
      await open();
      await page.locator('.luach-campaign-toggle').last().click();
      await page.waitForTimeout(40);
      await page.locator('.luach-campaign-toggle').last().evaluate(node=>node.click());
      await page.waitForTimeout(260);
      assert.equal(await page.locator('.luach-campaign-details:visible').count(),0,'A quick close stays closed after the opening would finish');
      assert.equal(await page.locator('.luach-campaign-details.is-opening').count(),0);
      await open();
      await page.locator('.luach-campaign-toggle').last().click();
      await page.locator('.luach-campaign').last().locator('[data-method="shul"]').click();
      await page.waitForTimeout(70);
      await page.mouse.wheel(0,-80);
      await page.waitForTimeout(100);
      const interrupted=await page.evaluate(()=>scrollY);
      await page.waitForTimeout(450);
      assert(Math.abs(await page.evaluate(()=>scrollY)-interrupted)<2,'Manual scrolling cancels the animation without pulling back');
      assert((await alignment()).top>80,'The interrupted reveal does not finish later');
      await open();
      await page.locator('.luach-campaign-toggle').last().click();
      await page.locator('.luach-campaign').last().locator('[data-method="shul"]').click();
      await page.waitForTimeout(70);
      await page.locator('.luach-back').click();
      await page.locator('main.is-home').waitFor();
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(()=>scrollY),0,'Navigation cancels any pending donation scroll');
      await page.locator('.luach-item[href="/donate/"]').click();
      await page.locator('.luach-campaign-toggle').first().waitFor();
      assert.equal(await page.locator('.luach-payment-tab:visible').count(),0);
      assert.equal(await page.locator('main').evaluate(node=>node.style.getPropertyValue('--donation-scroll-room')),'','Returning starts without an old scroll spacer');
      results.push({width,duration,frames:samples.length,openingFrames:opening.length,openingHeight:fullHeight,alignment:aligned,manualInterruption:true,replacement:true,navigation:true});
      await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({origin,results,errors}));
  } finally {await browser.close();if(!live)server.close();}
})().catch(error=>{console.error(error);if(!live)server.close();process.exitCode=1;});
