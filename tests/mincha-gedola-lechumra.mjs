import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import * as Z from '../js/zmanim/zmanim.js';
import { dateFromSerial, excelSerial } from '../js/zmanim/solar.js';
import { excelWeekday, isAssurMelacha, roshHashana } from '../js/hebrew-calendar.js';
import { ceilToMinute } from '../js/format.js';
import { fridayMainMinchaParts, weekLatestMinchaGedola } from '../js/sheets/common.js';
import { buildWeekdayRow } from '../js/sheets/weekday.js';
import { openingMincha, openingMinchaTrace } from '../js/posters/early-mincha.js';
import { chanukahSundayOpening } from '../js/posters/chanukah.js';
import { buildSukkosPoster, buildSukkosAfter, sukkosAfterDays } from '../js/posters/sukkos.js';
import { buildAfterYomKippur, afterYomKippurDays } from '../js/posters/yomkippur.js';
import { buildAsaraBTevesPoster } from '../js/posters/asarabteves.js';
import { ownRowTimes, ownRuleText } from '../js/posters/own.js';

const settings = resolveSettings(JSON.parse(await readFile(new URL('../data/published.json', import.meta.url))).settings);
const clock = (hour, minute, second = 0) => (hour * 60 + minute + second / 60) / 1440;
const day = iso => new Date(iso + 'T00:00:00Z');
const printed = text => {
  const [hour, minute] = text.split(':').map(Number);
  return ((hour % 12 + 12) * 60 + minute) / 1440;
};
const clears = (time, limit, label) => assert(time + 1e-9 >= limit, label);

test('holiday openings preserve seconds at the 1:15 and 1:20 boundaries', () => {
  for (const [limit, expected] of [
    [clock(13, 14, 59), clock(13, 15)], [clock(13, 15), clock(13, 15)],
    [clock(13, 15, 1), clock(13, 20)], [clock(13, 19, 59), clock(13, 20)],
    [clock(13, 20), clock(13, 20)], [clock(13, 20, 1), null],
  ]) {
    const actual = openingMincha(limit, clock(13, 35));
    assert.equal(actual, expected);
    const trace = openingMinchaTrace(limit, clock(13, 35));
    assert.equal(trace.held === false, expected === null);
    if (expected !== null) {
      clears(actual, limit, 'An opening never rounds below the exact limit');
      assert.equal(trace.value, actual, 'The explanation matches the announced time');
      const against = trace.steps.find(step => step.kind === 'pick').against;
      assert.equal(against.name, 'מנחה גדולה לחומרא');
      assert(against.steps.some(step => step.kind === 'round' && step.way === 'up'));
    }
  }
  assert.equal(openingMincha(clock(13, 15, 1), clock(13, 34)), null, 'Retain the quarter-hour gap');
});

test('Friday 12:30 uses Lechumra instead of MGA 16.1 and never rounds earlier', () => {
  const february = day('2026-02-27');
  const sample = fridayMainMinchaParts(february, settings, excelSerial(february) + 1).times[0];
  assert.equal(sample.plain(), '12:40');
  clears(sample.value, Z.minchaGedolaLechumra(february, settings), 'Clear the Lechumra limit');
  assert(sample.value < Z.minchaGedolaMGA16_1(february, settings), 'This slot now uses the requested reckoning');
  const january = day('2027-01-01');
  assert.equal(fridayMainMinchaParts(january, settings, excelSerial(january) + 1).times[0].plain(), '12:35',
    'The seconds past 12:30 move the opening to 12:35');
  const pick = sample.steps.find(step => step.kind === 'pick').against;
  assert.equal(pick.name, 'מנחה גדולה לחומרא');
  assert(!pick.steps.some(step => step.kind === 'round' && step.way === 'down'), 'Keep seconds until upward rounding');
  let checked = 0;
  for (let offset = 0; offset < 1461; offset++) {
    const date = new Date(Date.UTC(2026, 0, 1 + offset));
    if (date.getUTCDay() !== 5 || Z.dstLocal(date, settings)) continue;
    const first = fridayMainMinchaParts(date, settings, excelSerial(date) + 1).times[0];
    clears(first.value, Z.minchaGedolaLechumra(date, settings), date.toISOString());
    assert.equal(Math.round(first.value * 1440) % 5, 0, 'Preserve five-minute times');
    checked++;
  }
  assert(checked > 60);
  assert.equal(chanukahSundayOpening(clock(12, 30)).plain(), '12:35', 'Sunday remains strictly after, not equal to, the exact limit');
});

