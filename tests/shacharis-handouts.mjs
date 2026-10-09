import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { hebrewDateExtended, excelWeekday, hasBehab } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { buildAsaraBTevesPoster } from '../js/posters/asarabteves.js';
import { buildAsaraShacharisPoster, buildBehabShacharisPoster } from '../js/posters/shacharis.js';

const settings = resolveSettings(JSON.parse(await readFile(new URL('../data/published.json', import.meta.url))).settings);
const expected = [
  ['6:40', 'בית מדרש'], ['7:00', 'בעזרת נשים'],
  ['7:15', 'בית מדרש למטה'], ['7:35', 'באולם השמחות'],
  ['8:00', 'בית מדרש'], ['8:20', 'בעזרת נשים'], ['8:40', 'בית מדרש למטה'],
];
const rows = poster => poster.rows.map(row => [row.text, row.room]);

test('Asara handouts retain the full poster morning times, rooms and conditional note', () => {
  for (let year = 5784; year <= 5834; year++) {
    const full = buildAsaraBTevesPoster(year, settings), morning = buildAsaraShacharisPoster(year, settings);
    assert.deepEqual(rows(morning), expected);
    assert.deepEqual(morning.span, full.span);
    assert.deepEqual(morning.rows.map(({ text, mark, underlined, timeNote }) => ({ text, mark, underlined, timeNote })),
      full.sets.find(set => set.calc === 'shacharis').lines.flat().map(({ text, mark, underlined, timeNote }) => ({ text, mark, underlined, timeNote })));
    assert.equal(morning.title, 'עשרה בטבת');
    assert.equal(morning.sets, undefined, 'The handout does not contain other tefillos');
  }
  const earlySunrise = buildAsaraShacharisPoster(5786, { ...settings, latitude: 0 });
  assert.equal(earlySunrise.rows.some(row => row.timeNote), false, 'The Selichos note is absent when sunrise is before 7:05');
  assert.equal(buildAsaraShacharisPoster(null, settings), null);
});

test('both BHB rounds use the chart calendar and special Shacharis schedule every year', () => {
  for (let year = 5784; year <= 5834; year++) for (const month of [8, 2]) {
    const poster = buildBehabShacharisPoster(year, month, settings);
    assert.deepEqual(rows(poster), expected);
    assert.equal(poster.title, month === 8 ? 'בה"ב אחר סוכות' : 'בה"ב אחר פסח');
    assert.equal(poster.subtitle, 'שחרית');
    assert.equal(poster.days.length, 3);
    assert.deepEqual(poster.days.map(excelWeekday), [2, 5, 2]);
    assert.deepEqual(poster.days.slice(1).map((serial, i) => serial - poster.days[i]), [3, 4]);
    assert(poster.days.every(serial => {
      const date = hebrewDateExtended(serial);
      return date.year === year && date.month === month && hasBehab(serial, settings);
    }));
    assert.deepEqual(poster.span, { from: poster.days[0], to: poster.days[2] });
    assert.equal(poster.rows.some(row => row.timeNote), false, 'Asara-specific Selichos notes do not spread to BHB');
  }
  assert.deepEqual(buildBehabShacharisPoster(5787, 8, settings).days.map(serial => dateFromSerial(serial).toISOString().slice(0, 10)),
    ['2026-10-19', '2026-10-22', '2026-10-26']);
  assert.equal(buildBehabShacharisPoster(5787, 9, settings), null);
});
