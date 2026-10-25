import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL } from '../js/settings.js';
import { buildChanukahPoster, chanukahScheduleLines, chanukahShacharisDay } from '../js/posters/chanukah.js';
import { buildRoshChodeshShacharisPoster } from '../js/posters/shacharis.js';
import { roshChodeshSchedule } from '../js/posters/rosh-chodesh-schedule.js';
import { roshChodeshText } from '../js/rosh-chodesh-text.js';
import { erevTimes } from '../js/erev-text.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { sunriseElev } from '../js/zmanim/zmanim.js';
import { dateFromHebrew, excelWeekday, hasRoshChodesh } from '../js/hebrew-calendar.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { minyanimForDay } from '../js/upcoming.js';
import { weekdayMornings } from '../js/posters/day.js';
import { roshChodeshBaseSchedule } from '../js/posters/special-shacharis.js';
import { buildScheduleFeed } from '../scripts/schedule-feed.mjs';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url)));
const [config, parshaChutz, parshaEy, parshaNames, specialDays] = await Promise.all([
  'published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEy, parshaNames, specialDays };
const asClock = minutes => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

test('both pushed Chanukah morning rows share the full-precision weekday average across 51 years', () => {
  let shared = 0, separate = 0;
  for (let year = 5784; year <= 5834; year++) {
    const poster = buildChanukahPoster(year, settings);
    const regular = poster.shacharisRows.find(row => !row.isRoshChodesh);
    const rc = poster.shacharisRows.find(row => row.isRoshChodesh);
    assert(poster.days.every(day => excelWeekday(day.serial) !== 7));
    if (!rc) continue;
    const handout = buildRoshChodeshShacharisPoster(year, 10, settings);
    if (poster.days.every(day => day.netzBinding)) {
      shared++;
      const average = poster.days.reduce((sum, day) => sum + Math.max(
        sunriseElev(dateFromSerial(day.serial), settings) * 1440 - 25,
        hasRoshChodesh(day.serial, settings) ? 400 : 410), 0) / poster.days.length;
      const expected = asClock(Math.floor(average + 1e-7));
      assert.equal(regular.vasikin.time, expected);
      assert.equal(rc.vasikin.time, expected);
      assert.equal(regular.cells[0].text, expected);
      assert.equal(rc.cells[0].text, expected);
      assert.equal(rc.vasikin.trace.steps.at(-1).way, 'down');
      for (const day of poster.days) assert(rc.vasikin.trace.steps[0].note.includes(dateFromSerial(day.serial).toISOString().slice(0, 10)));
    } else {
      separate++;
      const latest = Math.max(...handout.days.map(day => sunriseElev(dateFromSerial(day), settings) * 1440));
      assert.equal(rc.vasikin.time, year === 5787 ? '6:43' : asClock(Math.max(400, Math.ceil(latest - 25 - 1e-7))));
    }
    assert.equal(handout.rows[0].text, rc.vasikin.time);
    assert(roshChodeshText({ month: 10 }, handout.rows).includes(`Shacharis ${rc.vasikin.time}m`));
    for (const day of handout.days) {
      const schedule = roshChodeshSchedule(day, settings);
      assert.equal(schedule.lines[0][0].text, rc.vasikin.time);
      const group = weekdayMornings(day + 7 - excelWeekday(day), settings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL)
        .otherGroups.find(group => group.html === schedule.html);
      assert(group, 'Weekly cards and One sheet use the agreed Rosh Chodesh minute');
      assert.equal(erevTimes(chanukahScheduleLines([day], settings, { mergeAll: true }))[0].text, rc.vasikin.time,
        'A partial chart keeps the complete posted average');
    }
    const latest = Math.max(...handout.days.map(day => sunriseElev(dateFromSerial(day), settings) * 1440));
    const second = handout.rows[1];
    assert(second.trace.value * 1440 >= latest - 25 - 1e-7, 'The second Rosh Chodesh minyan retains its latest-weekday limit');
  }
  assert(shared > 0 && separate > 0);
});

test('the printed 5787 Rosh Chodesh Chanukah first minyan is 6:43 everywhere and ends with that occasion', () => {
  const poster = buildChanukahPoster(5787, settings);
  assert.deepEqual(poster.shacharisRows.map(row => row.vasikin.time), ['6:50', '6:43']);
  const handout = buildRoshChodeshShacharisPoster(5787, 10, settings);
  const days = [dateFromHebrew(30, 9, 5787), dateFromHebrew(1, 10, 5787)];
  assert.deepEqual(handout.days, days);
  assert.deepEqual(handout.rows.map(row => row.text), ['6:43', '7:00', '7:15', '7:35', '8:00', '8:20', '8:40']);
  assert(roshChodeshText({ month: 10 }, handout.rows).includes('Shacharis 6:43m, 7:00en'));
  const state = buildAutomaticCharts(config, tables, new Date('2026-12-06T12:00:00Z'));
  for (const day of poster.days) {
    const first = day.isRoshChodesh ? '6:43' : '6:50';
    const firstMinutes = day.isRoshChodesh ? 403 : 410;
    assert.equal(chanukahShacharisDay(day.serial, settings).lines[0].plain(), first);
    const actual = minyanimForDay(day.serial, state, settings).filter(event => event.name === 'שחרית');
    assert.equal(actual[0].mins, firstMinutes);
    for (const mergeAll of [false, true])
      assert.equal(erevTimes(chanukahScheduleLines([day.serial], settings, { mergeAll }))[0].text, first);
    if (!day.isRoshChodesh) continue;
    assert.equal(roshChodeshBaseSchedule(day.serial, settings).lines[0][0].text, '6:44', 'Keep the unmodified astronomical earliest-start calculation');
    const agreed = roshChodeshSchedule(day.serial, settings).lines.flat();
    assert.deepEqual(actual.map(event => event.mins), [403, 420, 435, 455, 480, 500, 520]);
    assert.equal(agreed[0].text, '6:43');
    assert.equal(agreed[0].trace.value * 1440, 403);
    assert.equal(agreed[0].trace.steps[0].kind, 'fixed');
    assert.match(agreed[0].trace.steps[0].label, /already printed 6:43.*5787/);
    const mornings = weekdayMornings(day.serial + 7 - excelWeekday(day.serial), settings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL);
    assert(mornings.otherGroups.some(group => erevTimes(group.html)[0].text === '6:43'));
  }
  const feed = buildScheduleFeed(config, tables, new Date('2026-12-06T12:00:00Z'));
  for (const date of ['2026-12-10', '2026-12-11']) {
    const morning = feed.days.find(day => day.date === date).events.filter(event => event.category === 'shacharis');
    assert.equal(morning[0].time, '06:43');
    assert(!morning.some(event => event.time === '06:44'));
  }
  const after = dateFromHebrew(3, 10, 5787);
  const laterMornings = minyanimForDay(after, state, settings).filter(event => event.name === 'שחרית');
  assert.equal(laterMornings[0].mins, 420, 'Ordinary mornings resume after Chanukah');
  assert(!laterMornings.some(event => event.mins === 403));
  assert.deepEqual(buildChanukahPoster(5788, settings).shacharisRows.map(row => row.vasikin.time), ['6:53', '6:53']);
});

test('the screenshot year uses 6:53 for both Chanukah first minyanim in all daily and message views', () => {
  const poster = buildChanukahPoster(5788, settings);
  assert.deepEqual(poster.shacharisRows.map(row => row.vasikin.time), ['6:53', '6:53']);
  const state = buildAutomaticCharts(config, tables, dateFromSerial(poster.span.from));
  for (const day of poster.days) {
    const row = poster.shacharisRows.find(row => row.isRoshChodesh === day.isRoshChodesh);
    const expected = row.cells.map(cell => Math.round((cell.trace || cell.traces[0]).value * 1440));
    const actual = minyanimForDay(day.serial, state, settings).filter(event => event.name === 'שחרית');
    assert.deepEqual(actual.map(event => event.mins), expected);
    assert.equal(actual[0].mins, 413);
  }
  const anchor = poster.days[0].serial + 7 - excelWeekday(poster.days[0].serial);
  const mornings = weekdayMornings(anchor, settings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL);
  assert.equal(mornings.everydayStands, false, 'All weekday mornings use the Chanukah schedule in this year');
  assert.equal(erevTimes(mornings.season.find(group => group.name === 'חנוכה').html)[0].text, '6:53');
  assert.equal(erevTimes(mornings.otherGroups[0].html)[0].text, '6:53');
});