test('weekday and Friday early slots clear the same complete weekly limit', () => {
  let weekdayChecks = 0;
  for (let offset = 0; offset < 1461; offset += 7) {
    const serial = excelSerial(new Date(Date.UTC(2026, 0, 3 + offset)));
    const sunday = serial - 6;
    const regular = Array.from({ length: 6 }, (_, i) => sunday + i).filter(s => !isAssurMelacha(s, settings));
    const limit = weekLatestMinchaGedola(serial, settings);
    for (const covered of regular) clears(limit, Z.minchaGedolaLechumra(dateFromSerial(covered), settings), 'The weekly limit never rounds earlier');
    const friday = fridayMainMinchaParts(dateFromSerial(serial - 1), settings, serial);
    for (const time of friday.times.filter(t => t.value >= clock(13, 15) && t.value <= clock(13, 40))) clears(time.value, limit, 'Friday early slot clears the weekly limit');
    const row = buildWeekdayRow({ serial, date: dateFromSerial(serial), parsha: '' }, settings);
    // Special holiday rows have their own day windows, checked separately below.
    if (row.traces?.C?.some(time => time.steps.some(step => /week's own regular days/.test(step.label || '')))) {
      for (const time of row.traces.C.filter(t => t.held !== false && t.value >= clock(13, 15) && t.value <= clock(13, 40))) clears(time.value, limit, 'Weekday early slot clears the weekly limit');
      weekdayChecks++;
    }
  }
  assert(weekdayChecks > 100, 'Exercise regular weekday schedules in both seasons');
});

test('Sukkos and the schedules after Yom Kippur and Sukkos clear every day they cover', () => {
  for (let year = 5784; year <= 5804; year++) {
    const poster = buildSukkosPoster(year, settings);
    for (const event of poster.minyanim.filter(event => event.name === 'מנחה' && event.mins <= 800)) {
      clears(event.mins / 1440, Z.minchaGedolaLechumra(dateFromSerial(event.serial), settings), `Sukkos ${year}: ${event.serial}`);
    }
    const rh = roshHashana(year - 3761);
    const afterYK = buildAfterYomKippur(year, settings);
    const ykDays = [...new Set([...afterYomKippurDays(rh, settings).map(d => d.serial), rh + 10])];
    for (const serial of ykDays) clears(printed(afterYK.mincha[0].text), Z.minchaGedolaLechumra(dateFromSerial(serial), settings), `After Yom Kippur ${year}`);
    const afterSukkos = buildSukkosAfter(rh, settings);
    for (const serial of sukkosAfterDays(rh, settings)) clears(printed(afterSukkos.mincha[0].text), Z.minchaGedolaLechumra(dateFromSerial(serial), settings), `After Sukkos ${year}`);
    const asara = buildAsaraBTevesPoster(year, settings);
    if (excelWeekday(asara.span.from) === 6) {
      const first = asara.sets.find(set => set.calc === 'mincha').lines.flat()[0];
      clears(printed(first.text), Z.minchaGedolaLechumra(dateFromSerial(asara.span.from), settings), `Friday Asara ${year}`);
    }
  }
});

test('saved custom Mincha Gedola rows round upward and describe the same rule', () => {
  const date = day('2026-10-12'), serial = excelSerial(date), raw = Z.minchaGedolaLechumra(date, settings);
  for (const round of ['near', 'down', 'up', 'down5', 'up5']) {
    const row = { mode: 'zman', zman: 'minchaGedola', offset: 0, round, underlined: true };
    const time = ownRowTimes(row, serial, settings)[0];
    clears(time.trace.value, raw, 'Legacy custom rounding cannot move Mincha Gedola earlier');
    assert.match(ownRuleText(row), /מנחה גדולה לחומרא.*up to/);
    assert.equal(time.trace.steps[0].name, 'מנחה גדולה לחומרא');
    assert.equal(time.underlined, true);
  }
  const withOffset = ownRowTimes({ mode: 'zman', zman: 'minchaGedola', offset: 7, round: 'near' }, serial, settings)[0];
  assert.equal(withOffset.trace.value, ceilToMinute(raw + 7 / 1440), 'Keep the requested offset');
  const sunsetRow = { mode: 'zman', zman: 'shkia', offset: -15, round: 'down' };
  assert.match(ownRuleText(sunsetRow), /down to the minute/, 'Other zmanim retain their selected rounding');
});
