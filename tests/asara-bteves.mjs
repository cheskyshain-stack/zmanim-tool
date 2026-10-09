import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { buildAsaraBTevesPoster, asaraBTevesSerial, asaraSelichosFirst } from '../js/posters/asarabteves.js';
import { asaraLastMinchaTrace, fridayMainMinchaParts } from '../js/sheets/common.js';
import { buildChorefRow } from '../js/sheets/choref.js';
import { buildKayitzRow } from '../js/sheets/kayitz.js';
import { asaraBTevesText } from '../js/taanis-text.js';
import { hasTaanis, excelWeekday } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { minyanimForDay } from '../js/upcoming.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { weeklyReaderData, readerWeekIndex } from '../js/ui/weekly-reader.js';
import { weeklyAgenda } from '../js/ui/weekly-agenda.js';
import { buildScheduleFeed } from '../scripts/schedule-feed.mjs';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name, import.meta.url), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json', 'special_days.json',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const block = (p, calc) => p.sets.find(s => s.calc === calc);
const times = (p, calc) => block(p, calc)?.lines.flat() || [];
const clock = (h, m, s = 0) => (h * 3600 + m * 60 + s) / 86400;

test('5786 matches the weekday reference and its room marks', () => {
  const p = buildAsaraBTevesPoster(5786, settings);
  assert.equal(dateFromSerial(p.span.from).toISOString().slice(0, 10), '2025-12-30');
  assert.deepEqual(times(p, 'shacharis').map(t => [t.text, t.underlined, t.mark]), [
    ['6:40', false, ''], ['7:00', false, '*'], ['7:15', true, ''],
    ['7:35', false, '**'], ['8:00', false, ''], ['8:20', false, '*'], ['8:40', true, ''],
  ]);
  assert.equal(times(p, 'shacharis')[0].timeNote, 'סליחות קודם שחרית');
  assert.deepEqual(times(p, 'mincha').map(t => [t.text, t.underlined, t.mark]), [
    ['12:45', true, ''], ['1:15', false, '*'], ['1:35', true, ''],
    ['1:50', false, ''], ['3:30', true, ''], ['4:00', false, ''],
  ]);
  assert.deepEqual(times(p, 'maariv').map(t => [t.text, t.underlined]), [['5:16', false], ['5:31', true], ['10:30', false]]);
  assert.equal(block(p, 'shkia').note.text, '4:41');
  assert.equal(block(p, 'candles'), undefined);
  assert.match(asaraBTevesText(p), /Mincha 12:45d, 1:15en, 1:35d, 1:50m, 3:30d, 4:00m/);
  assert.match(asaraBTevesText(p), /Mariv 5:16m, 5:31d, 10:30m/);
});

test('5785 Friday uses the current chart list, with the reference final Mincha and candles', () => {
  const p = buildAsaraBTevesPoster(5785, settings), date = dateFromSerial(p.span.from);
  assert.equal(date.toISOString().slice(0, 10), '2025-01-10');
  assert.equal(p.friday, true);
  assert.deepEqual(times(p, 'mincha').slice(0, -1).map(t => t.text),
    fridayMainMinchaParts(date, settings, p.span.from + 1).times.map(t => t.plain()));
  assert.equal(times(p, 'mincha').at(-1).text, '4:25');
  assert.equal(block(p, 'candles').note.text, '4:32');
  assert.equal(block(p, 'shkia').note.text, '4:50');
  assert.equal(block(p, 'maariv'), undefined, 'Friday has no weekday fast Maariv block');
  for (const build of [buildChorefRow, buildKayitzRow]) {
    const row = build({ serial: p.span.from + 1, specialParsha: '' }, settings);
    assert.equal(row.G, '4:25', 'Seasonal chart must use the fast Friday exception');
    const ordinary = build({ serial: p.span.from + 8, specialParsha: '' }, settings);
    assert.equal(ordinary.traces.G.at(-1).steps.find(s => s.kind === 'offset').minutes, -15);
  }
  assert.deepEqual(p.minyanim.filter(e => e.name === 'מעריב').map(e => [e.mins, e.place]), [[17 * 60 + 40, 'למטה']],
    'Regular Friday-night Maariv remains available to the weekly page');
  assert.equal(p.zmanim[0].name, 'הדלקת נרות');
  assert.equal(p.minyanim.some(e => /הדלקת|שקיעה/.test(e.name)), false, 'Auxiliary zmanim are never minyanim');
  assert.match(asaraBTevesText(p), /Hadlakas Neiros 4:32\nShkia 4:50/);
  assert.doesNotMatch(asaraBTevesText(p), /Mariv/);
});

