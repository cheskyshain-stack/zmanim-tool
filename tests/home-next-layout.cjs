// Exercise the real homepage renderer and fitter with the automatic schedule's text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'dist');
const output = process.env.ARTIFACT_DIR || '/tmp/home-next-layout';
const widths = (process.env.HOME_NEXT_WIDTHS || '320,393,600,759,760,980,1440').split(',').map(Number);
fs.mkdirSync(output, { recursive: true });

const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  let body = fs.readFileSync(file);
  // Test-server exports only. Product modules keep their private renderer and timer.
  if (file === path.join(root, 'js/luach.js')) body = Buffer.concat([body, Buffer.from(
    '\nexport {nextUpHtml as testNextHtml,markNextInline as testNextFit,stopNextUp as testNextStop};\n')]);
  res.end(body);
});

async function fixtures() {
  const module = file => import(pathToFileURL(path.join(repo, 'js', file)));
  const [{ buildAutomaticCharts }, { resolveSettings }, upcoming, { dateFromSerial }] = await Promise.all([
    module('publish.js'), module('settings.js'), module('upcoming.js'), module('zmanim/solar.js'),
  ]);
  const read = name => JSON.parse(fs.readFileSync(path.join(repo, 'data', name + '.json'), 'utf8'));
  const tables = { parshaChutz: read('parsha_chutz'), parshaEY: read('parsha_ey'), parshaNames: read('parsha_names'), specialDays: read('special_days') };
  const state = buildAutomaticCharts(read('published'), tables, new Date('2026-10-22T16:00:00Z'));
  const settings = resolveSettings(state.settings);
  const anchors = state.sheets.flatMap(sheet => sheet.weeks.map(week => week.serial));
  const from = Math.min(...anchors) - 6, to = Math.max(...anchors);
  const events = new Map(), candles = new Map(), pairs = new Map(), labels = new Map();
  const signature = item => JSON.stringify([item.name, item.place || '', upcoming.clock(item.mins), upcoming.meridiem(item.mins)]);
  let totalEvents = 0, scheduledDays = 0;
  const days = new Map();
  for (let serial = from; serial <= to + 1; serial++) days.set(serial, upcoming.minyanimForDay(serial, state, settings));
  for (let serial = from; serial <= to; serial++) {
    const list = days.get(serial), candle = upcoming.candleLightingForDay(serial, state, settings);
    if (list.length) scheduledDays++;
    totalEvents += list.length;
    for (const event of list) {
      const item = { ...event, serial, daysOff: 0, in: 1439 };
      if (!events.has(signature(item))) events.set(signature(item), item);
      labels.set(JSON.stringify([item.name, item.place || '']), { name: item.name, place: item.place || '' });
    }
    if (!candle) continue;
    const item = { ...candle, serial, daysOff: 0, in: 1439 };
    if (!candles.has(signature(item))) candles.set(signature(item), item);
    const firstTomorrow = days.get(serial + 1)[0];
    for (const event of [...list, ...(firstTomorrow ? [{ ...firstTomorrow, daysOff: 1 }] : [])]) {
      const minyan = { ...event, serial: serial + (event.daysOff || 0), daysOff: event.daysOff || 0, in: 1439 };
      const key = JSON.stringify([signature(minyan), signature(item), minyan.daysOff]);
      if (!pairs.has(key)) pairs.set(key, [minyan, item]);
    }
  }
  const cases = [];
  const add = (kind, minyan, candle) => cases.push({ id: cases.length, kind, items: [minyan, candle] });
  for (const item of events.values()) add('scheduled-minyan', item, null);
  for (const item of candles.values()) {
    add('candles-only', null, item);
    add('candles-passed', null, { ...item, in: -6 });
  }
  for (const [minyan, candle] of pairs.values()) {
    add('scheduled-pair', minyan, candle);
    add('pair-after-candles', minyan, { ...candle, in: -6 });
  }
  const countdowns = new Map();
  for (let minutes = -6; minutes <= 1440; minutes++) {
    const item = { serial: from, daysOff: 0, in: minutes };
    countdowns.set(upcoming.howFar(item), item);
  }
  countdowns.set('tomorrow', { serial: from + 1, daysOff: 1, in: 1500 });
  for (let offset = 2; offset < 9; offset++) {
    const item = { serial: from + offset, daysOff: offset, in: offset * 1440 };
    countdowns.set(upcoming.howFar(item), item);
  }
  // Long descriptions and a wide clock stress all countdown grammar and wrapping.
  const wide = [...events.values()].sort((a, b) => (b.name.length + (b.place || '').length) - (a.name.length + (a.place || '').length))[0];
  const candle = [...candles.values()].sort((a, b) => b.name.length - a.name.length)[0];
  for (const countdown of countdowns.values()) {
    add('countdown-single', { ...wide, mins: 12 * 60 + 59, ...countdown }, null);
    add('countdown-minyan-pair', { ...wide, mins: 12 * 60 + 59, ...countdown }, candle);
    add('countdown-candle-pair', wide, { ...candle, ...countdown });
  }
  for (const label of labels.values()) for (const mins of [0, 720, 779, 1439, 1440]) {
    const item = { ...wide, ...label, mins, in: 0 };
    add('clock-boundary', item, null);
    add('clock-boundary-pair', item, { ...candle, in: 0 });
  }
  add('empty', null, null);
  return { cases, coverage: {
    dateRange: [dateFromSerial(from).toISOString().slice(0, 10), dateFromSerial(to).toISOString().slice(0, 10)],
    scheduledDays, totalEvents, uniqueMinyanTexts: events.size, candleTexts: candles.size, pairs: pairs.size,
    labels: [...labels.values()], countdownTexts: countdowns.size, casesPerWidth: cases.length,
  } };
}

