import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings, WEEKDAY_SHACHARIS } from '../js/settings.js';
import { dateFromHebrew, excelWeekday } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { minchaGedolaLechumra } from '../js/zmanim/zmanim.js';
import { buildChanukahPoster, chanukahSundayMincha, chanukahSundayOpening } from '../js/posters/chanukah.js';
import { minyanimForDay } from '../js/upcoming.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { buildWeekdayRow } from '../js/sheets/weekday.js';
import { weekText } from '../js/week-text.js';
import { readerWeekIndex, weeklyReaderData } from '../js/ui/weekly-reader.js';
import { weeklyAgenda } from '../js/ui/weekly-agenda.js';
import { buildScheduleFeed } from '../scripts/schedule-feed.mjs';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name, import.meta.url), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json', 'special_days.json',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const fraction = (hour, minute, second = 0) => (hour * 3600 + minute * 60 + second) / 86400;

test('12:30 moves later by five-minute steps at exact Mincha Gedola boundaries', () => {
  for (const [gedola, expected] of [
    [fraction(12, 29, 59.999), '12:30'], [fraction(12, 30), '12:35'],
    [fraction(12, 30, 0.001), '12:35'], [fraction(12, 34, 59.999), '12:35'],
    [fraction(12, 35), '12:40'], [fraction(12, 35, 0.001), '12:40'],
  ]) {
    const time = chanukahSundayOpening(gedola);
    assert.equal(time.plain(), expected);
    assert(time.value > gedola, 'Never before or exactly at the raw Mincha Gedola limit');
    assert(time.flags.underlined, 'The extra Mincha is downstairs');
    assert(time.steps.some(step => step.kind === 'pick' && step.against.name === 'מנחה גדולה לחומרא'));
  }
});

test('every Chanukah Sunday is included over 51 years, with no extra on other days', () => {
  let sawTwoSundays = false, sawDelayed = false;
  for (let year = 5784; year <= 5834; year++) {
    const start = dateFromHebrew(25, 9, year), poster = buildChanukahPoster(year, settings, tables);
    const sundays = Array.from({ length: 8 }, (_, i) => start + i).filter(day => excelWeekday(day) === 1);
    assert.deepEqual(poster.sundayMincha.map(extra => extra.serial), sundays);
    sawTwoSundays ||= sundays.length === 2;
    for (let day = start - 7; day <= start + 14; day++) {
      const extra = chanukahSundayMincha(day, settings);
      if (!sundays.includes(day)) { assert.equal(extra, null); continue; }
      const minutes = Math.round(extra.value * 1440), limit = minchaGedolaLechumra(dateFromSerial(day), settings) * 1440;
      assert(minutes >= 750 && minutes % 5 === 0 && minutes > limit);
      assert(minutes === 750 || minutes - 5 <= limit + 1e-7, 'Use the earliest allowed five-minute slot');
      sawDelayed ||= minutes > 750;
      assert.equal(poster.minyanim.filter(event => event.serial === day && event.name === 'מנחה' && event.mins === minutes && event.place === 'למטה').length, 1);
    }
    assert(poster.sundayMinchaRows.every(row => row.label.includes("יום א'")));
  }
  assert(sawTwoSundays, 'Both Sundays of an eight-day Chanukah are covered');
  assert(sawDelayed, 'Real calendar years exercise the delayed opening');
});

test('poster, chart note, daily schedule, weekly agenda, message and API share Sunday only', () => {
  const now = new Date('2026-12-06T15:00:00Z');
  const state = buildAutomaticCharts(config, tables, now);
  const poster = buildChanukahPoster(5787, settings, tables), sunday = poster.sundayMincha[0].serial;
  const index = readerWeekIndex(state), shabbos = sunday + 6, week = index.get(shabbos).week;
  const row = buildWeekdayRow(week, settings);
  assert(!row.C.includes('12:30'), 'The standing weekday menu is unchanged');
  assert.match(row.printOverrides.C.split('\n')[0], /12:30.*חנוכה יום א׳.*1:00/);
  assert.deepEqual(row.printOverrides.C.match(/\d{1,2}:\d{2}/g), ['12:30', '1:00', '1:15', '1:35', '1:50', '4:15']);
  assert(minyanimForDay(sunday, state, settings).some(event => event.name === 'מנחה' && event.mins === 750 && event.place === 'למטה'));
  assert(!minyanimForDay(sunday + 1, state, settings).some(event => event.name === 'מנחה' && event.mins === 750));
  assert.match(weekText(WEEKDAY_SHACHARIS, row, "P' Miketz - Chanuka", shabbos, settings), /Mincha \(Sunday only\): 12:30d/);
  const agenda = weeklyAgenda(weeklyReaderData(shabbos, index, state, settings), shabbos, state, settings, now);
  const events = agenda.sections.flatMap(section => section.events);
  assert.equal(events.filter(event => event.serial === sunday && event.name === 'מנחה' && event.mins === 750 && !event.auxiliary).length, 1);
  assert(!events.some(event => event.serial === sunday + 1 && event.name === 'מנחה' && event.mins === 750));
  const feed = buildScheduleFeed(config, tables, now);
  assert.equal(feed.days[0].date, '2026-12-06');
  assert.equal(feed.days[0].events.filter(event => event.category === 'mincha' && event.time === '12:30').length, 1);
  assert(!feed.days[1].events.some(event => event.category === 'mincha' && event.time === '12:30'));
});

test('two Sundays in 5804 retain their different times on the poster and the public feed', () => {
  const poster = buildChanukahPoster(5804, settings, tables);
  assert.deepEqual(poster.sundayMincha.map(extra => extra.time.plain()), ['12:30', '12:35']);
  assert.equal(poster.sundayMinchaRows.length, 2);
  assert(poster.sundayMinchaRows[0].label.includes('כסלו'));
  assert(poster.sundayMinchaRows[1].label.includes('טבת'));
  const feed = buildScheduleFeed(config, tables, new Date('2043-12-27T15:00:00Z'));
  const first = feed.days.find(day => day.date === '2043-12-27');
  const second = feed.days.find(day => day.date === '2044-01-03');
  assert(first.events.some(event => event.category === 'mincha' && event.time === '12:30'));
  assert(second.events.some(event => event.category === 'mincha' && event.time === '12:35'));
  assert(!second.events.some(event => event.category === 'mincha' && event.time === '12:30'));
});