test('sunrise and five-minute boundaries use seconds without rounding to the wrong side', () => {
  assert.equal(asaraSelichosFirst(clock(7, 4, 59)), false);
  assert.equal(asaraSelichosFirst(clock(7, 5)), false);
  assert.equal(asaraSelichosFirst(clock(7, 5, 1)), true);
  for (const [sunset, expected] of [
    [clock(16, 39, 59), '3:55'], [clock(16, 40), '4:00'],
    [clock(16, 40, 59), '4:00'], [clock(16, 44, 59), '4:00'], [clock(16, 45), '4:05'],
  ]) assert.equal(asaraLastMinchaTrace(sunset).plain(), expected);
  assert.equal(asaraLastMinchaTrace(clock(16, 50, 59), true).plain(), '4:25');
  assert.equal(asaraLastMinchaTrace(clock(16, 51), true).plain(), '4:26');
});

test('every year obeys its own sunset rules and the seasonal morning schedule', () => {
  let weekdays = 0, fridays = 0;
  for (let year = 5784; year <= 5834; year++) {
    const p = buildAsaraBTevesPoster(year, settings), last = times(p, 'mincha').at(-1);
    assert.equal(hasTaanis(p.span.from, { ...settings, english: true }), 'Tenth of Teves');
    assert.equal(p.span.from, asaraBTevesSerial(year));
    const gap = (p.shkia - last.trace.value) * 1440;
    if (p.friday) {
      fridays++;
      assert(gap >= 25 - 1e-7 && gap < 26);
    } else {
      weekdays++;
      assert(gap >= 40 - 1e-7 && gap < 45);
      assert.equal(Math.round(last.trace.value * 1440) % 5, 0);
      const evening = times(p, 'maariv');
      assert(Math.abs((evening[0].trace.value - p.shkia) * 1440 - 35) < 1e-7);
      assert(Math.abs((evening[1].trace.value - p.shkia) * 1440 - 50) < 1e-7);
    }
    assert.equal(last.underlined, false);
    assert.equal(last.mark, '');
    assert.equal(times(p, 'shacharis').filter(t => t.timeNote).length, asaraSelichosFirst(p.netz) ? 1 : 0);
  }
  assert(weekdays && fridays);
});

test('weekly agenda, next minyan and roomless ten-day API read the same special schedule', () => {
  for (const year of [5785, 5786, 5787]) {
    const p = buildAsaraBTevesPoster(year, settings), serial = p.span.from;
    const now = new Date(dateFromSerial(serial).toISOString().slice(0, 10) + 'T12:00:00Z');
    const state = buildAutomaticCharts(config, tables, now), index = readerWeekIndex(state);
    assert.deepEqual(minyanimForDay(serial, state, settings), [...p.minyanim].sort((a, b) => a.mins - b.mins));
    const anchor = serial + 7 - excelWeekday(serial);
    const data = weeklyReaderData(anchor, index, state, settings);
    const agenda = weeklyAgenda(data, anchor, state, settings, dateFromSerial(serial - 1));
    const events = agenda.sections.flatMap(s => s.events).filter(e => e.serial === serial && !e.auxiliary);
    assert.deepEqual(events.map(e => [e.name, e.mins, e.place]),
      [...p.minyanim].sort((a, b) => a.mins - b.mins).map(e => [e.name, e.mins, e.place]));
    const feed = buildScheduleFeed(config, tables, now);
    assert.equal(feed.days.length, 10);
    const day = feed.days[0];
    assert(day.occasions.includes('Tenth of Teves'));
    const asClock = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    assert.deepEqual(day.events.filter(e => e.category === 'mincha').map(e => e.time),
      p.minyanim.filter(e => e.name === 'מנחה').map(e => asClock(e.mins)));
    assert.deepEqual(day.events.filter(e => e.category === 'maariv').map(e => e.time),
      p.minyanim.filter(e => e.name === 'מעריב').map(e => asClock(e.mins)));
    assert.doesNotMatch(JSON.stringify(feed), /place|location|room|למטה|בעזר|אולם|<u>|\*/i);
  }
});
