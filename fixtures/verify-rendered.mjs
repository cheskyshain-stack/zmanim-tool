// Proves golden.json is what the app really puts on a chart, not just what the generator
// computed on its own. It generates a season through the actual Generate form and compares
// every rendered cell against the fixture.
//
// Worth having for two reasons. It caught a real bug in the generator: rows were being
// built with the sheet's nominal season, while the app builds each page with its
// *effective* season, so from the spring cutover onwards a חורף sheet renders קיץ's twelve
// columns and the fixture disagreed with the chart on screen. And it is the worked example
// of how to compare a port's rendered output against the fixture, whitespace rule included.
//
//   python3 -m http.server 9611
//   PORT=9611 SEASON=choref YEAR=5787 node fixtures/verify-rendered.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = `http://127.0.0.1:${process.env.PORT || '9611'}`;
const golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'golden.json'), 'utf8'));

const SEASON = process.env.SEASON || 'choref';
const YEAR = Number(process.env.YEAR || 5787);
const season = golden.seasons.find((s) => s.season === SEASON && s.hebrewYear === YEAR);
const ruled = new Set(golden.seededFirings.filter((f) => f.season === SEASON && f.year === YEAR).map((f) => f.date));
const SKIP = new Set(['date', 'serial', 'page', 'builtAs', 'parsha', 'specialParsha']);

// The renderer drops the whitespace straight after an underline sentinel (nl2br), so the
// same strip is applied here before raw engine output is compared with rendered text.
const plain = (s) =>
  String(s)
    .replace(/\{U\}(\{NB\})+/g, '{U}')
    .split('{U}').join('')
    .split('{/U}').join('')
    .split('{NB}').join('\u00a0')
    .split('{LF}').join('\n');

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
await page.click('button[data-tab="generate"]');
await page.waitForSelector('form');
await page.click(`label[for="season-${SEASON}"]`);
await page.fill('#step-hebrewYear', String(YEAR));
await page.click('.btn-primary:visible');
await page.waitForTimeout(800);
await page.click('.btn-primary:visible');
await page.waitForSelector('.page', { timeout: 20000 });
await page.waitForTimeout(600);

const { rows: rendered, weekdayRows: renderedWd } = await page.evaluate(() => {
  const text = (el) => {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.tagName === 'BR') out += '\n';
      else out += text(n);
    }
    return out;
  };
  const rows = {}, weekdayRows = {};
  for (const p of document.querySelectorAll('#pages > .page')) {
    const into = p.querySelector('.weekday-table') ? weekdayRows : rows;
    for (const cell of p.querySelectorAll('.cell')) {
      (into[cell.dataset.serial] ||= {})[cell.dataset.col] = text(cell);
    }
  }
  return { rows, weekdayRows };
});

let checked = 0, bad = 0, skipped = 0;
for (const row of season.rows) {
  if (ruled.has(row.date)) { skipped++; continue; }
  const got = rendered[String(row.serial)];
  if (!got) { console.log('MISSING on page:', row.date); bad++; continue; }
  const cols = Object.keys(row).filter((k) => !SKIP.has(k));
  if (cols.length !== Object.keys(got).length) {
    console.log(`COLUMN COUNT ${row.date}: fixture ${cols.length} (${row.builtAs}), rendered ${Object.keys(got).length}`);
    bad++;
  }
  for (const key of cols) {
    const want = plain(row[key]);
    checked++;
    if (got[key] !== want) {
      bad++;
      console.log(`MISMATCH ${row.date} col ${key}\n  fixture : ${JSON.stringify(want)}\n  rendered: ${JSON.stringify(got[key])}`);
    }
  }
}
// The weekday chart generated alongside it, same comparison.
let wdChecked = 0, wdBad = 0;
for (const row of season.weekdayRows) {
  const got = renderedWd[String(row.serial)];
  if (!got) { console.log('WEEKDAY MISSING on page:', row.date); wdBad++; continue; }
  for (const key of ['B', 'C']) {
    const want = plain(row[key]);
    wdChecked++;
    if (got[key] !== want) {
      wdBad++;
      console.log(`WEEKDAY MISMATCH ${row.date} col ${key}\n  fixture : ${JSON.stringify(want)}\n  rendered: ${JSON.stringify(got[key])}`);
    }
  }
}
console.log(`${SEASON} ${YEAR}: weekday cells compared ${wdChecked}, mismatches ${wdBad}`);
console.log(`${SEASON} ${YEAR}: cells compared ${checked}, mismatches ${bad}, rows skipped because a seeded rule fires ${skipped}`);
await browser.close();
