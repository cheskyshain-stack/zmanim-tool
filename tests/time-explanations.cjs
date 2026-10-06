// Run after build-offline.py with Playwright on NODE_PATH.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chrome' }),
  });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const settled = async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => !document.querySelector('.toast'));
      await page.waitForTimeout(100);
    };
    const switchOn = async () => {
      const toggle = page.locator('#explain-times-toggle');
      if (await toggle.getAttribute('aria-pressed') === 'false') await toggle.click();
    };
    const clickTime = async (locator, index = 0) => {
      await locator.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const coords = await locator.evaluate((el, index) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), found = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const m of node.textContent.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g)) {
            const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
            const rect = range.getBoundingClientRect();
            found.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: m[0] });
          }
        }
        return found[index];
      }, index);
      assert(coords, 'A printed time exists to click');
      await page.mouse.click(coords.x, coords.y);
      await page.locator('.time-explain-dialog[open]').waitFor({ timeout: 3000 }).catch(async error => {
        console.error('Click context:', await page.evaluate(coords => ({ hash: location.hash, coords,
          target: document.elementFromPoint(coords.x, coords.y)?.outerHTML,
          explanationTarget: document.elementFromPoint(coords.x, coords.y)?.closest('[data-time-explain]')?.outerHTML,
          active: document.activeElement?.tagName,
          enabled: document.querySelector('#explain-times-toggle')?.getAttribute('aria-pressed'),
        }), coords));
        console.error('Browser errors:', errors);
        throw error;
      });
      assert.equal(await page.locator('.time-explain-dialog .calc-open-printed').innerText(), coords.text);
      const answer = await page.locator('.time-explain-dialog').innerText();
      assert(!answer.includes('Calculation not recorded'), 'A real source exists for ' + coords.text + '\n' + answer);
      return answer;
    };
    const close = async () => {
      await page.keyboard.press('Escape');
      await page.locator('.time-explain-dialog').waitFor({ state: 'hidden' });
    };
    const geometry = () => page.locator('#pages .page').evaluateAll(pages => pages.map(p => ({
      height: p.getBoundingClientRect().height,
      rows: [...p.querySelectorAll('tr')].map(r => r.getBoundingClientRect().height),
      text: p.innerText,
    })));

    await page.goto(origin + '/admin/#generate');
    await page.locator('label[for=season-choref]').click();
    await page.locator('input[name=hebrewYear]').fill('5787');
    await page.locator('#gen-form button[type=submit]').click();
    await page.locator('#page-form button[type=submit]').click();
    await page.locator('#pages .page').first().waitFor(); await settled();
    const before = await geometry();
    const saved = await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1'));
    await switchOn();
    assert.deepEqual(await geometry(), before, 'Explain mode preserves every chart row and value');
    const candles = page.locator('.cell[data-col=H]').first();
    assert.match(await clickTime(candles, 0), /Take off\s+18 minutes/);
    assert.equal(await page.locator('.time-explain-dialog .calc-time').count(), 1, 'Only the clicked time opens');
    await close();
    assert.match(await clickTime(candles, 1), /Starts from\s+שקיעה/); await close();
    assert.match(await clickTime(page.locator('.cell[data-col=E]').first()), /Fixed time/); await close();
    const sermon = page.locator('.cell[data-col=C]').filter({ hasText: 'דרשה' }).first();
    assert.match(await clickTime(sermon, 1), /60 minutes/); await close();
    assert.equal(await page.evaluate(() => localStorage.getItem('zmanim-app-state-v1')), saved, 'Inspecting never saves an edit');
    await page.locator('#explain-times-toggle').click();
    await candles.fill('12:48');
    await page.locator('#explain-times-toggle').click();
    assert.match(await clickTime(page.locator('.cell[data-col=H]').first()), /Fixed time[\s\S]*Entered by hand/);
    assert.equal(await page.locator('.time-explain-dialog .calc-steps').innerText(), 'Set by the shul: Entered by hand in this saved chart\n12:48');
    await close();

    await page.goto(origin + '/admin/#charts'); await settled(); await switchOn();
    assert.match(await clickTime(page.locator('.cell[data-col=H]').first()), /שקיעה/); await close();
    await page.goto(origin + '/admin/#week'); await settled(); await switchOn();
    assert.match(await clickTime(page.locator('.week-time[data-time-explain]').filter({ hasText: /\d:\d\d/ }).first()), /Fixed time|Calculated time/); await close();
    await page.evaluate(async () => {
      const { loadState } = await import('/js/storage.js');
      const { resolveSettings } = await import('/js/settings.js');
      const { weekIndex } = await import('/js/sheets/rows.js');
      const { weekSheetHtml } = await import('/js/ui/week-sheet.js');
      const state = loadState(), index = weekIndex(state), serial = [...index.keys()][1];
      document.getElementById('main').innerHTML = weekSheetHtml(serial, index, state, resolveSettings(state.settings), 'Weekly schedule');
    });
    assert.match(await clickTime(page.locator('.onepage-row').filter({ hasText: 'הדלקת נרות' }).locator('.onepage-times[data-time-explain]').first()), /שקיעה/); await close();

    for (const key of ['pesach', 'shuva', 'roshhashana', 'yomkippur', 'slichos', 'tzomgedalia', 'sukkos', 'chanukah', 'vasikinboth', 'afteryk', 'sukkosshuava']) {
      await page.goto(origin + '/admin/#posters/' + key); await settled(); await switchOn();
      assert.equal(await page.locator('#poster-pick').inputValue(), key, 'The intended poster is open');
      const targets = page.locator('#poster-sheet [data-time-explain]').filter({ hasText: /\d{1,2}:\d{2}/ });
      assert(await targets.count(), key + ' has inspectable times');
      // Check every rendered time, including notes and combined cells.
      for (let i = 0; i < await targets.count(); i++) {
        const count = await targets.nth(i).evaluate(el => (el.textContent.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).length);
        for (let j = 0; j < count; j++) { await clickTime(targets.nth(i), j); await close(); }
      }
      console.log('Explained every time on', key);
    }

    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
      state.own = [{ id: 'explain-test', group: 'פסח', name: 'Explanation test', blocks: [{ heading: 'Test schedule', month: 1, day: 14,
        rows: [{ label: 'Fixed', mode: 'typed', text: '4:00' }, { label: 'Sunset offset', mode: 'zman', zman: 'shkia', offset: -20, round: 'down5' },
          { label: 'After candles', mode: 'zman', zman: 'candles', offset: 3, round: 'near' }] }] }];
      state.rules.push({ id: 'explain-test-rule', name: 'Explanation test rule', enabled: true, mode: 'append', condition: { always: true }, columnKeys: ['choref:C','kayitz:C'], value: '12:49' });
      localStorage.setItem('zmanim-app-state-v1', JSON.stringify(state));
    });
    await page.reload();
    await page.goto(origin + '/admin/#charts'); await settled(); await switchOn();
    const ruled = page.locator('.cell[data-col=C]').filter({ hasText: '12:49' }).first();
    const last = await ruled.evaluate(el => (el.textContent.match(/\d{1,2}:\d{2}/g) || []).length - 1);
    assert.match(await clickTime(ruled, last), /Fixed time[\s\S]*Explanation test rule/); await close();
    assert.match(await clickTime(ruled, last - 1), /Calculated time/); await close();
    await page.goto(origin + '/admin/#posters/pesach'); await settled();
    await page.goto(origin + '/admin/#posters/own:explain-test'); await settled(); await switchOn();
    const ownTimes = page.locator('#poster-sheet [data-time-explain]').filter({ hasText: /\d{1,2}:\d{2}/ });
    assert.match(await clickTime(ownTimes.nth(0)), /Fixed time/); await close();
    assert.match(await clickTime(ownTimes.nth(1)), /Take off\s+20 minutes[\s\S]*down to a 5 minute mark \(earlier\)[\s\S]*Before:[\s\S]*After:/); await close();
    assert.match(await clickTime(ownTimes.nth(2)), /18 minutes[\s\S]*Add\s+3 minutes/); await close();

    await page.goto(origin + '/admin/#posters/chanukah'); await settled();
    await page.locator('label[for=poster-sheets-all]').click(); await settled(); await switchOn();
    const combined = page.locator('#poster-sheet [data-time-explain]').filter({ hasText: /\d{1,2}:\d{2}/ });
    for (let i = 0; i < await combined.count(); i++) { await clickTime(combined.nth(i)); await close(); }
    console.log('Verified custom schedules, appended rules, weekly One sheet and combined Chanukah');

    await page.goto(origin + '/admin/#posters/pesach'); await settled(); await switchOn();
    const drasha = page.locator('.poster-row').filter({ hasText: 'דרשה' }).locator('[data-time-explain]').first();
    assert.match(await clickTime(drasha), /28 minutes[\s\S]*down to a 5 minute mark/); await close();
    const target = page.locator('#poster-sheet [data-time-explain]').filter({ hasText: /\d:\d\d/ }).first();
    await target.focus(); await page.keyboard.press('Enter');
    assert(await page.locator('.time-explain-dialog').isVisible(), 'Keyboard opens the explanation'); await close();
    await page.setViewportSize({ width: 375, height: 812 }); await settled();
    await clickTime(target);
    const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      viewport: innerWidth, dialog: document.querySelector('.time-explain-dialog').getBoundingClientRect().toJSON() }));
    assert(mobile.width <= mobile.viewport + 1, 'No mobile horizontal overflow');
    assert(mobile.dialog.left >= 0 && mobile.dialog.right <= 375, 'Mobile explanation fits');
    if (process.env.TIME_EXPLAIN_SCREENSHOT) await page.screenshot({ path: process.env.TIME_EXPLAIN_SCREENSHOT });
    const cdp = await context.newCDPSession(page);
    const pdf = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    assert(!(await page.locator('.time-explain-dialog').getAttribute('open')), 'Printing closes the explanation');
    assert(Buffer.from(pdf.data, 'base64').length > 10000, 'A real print PDF was generated');
    await close();

    await page.evaluate(async () => {
      const { zman, clockTime } = await import('/js/zmanim/trace.js');
      const { timeExplanationAttrs } = await import('/js/ui/time-explanations.js');
      const raw = (h, m, s = 0) => (h * 3600 + m * 60 + s) / 86400;
      const start = (h, m, s) => zman('שקיעה', raw(h, m, s));
      const fixtures = [
        ['up', start(19, 40, 39).ceil()], ['down', start(19, 40, 39).floor()],
        ['nearest-up', start(19, 40, 39).round()], ['nearest-down', start(19, 40, 20).round()],
        ['nearest-tie', start(19, 40, 30).round()], ['unchanged', clockTime(19, 40).ceil()],
        ['five-down', start(20, 3, 15.25).floorToStep(5)], ['five-up', start(20, 3, 15).ceilToStep(5)],
        ['quarter-nearest', start(20, 8, 15).roundToStep(15)],
        ['display-only', start(19, 40, 39)], ['display-tie', start(0, 1, 30)], ['boundary', start(19, 59, 59.99).floor()],
        ['seconds', start(19, 40, 39)],
      ];
      for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) {
        const time = start(h, m, 30);
        if (time.displayRounding.at !== time.plain()) throw Error('Display rounding disagrees at ' + h + ':' + m);
      }
      document.getElementById('main').innerHTML = '<h1>Rounding checks</h1>' + fixtures.map(([id, time]) => {
        const printed = id === 'seconds' ? '7:40:39' : time.plain();
        return `<p id="round-${id}"${timeExplanationAttrs({ header: 'Rounding', chartName: 'Test schedule', printed, times: [time], single: true })}>${printed}</p>`;
      }).join('');
    });
    const roundingCases = [
      ['up', /up to a whole minute \(later\)/, /Rounded up \(later\)[\s\S]*Before: 7:40:39\. After: 7:41\./],
      ['down', /down to a whole minute \(earlier\)/, /Rounded down \(earlier\)[\s\S]*Before: 7:40:39\. After: 7:40\./],
      ['nearest-up', /nearest whole minute/, /Rounded up \(later\)/],
      ['nearest-down', /nearest whole minute/, /Rounded down \(earlier\)/],
      ['nearest-tie', /nearest whole minute/, /Rounded up \(later\)/],
      ['unchanged', /up to a whole minute/, /Time stays the same/],
      ['five-down', /down to a 5 minute mark/, /Before: 8:03:15\.25\. After: 8:00\./],
      ['five-up', /up to a 5 minute mark/, /Before: 8:03:15\. After: 8:05\./],
      ['quarter-nearest', /nearest 15 minutes/, /Rounded up \(later\)[\s\S]*After: 8:15/],
      ['display-only', /nearest whole minute/, /Rounded up \(later\)[\s\S]*for display on the schedule/],
      ['display-tie', /nearest whole minute/, /Rounded down \(earlier\)[\s\S]*After: 12:01/],
      ['boundary', /down to a whole minute/, /Before: 7:59:59\.99\. After: 7:59\./],
    ];
    for (const [id, rule, result] of roundingCases) {
      const answer = await clickTime(page.locator('#round-' + id));
      assert.match(answer, rule, id + ' states the rounding rule');
      assert.match(answer, result, id + ' states the actual direction and values');
      await close();
    }
    const secondAnswer = await clickTime(page.locator('#round-seconds'));
    assert(!secondAnswer.includes('Round '), 'A seconds-precise printed time has no whole-minute display rounding');
    await close();
    await clickTime(page.locator('#round-five-down'));
    const roundingMobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
      dialog: document.querySelector('.time-explain-dialog').getBoundingClientRect().toJSON() }));
    assert(roundingMobile.width <= roundingMobile.viewport + 1, 'Rounding explanations do not overflow on mobile');
    assert(roundingMobile.dialog.left >= 0 && roundingMobile.dialog.right <= 375, 'Rounding dialog fits mobile');
    if (process.env.TIME_EXPLAIN_ROUNDING_SCREENSHOT) await page.screenshot({ path: process.env.TIME_EXPLAIN_ROUNDING_SCREENSHOT });
    await close();
    console.log('Verified rounding up, down, nearest in both directions, ties, unchanged times, 5 and 15 minutes, display rounding and seconds.');
    const publicPage = await context.newPage();
    await publicPage.goto(origin + '/chart/'); await publicPage.waitForTimeout(150);
    assert.equal(await publicPage.locator('#explain-times-toggle,[data-time-explain]').count(), 0, 'The option is admin-only');
    assert.deepEqual(errors, []);
    console.log('Verified exact clicks, fixed times, sunset offsets, sermons, manual edits, keyboard, mobile and unchanged chart geometry.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
