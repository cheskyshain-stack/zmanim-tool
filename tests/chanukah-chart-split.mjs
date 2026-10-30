import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultPageSizes, defaultSeasonPageCount, defaultSeasonPageSizes, alignPageSizesTo, splitWeeksIntoPages } from '../js/pagination.js';
import { computeSeasonWeeks, computeWeekdayWeeks } from '../js/sheets/weeks.js';
import { chanukahDaysInWeek } from '../js/sheets/weekday.js';
import { chanukahYearFor } from '../js/hebrew-calendar.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { resolveSettings } from '../js/settings.js';

const read = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(['published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days'].map(read));
const tables = { parshaChutz, parshaEY, parshaNames, specialDays }, settings = resolveSettings(config.settings);
const touchedShabbos = week => chanukahYearFor(week.serial, settings) || chanukahYearFor(week.serial - 1, settings);
const touchedWeekday = week => chanukahDaysInWeek(week.serial, settings).length > 0;
const pagesContaining = (weeks, sizes, predicate) => splitWeeksIntoPages(weeks, sizes).map((page, index) => page.some(predicate) ? index : -1).filter(index => index >= 0);

test('5790 matches the approved 9/10/9 PDF, with all Chanukah on the middle part', () => {
  const state = buildAutomaticCharts(config, tables, new Date('2026-10-30T12:00:00Z'));
  const sheet = state.sheets.find(s => s.id === 'auto-choref-5790'), weekday = state.sheets.find(s => s.linkedSheetId === sheet.id);
  assert.deepEqual(sheet.pageSizes, [9, 10, 9]);
  const pages = splitWeeksIntoPages(sheet.weeks, sheet.pageSizes);
  assert.equal(pages[0].at(-1).date.toISOString().slice(0, 10), '2029-12-01');
  assert.equal(pages[1][0].date.toISOString().slice(0, 10), '2029-12-08');
  assert.equal(pages[1].at(-1).date.toISOString().slice(0, 10), '2030-02-09');
  assert.equal(pages[2][0].date.toISOString().slice(0, 10), '2030-02-16');
  assert.deepEqual(pagesContaining(sheet.weeks, sheet.pageSizes, touchedShabbos), [1]);
  assert.deepEqual(pagesContaining(weekday.weeks, weekday.pageSizes, touchedWeekday), [1]);
  const sundayTail = weekday.weeks.find(week => week.date.toISOString().slice(0, 10) === '2029-12-15');
  assert.equal(chanukahDaysInWeek(sundayTail.serial, settings).length, 1, 'The partial final week contains a real Chanukah Sunday');
});

test('61 years keep Chanukah on one matching Shabbos/weekday part for every offered page count', () => {
  let adjusted = 0;
  for (let year = 5760; year <= 5820; year++) {
    const weeks = computeSeasonWeeks('choref', year, settings, tables).weeks;
    const weekday = computeWeekdayWeeks('choref', year, settings, tables).weeks;
    const before = JSON.stringify(weeks);
    for (let count = 1; count <= 8; count++) {
      const sizes = defaultSeasonPageSizes(weeks, 'choref', year, count);
      assert.equal(sizes.length, count); assert(sizes.every(size => size > 0));
      assert.equal(sizes.reduce((a, b) => a + b, 0), weeks.length);
      assert.deepEqual(splitWeeksIntoPages(weeks, sizes).flat(), weeks);
      const weekdaySizes = alignPageSizesTo(weeks, sizes, weekday);
      assert.deepEqual(splitWeeksIntoPages(weekday, weekdaySizes).flat(), weekday);
      const shabbosParts = pagesContaining(weeks, sizes, touchedShabbos);
      const weekdayParts = pagesContaining(weekday, weekdaySizes, touchedWeekday);
      assert.equal(shabbosParts.length, 1, year + '/' + count + ' Shabbos');
      assert.equal(weekdayParts.length, 1, year + '/' + count + ' weekday');
      assert.deepEqual(shabbosParts, weekdayParts, 'Both charts keep Chanukah on the same part');
      if (JSON.stringify(sizes) !== JSON.stringify(defaultPageSizes(weeks.length, count, 'choref'))) adjusted++;
    }
    assert.equal(JSON.stringify(weeks), before);
    assert.equal(defaultSeasonPageSizes(weeks, 'choref', year).length, defaultSeasonPageCount('choref', year));
  }
  assert(adjusted > 0);
});

test('winter thirds prefer the extra week in the middle, with Chanukah taking priority', () => {
  assert.deepEqual(defaultPageSizes(27, 3, 'choref'), [9, 9, 9]);
  assert.deepEqual(defaultPageSizes(28, 3, 'choref'), [9, 10, 9]);
  assert.deepEqual(defaultPageSizes(29, 3, 'choref'), [10, 10, 9]);
  assert.deepEqual(defaultPageSizes(30, 3, 'choref'), [10, 10, 10]);
  const winter = computeSeasonWeeks('choref', 5787, settings, tables).weeks;
  assert.deepEqual(defaultSeasonPageSizes(winter, 'choref', 5787), [8, 10, 10]);
  for (const year of [5786, 5787, 5790]) {
    const weeks = computeSeasonWeeks('kayitz', year, settings, tables).weeks;
    for (const count of [1, 2, 3, 4, 8]) assert.deepEqual(defaultSeasonPageSizes(weeks, 'kayitz', year, count), defaultPageSizes(weeks.length, count, 'kayitz'));
  }
});