(async () => {
  const { cases, coverage } = await fixtures();
  fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(coverage, null, 2));
  console.log(JSON.stringify({ stage: 'fixtures', ...coverage }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('zmanim-nocount', '1'));
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-22T05:00:00Z'));
    await page.goto(origin + '/?count=off');
    await page.locator('#main.is-home .luach-next').waitFor();
    if (await page.locator('.luach-announce-close').isVisible()) await page.locator('.luach-announce-close').click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      const { testNextHtml, testNextFit, testNextStop } = await import('/js/luach.js');
      const { clock, meridiem, howFar } = await import('/js/upcoming.js');
      testNextStop();
      const host = document.createElement('div');
      host.id = 'home-next-layout-test';
      document.querySelector('.luach-next').replaceWith(host);
      window.testNext = { host, html: testNextHtml, fit: testNextFit, clock, meridiem, howFar };
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 760 ? 900 : 1000 });
      const failures = new Map(), tallest = {};
      let checked = 0, failureCount = 0;
      for (let start = 0; start < cases.length; start += 250) {
        const batch = await page.evaluate(fixtures => {
          const { host, html, fit, clock, meridiem, howFar } = window.testNext;
          const failures = [], tallest = {};
          const box = el => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          for (const fixture of fixtures) {
            host.innerHTML = html(fixture.items);
            fit(host);
            const card = host.querySelector('.luach-next');
            const problems = [];
            if (!fixture.items.some(Boolean)) {
              if (card) problems.push('empty card was rendered');
            } else if (!card) problems.push('card missing');
            else {
              const cardBox = box(card), paired = fixture.items.every(Boolean);
              const cardType = paired ? 'paired' : 'single';
              if (!tallest[cardType] || cardBox.height > tallest[cardType].height) tallest[cardType] = { id: fixture.id, height: cardBox.height };
              if (card.scrollWidth > card.clientWidth + 1) problems.push('horizontal card overflow');
              if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('horizontal page overflow');
              const columns = [...card.querySelectorAll('.luach-next-box')];
              const items = fixture.items.filter(Boolean);
              const alignment = [];
              for (let index = 0; index < columns.length; index++) {
                const column = columns[index], item = items[index], columnBox = box(column);
                const time = column.querySelector('.luach-next-time'), what = column.querySelector('.luach-next-what');
                const where = column.querySelector('.luach-next-where'), when = column.querySelector('.luach-next-countdown');
                const actualClock = time.childNodes[0].textContent;
                if (actualClock !== clock(item.mins) || time.querySelector('small').textContent !== meridiem(item.mins)) problems.push('clock text changed');
                if (what.textContent !== item.name || (where?.textContent || '') !== (item.place || '')) problems.push('name or room text changed');
                if ((when?.textContent || '').replace(/\u00a0/g, ' ') !== howFar(item)) problems.push('countdown text changed');
                const pieces = [...column.querySelectorAll('.luach-next-head,.luach-next-time,.luach-next-what,.luach-next-where,.luach-next-countdown')].map(el => {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  return { type: el.className, rects: [...range.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height })) };
                });
                for (const piece of pieces) for (const r of piece.rects) {
                  if (r.width < .1 || r.height < .1) continue;
                  if (r.left < cardBox.left - 1 || r.right > cardBox.right + 1 || r.top < cardBox.top - 1 || r.bottom > cardBox.bottom + 1) problems.push('text outside card: ' + piece.type);
                  if (paired && (r.left < columnBox.left - 1 || r.right > columnBox.right + 1)) problems.push('text outside its column: ' + piece.type);
                }
                for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
                  if (pieces[a].rects.some(x => pieces[b].rects.some(y => overlaps(x, y)))) problems.push('text overlap: ' + pieces[a].type + '/' + pieces[b].type);
                }
                const mark = column.querySelector('.luach-next-mark');
                if (mark && getComputedStyle(mark).display !== 'none') {
                  const markBox = box(mark);
                  if (pieces.some(piece => piece.rects.some(r => overlaps(markBox, r)))) problems.push('icon overlaps text');
                }
                const border = parseFloat(getComputedStyle(time).borderRightWidth);
                if (border > 0 && ![what, where].filter(Boolean).every(el => overlaps(box(time), { ...box(el), left: box(time).left, right: box(time).right }))) problems.push('divider beside wrapped text');
                alignment.push({ heading: box(column.querySelector('.luach-next-head')).top, time: box(time).top, countdown: when ? box(column.querySelector('.luach-next-when')).top : null });
              }
              if (alignment.length === 2) for (const key of ['heading', 'time', 'countdown']) {
                if (alignment.every(item => item[key] !== null) && Math.abs(alignment[0][key] - alignment[1][key]) > 1) problems.push('paired ' + key + ' rows misaligned');
              }
            }
            if (problems.length) failures.push({ id: fixture.id, kind: fixture.kind, items: fixture.items, problems: [...new Set(problems)] });
          }
          return { failures, tallest };
        }, cases.slice(start, start + 250));
        checked += Math.min(250, cases.length - start);
        failureCount += batch.failures.length;
        for (const failure of batch.failures) {
          const key = JSON.stringify([failure.kind, failure.items.map(item => item && [item.name, item.place]), failure.problems]);
          if (!failures.has(key)) failures.set(key, failure);
        }
        for (const [type, measurement] of Object.entries(batch.tallest)) if (!tallest[type] || measurement.height > tallest[type].height) tallest[type] = measurement;
      }
      const examples = [...failures.values()];
      for (const [index, failure] of examples.slice(0, 5).entries()) {
        await page.evaluate(fixture => { const { host, html, fit } = window.testNext; host.innerHTML = html(fixture.items); fit(host); }, cases[failure.id]);
        await page.locator('.luach-home-layout').screenshot({ path: path.join(output, 'failure-' + width + '-' + index + '.png') });
      }
      for (const [type, measurement] of Object.entries(tallest)) {
        await page.evaluate(fixture => { const { host, html, fit } = window.testNext; host.innerHTML = html(fixture.items); fit(host); }, cases[measurement.id]);
        await page.locator('.luach-home-layout').screenshot({ path: path.join(output, 'longest-' + type + '-' + width + '.png') });
      }
      const result = { width, checked, failureCount, failureKinds: examples.length, failures: examples, tallest };
      results.push(result);
      fs.writeFileSync(path.join(output, 'width-' + width + '.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ width, checked, failureCount, failureKinds: examples.length, tallest }));
    }
    const report = { coverage, results, errors };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    assert.deepEqual(errors, [], 'No browser errors');
    assert(results.every(result => result.failureCount === 0), 'Text layout failures are saved in ' + output);
    console.log(JSON.stringify({ passed: true, renderedCases: results.reduce((sum, result) => sum + result.checked, 0), widths }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
