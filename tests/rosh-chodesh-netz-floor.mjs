import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL } from '../js/settings.js';
import { excelWeekday } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { sunriseElev } from '../js/zmanim/zmanim.js';
import { roshChodeshSchedule } from '../js/posters/rosh-chodesh-schedule.js';
import { buildRoshChodeshShacharisPoster } from '../js/posters/shacharis.js';
import { weekdayMornings } from '../js/posters/day.js';
import { roshChodeshText } from '../js/rosh-chodesh-text.js';
import { erevTimes } from '../js/erev-text.js';
import { buildChanukahPoster } from '../js/posters/chanukah.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { minyanimForDay } from '../js/upcoming.js';

const config = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url)));
const settings = resolveSettings(config.settings);
const tables = Object.fromEntries(await Promise.all([
  ['parshaChutz', 'parsha_chutz'], ['parshaEy', 'parsha_ey'], ['parshaNames', 'parsha_names'], ['specialDays', 'special_days'],
].map(async ([key, file]) => [key, JSON.parse(await readFile(new URL('../data/' + file + '.json', import.meta.url)))])));
const minutes = text => { const [hour, minute] = text.split(':').map(Number); return hour * 60 + minute; };

function settingsForSunrise(days, targetMinutes) {
  let west = -100, east = -50;
  for (let step = 0; step < 50; step++) {
    const longitude = (west + east) / 2;
    const latest = Math.max(...days.map(day => sunriseElev(dateFromSerial(day), { ...settings, longitude }) * 1440));
    if (latest > targetMinutes) west = longitude;
    else east = longitude;
  }
  return { ...settings, longitude: (west + east) / 2 };
}

test('first and second minyan floors round upward at second-level boundaries', () => {
  const reference = buildRoshChodeshShacharisPoster(5785, 8, settings);
  for (const [sunrise, first, second] of [
    [424.999, '6:40', '7:00'], [425, '6:40', '7:00'], [425.001, '6:41', '7:00'],
    [444.999, '7:00', '7:00'], [445, '7:00', '7:00'], [445.001, '7:01', '7:01'],
  ]) {
    const options = settingsForSunrise(reference.days, sunrise);
    const poster = buildRoshChodeshShacharisPoster(5785, 8, options);
    assert.deepEqual(poster.rows.slice(0, 2).map(row => row.text), [first, second]);
    assert.deepEqual(poster.rows.slice(2).map(row => row.text), ['7:15', '7:35', '8:00', '8:20', '8:40']);
    assert.deepEqual(poster.rows.map(row => row.mark), ['', '*', '', '**', '', '*', '']);
    assert.deepEqual(poster.rows.map(row => row.underlined), [false, false, true, false, false, false, true]);
    for (const day of poster.days) for (const row of poster.rows.slice(0, 2)) {
      assert(minutes(row.text) >= sunriseElev(dateFromSerial(day), options) * 1440 - 25 - 1e-7);
      assert(row.trace.describe().steps.some(step => step.kind === 'pick'), 'The explanation records the earliest-start comparison');
    }
  }
});

test('equal first and second starts retain both morning minyanim in their own rooms', () => {
  const state = buildAutomaticCharts(config, tables, new Date('2024-11-01T12:00:00Z'));
  const options = resolveSettings(state.settings);
  const poster = buildRoshChodeshShacharisPoster(5785, 8, options);
  assert.deepEqual(poster.rows.slice(0, 2).map(row => row.text), ['7:02', '7:02']);
  for (const day of poster.days) {
    const mornings = minyanimForDay(day, state, options).filter(event => event.name === 'שחרית');
    assert.deepEqual(mornings.map(event => event.mins), [422, 422, 435, 455, 480, 500, 520]);
    assert.deepEqual(mornings.map(event => event.place), ['', 'בעזר״נ', 'למטה', 'באולם השמחות', '', 'בעזר״נ', 'למטה']);
  }
});

test('both dates, week cards and messages share one Rosh Chodesh morning', () => {
  for (const [year, month] of [[5787, 10], [5785, 11], [5787, 6]]) {
    const poster = buildRoshChodeshShacharisPoster(year, month, settings);
    for (const day of poster.days) {
      const schedule = roshChodeshSchedule(day, settings);
      assert.deepEqual(schedule.days, poster.days);
      assert.deepEqual(erevTimes(schedule.html).map(time => time.text), poster.rows.map(row => row.text));
      const week = weekdayMornings(day + 7 - excelWeekday(day), settings, WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL);
      assert(week.otherGroups.some(group => group.html === schedule.html));
    }
    assert(roshChodeshText({ month }, poster.rows).includes(`${poster.rows[0].text}m, ${poster.rows[1].text}en`));
  }
  assert.deepEqual(buildRoshChodeshShacharisPoster(5787, 6, settings).rows.slice(0, 2).map(row => row.text), ['6:40', '7:00']);
});

test('configured elevation and location are used and Shabbos does not set a weekday floor', () => {
  for (let year = 5784; year <= 5834; year++) for (const month of [8, 10, 11]) {
    const options = { ...settings, elevation: 500, useElevation: true };
    const poster = buildRoshChodeshShacharisPoster(year, month, options);
    if (!poster) continue;
    assert(poster.days.every(day => excelWeekday(day) !== 7));
    const limit = Math.ceil(Math.max(...poster.days.map(day => sunriseElev(dateFromSerial(day), options) * 1440)) - 25 - 1e-7);
    const sharedChanukah = month === 10 && buildChanukahPoster(year, options).days.every(day => day.netzBinding);
    if (!sharedChanukah) assert.equal(minutes(poster.rows[0].text), Math.max(400, limit));
    assert.equal(minutes(poster.rows[1].text), Math.max(420, limit));
  }
});
