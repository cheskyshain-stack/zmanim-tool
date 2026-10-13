import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { buildShivaAsarTammuzPoster, shivaAsarTammuzSerial } from '../js/posters/shiva-asar-tammuz.js';
import { shivaAsarTammuzText } from '../js/taanis-text.js';
import { dateFromHebrew, excelWeekday, hasTaanis } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { minchaGedolaLechumra, sunsetElev } from '../js/zmanim/zmanim.js';
import { minyanimForDay } from '../js/upcoming.js';
import { buildAutomaticCharts } from '../js/publish.js';
import { weeklyReaderData, readerWeekIndex } from '../js/ui/weekly-reader.js';
import { weeklyAgenda } from '../js/ui/weekly-agenda.js';
import { buildScheduleFeed } from '../scripts/schedule-feed.mjs';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url)));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const block = (poster, key) => poster.sets.find(set => set.calc === key);
const times = (poster, key) => block(poster, key)?.lines.flat() || [];

test('51 years follow the fast calendar, sunset offsets and Mincha Gedola Lechumra', () => {
  let postponed = 0;
  for (let year = 5784; year <= 5834; year++) {
    const poster = buildShivaAsarTammuzPoster(year, settings), serial = poster.span.from;
    assert.equal(hasTaanis(serial, { ...settings, english: true }), 'Seventeenth of Tammuz');
    assert.equal(serial, shivaAsarTammuzSerial(year));
    if (excelWeekday(dateFromHebrew(17, 4, year)) === 7) {
      postponed++;
      assert.equal(serial, dateFromHebrew(18, 4, year));
    }
    assert.equal(poster.friday, false, 'The fast cannot fall on Friday');
    assert.equal(poster.title, 'שבעה עשר בתמוז');
    assert.deepEqual(times(poster, 'shacharis').map(time => time.text), ['6:40', '7:00', '7:15', '7:35', '8:00', '8:20', '8:40']);
    const mincha = times(poster, 'mincha');
    const gedola = minchaGedolaLechumra(dateFromSerial(serial), settings);
    assert(mincha.every(time => time.trace.value >= gedola - 1e-9), 'No winter Mincha time can precede summer Mincha Gedola');
    assert(mincha.some(time => time.underlined && time.trace.value * 1440 >= 815));
    const last = mincha.at(-1);
    const gap = (poster.shkia - last.trace.value) * 1440;
    assert(gap >= 40 - 1e-7 && gap < 45);
    assert.equal(Math.round(last.trace.value * 1440) % 5, 0);
    assert.equal(last.underlined, false);
    assert.equal(last.mark, '');
    assert.match(last.trace.steps[0].note, /שבעה עשר בתמוז/, 'The explanation names the selected fast');
    const printedSunset = block(poster, 'shkia').note.trace;
    assert(printedSunset.value >= poster.shkia - 1e-9 && printedSunset.value < poster.shkia + 1 / 1440);
    const maariv = times(poster, 'maariv');
    for (const [index, offset] of [35, 50].entries()) {
      const gap = (maariv[index].trace.value - poster.shkia) * 1440;
      assert(gap >= offset - 1e-7 && gap < offset + 1);
      assert.equal(maariv[index].trace.steps.findLast(step => step.kind === 'round').way, 'up');
    }
    assert.equal(maariv[0].underlined, false);
    assert.equal(maariv[1].underlined, true);
    assert.equal(maariv[2].text, '10:30');
    assert.equal(block(poster, 'candles'), undefined);
  }
  assert(postponed > 0);
  assert.equal(buildShivaAsarTammuzPoster(null, settings), null);
});

test('5787 summer schedule omits winter slots and shares its exact times with the message', () => {
  const poster = buildShivaAsarTammuzPoster(5787, settings);
  assert.equal(dateFromSerial(poster.span.from).toISOString().slice(0, 10), '2027-07-22');
  assert.deepEqual(times(poster, 'mincha').map(time => [time.text, time.underlined]),
    [['1:40', true], ['1:50', false], ['3:30', true], ['7:40', false]]);
  assert.equal(block(poster, 'shkia').note.text, '8:21');
  assert.deepEqual(times(poster, 'maariv').map(time => time.text), ['8:56', '9:11', '10:30']);
  assert.match(shivaAsarTammuzText(poster), /^Shiva Asar B'Tammuz\nShacharis 6:40m, 7:00en, 7:15d, 7:35sh, 8:00m, 8:20en, 8:40d\nMincha 1:40d, 1:50m, 3:30d, 7:40m\nShkia 8:21\nMariv 8:56m, 9:11d, 10:30m/);
  assert.doesNotMatch(shivaAsarTammuzText(poster), /Teves|Hadlakas|Selichos before/);
});

test('the weekly agenda, upcoming minyanim and schedule API quote the full fast-day schedule', () => {
  for (const year of [5785, 5786, 5787]) {
    const poster = buildShivaAsarTammuzPoster(year, settings), serial = poster.span.from;
    const now = new Date(dateFromSerial(serial).toISOString().slice(0, 10) + 'T12:00:00Z');
    const state = buildAutomaticCharts(config, tables, now), index = readerWeekIndex(state);
    assert.deepEqual(minyanimForDay(serial, state, settings), [...poster.minyanim].sort((a, b) => a.mins - b.mins));
    const anchor = serial + 7 - excelWeekday(serial);
    const data = weeklyReaderData(anchor, index, state, settings);
    const agenda = weeklyAgenda(data, anchor, state, settings, dateFromSerial(serial - 1));
    const events = agenda.sections.flatMap(section => section.events).filter(event => event.serial === serial && !event.auxiliary);
    assert.deepEqual(events.map(event => [event.name, event.mins, event.place]),
      [...poster.minyanim].sort((a, b) => a.mins - b.mins).map(event => [event.name, event.mins, event.place]));
    const feed = buildScheduleFeed(config, tables, now);
    const asClock = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    assert(feed.days[0].occasions.includes('Seventeenth of Tammuz'));
    for (const [category, name] of [['mincha', 'מנחה'], ['maariv', 'מעריב']]) {
      assert.deepEqual(feed.days[0].events.filter(event => event.category === category).map(event => event.time),
        poster.minyanim.filter(event => event.name === name).map(event => asClock(event.mins)));
    }
  }
});
