import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultSeasonPageCount, defaultPageSizes, alignPageSizesTo, splitWeeksIntoPages } from '../js/pagination.js';
import { buildAutomaticCharts, firstWeekdayPageRangeForSummer } from '../js/publish.js';
import { resolveSettings } from '../js/settings.js';
import { computeSeasonWeeks, computeWeekdayWeeks } from '../js/sheets/weeks.js';

const read = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(['published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days'].map(read));
const tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const settings = resolveSettings(config.settings);

test('only winters with an extra Adar use three parts, including summers of leap years', () => {
  for (const year of [5784, 5787, 5790, 5793]) {
    assert.equal(defaultSeasonPageCount('choref', year), 3);
    assert.equal(defaultSeasonPageCount('kayitz', year), 2);
  }
  for (const year of [5785, 5786, 5788, 5789, 5791, 5792]) {
    for (const season of ['choref', 'kayitz']) assert.equal(defaultSeasonPageCount(season, year), 2);
  }
});

test('automatic charts replace the published three-part summer and align every weekday part', () => {
  const before = JSON.stringify(config);
  const state = buildAutomaticCharts(config, tables, new Date('2026-10-29T12:00:00Z'));
  assert.deepEqual(state.sheets.find(s => s.id === 'auto-kayitz-5786').pageSizes, [11, 11]);
  assert.deepEqual(state.sheets.find(s => s.id === 'auto-choref-5787').pageSizes, [10, 10, 8]);
  for (const sheet of state.sheets.filter(s => s.season !== 'weekday')) {
    const companion = state.sheets.find(s => s.linkedSheetId === sheet.id);
    assert.equal(sheet.pageSizes.length, defaultSeasonPageCount(sheet.season, sheet.hebrewYear));
    assert.deepEqual(companion.pageSizes, alignPageSizesTo(sheet.weeks, sheet.pageSizes, companion.weeks));
    assert.equal(sheet.pageSizes.reduce((sum, n) => sum + n, 0), sheet.weeks.length);
    assert.equal(companion.pageSizes.reduce((sum, n) => sum + n, 0), companion.weeks.length);
    assert.deepEqual(splitWeeksIntoPages(sheet.weeks, sheet.pageSizes).flat(), sheet.weeks);
    assert.deepEqual(splitWeeksIntoPages(companion.weeks, companion.pageSizes).flat(), companion.weeks);
  }
  assert.equal(JSON.stringify(config), before, 'Saved published snapshots are not mutated');
});

test('explicit custom print layouts remain usable', () => {
  const key = 'kayitz-5786', total = computeSeasonWeeks('kayitz', 5786, settings, tables).weeks.length;
  const state = buildAutomaticCharts({ ...config, chartLayouts: { [key]: [total] } }, tables, new Date('2026-10-29T12:00:00Z'));
  assert.deepEqual(state.sheets.find(s => s.id === 'auto-' + key).pageSizes, [total]);
});

test('summer page-one badge range uses the same two-part split', () => {
  const range = firstWeekdayPageRangeForSummer(settings, tables);
  const { weeks } = computeSeasonWeeks('kayitz', range.hebrewYear, settings, tables);
  const weekday = computeWeekdayWeeks('kayitz', range.hebrewYear, settings, tables).weeks;
  const sizes = alignPageSizesTo(weeks, defaultPageSizes(weeks.length, 2, 'kayitz'), weekday);
  assert.equal(range.firstSerial, weekday[0].serial);
  assert.equal(range.lastSerial, weekday[sizes[0] - 1].serial);
});
