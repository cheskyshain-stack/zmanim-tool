import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScheduleFeed } from '../scripts/schedule-feed.mjs';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name, import.meta.url), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json', 'special_days.json',
].map(readJSON));
const tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const feedAt = instant => buildScheduleFeed(config, tables, new Date(instant));
const dayAt = (feed, date) => feed.days.find(day => day.date === date);

test('returns only ten consecutive New York calendar dates and no location data', () => {
  const feed = feedAt('2026-10-07T21:00:00Z');
  assert.deepEqual(feed.range, { startDate: '2026-10-07', endDate: '2026-10-16', dayCount: 10 });
  assert.equal(feed.timeZone, 'America/New_York');
  assert.equal(feed.days.length, 10);
  assert.deepEqual(Object.keys(feed).sort(), ['days', 'generatedAt', 'range', 'schemaVersion', 'timeZone']);
  for (const [offset, day] of feed.days.entries()) {
    assert.equal(day.date, '2026-10-' + String(7 + offset).padStart(2, '0'));
    assert.deepEqual(Object.keys(day).sort(), ['date', 'events', 'hebrewDate', 'occasions', 'parsha', 'status', 'weekday']);
    const seen = new Set();
    for (const event of day.events) {
      assert.deepEqual(Object.keys(event).sort(), event.reckoning
        ? ['category', 'displayTime', 'name', 'reckoning', 'time']
        : ['category', 'displayTime', 'name', 'time']);
      assert.match(event.time, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
      assert.match(event.displayTime, /^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/);
      const signature = JSON.stringify([event.name, event.time, event.reckoning || '']);
      assert.equal(seen.has(signature), false, 'Roomless events must not repeat');
      seen.add(signature);
    }
    assert.deepEqual(day.events.map(e => e.time), day.events.map(e => e.time).sort());
  }
  assert.doesNotMatch(JSON.stringify(feed), /place|location|room|latitude|longitude|address|למטה|בעזר|עזרת נשים|אולם השמחות|<u>|\*|[\uE000\uE001]/i);
});

test('keeps the entire current day, including morning and midnight services', () => {
  const early = feedAt('2026-10-07T05:00:00Z');
  const late = feedAt('2026-10-08T03:59:00Z');
  assert.deepEqual(early.days, late.days);
  const today = early.days[0];
  assert.ok(today.events.some(e => e.category === 'maariv' && e.time === '00:00'));
  assert.ok(today.events.some(e => e.category === 'shacharis' && e.time === '07:00'));
  assert.ok(today.events.some(e => e.category === 'mincha' && e.time === '13:15'));
});

test('advances at New York midnight, including both daylight saving offsets', () => {
  for (const [before, after, start, next] of [
    ['2026-10-08T03:59:59Z', '2026-10-08T04:00:00Z', '2026-10-07', '2026-10-08'],
    ['2026-11-02T04:59:59Z', '2026-11-02T05:00:00Z', '2026-11-01', '2026-11-02'],
    ['2027-03-15T03:59:59Z', '2027-03-15T04:00:00Z', '2027-03-14', '2027-03-15'],
  ]) {
    assert.equal(feedAt(before).range.startDate, start);
    const moved = feedAt(after);
    assert.equal(moved.range.startDate, next);
    assert.equal(moved.days.length, 10);
    assert.equal(moved.days[9].date, moved.range.endDate);
  }
});

test('Rosh Chodesh and BHB carry the special morning schedule', () => {
  const rc = dayAt(feedAt('2026-10-07T16:00:00Z'), '2026-10-11');
  assert.ok(rc.occasions.includes('Rosh Chodesh Cheshvan'));
  assert.ok(rc.events.some(e => e.category === 'shacharis' && e.time === '06:40'));
  assert.equal(rc.events.some(e => e.category === 'shacharis' && e.time === '07:20'), false);
  const bhb = dayAt(feedAt('2026-10-19T16:00:00Z'), '2026-10-19');
  assert.ok(bhb.occasions.includes('BHB'));
  assert.ok(bhb.events.some(e => e.category === 'shacharis' && e.time === '06:40'));
});

test('Pesach and Rosh Hashana use their special schedules across a weekly boundary', () => {
  const pesach = feedAt('2026-04-01T16:00:00Z');
  for (const [date, occasion] of [['2026-04-02', 'Pesach 1st day'], ['2026-04-03', 'Pesach 2nd day']]) {
    const day = dayAt(pesach, date);
    assert.ok(day.occasions.includes(occasion));
    assert.equal(day.status, 'available');
    assert.ok(day.events.some(e => e.category === 'shacharis'));
  }
  const rh = feedAt('2026-09-11T16:00:00Z');
  assert.ok(dayAt(rh, '2026-09-12').occasions.some(s => s.includes('Rosh Hashana 1st day')));
  assert.ok(dayAt(rh, '2026-09-13').occasions.includes('Rosh Hashana 2nd day'));
  assert.ok(dayAt(rh, '2026-09-13').events.some(e => e.category === 'shacharis'));
});

test('an unconfirmed Tisha BAv schedule is identified without substituting ordinary times', () => {
  const day = dayAt(feedAt('2026-07-23T16:00:00Z'), '2026-07-23');
  assert.equal(day.status, 'unconfirmed');
  assert.deepEqual(day.events, []);
});

test('rejects an invalid generation date', () => {
  assert.throws(() => buildScheduleFeed(config, tables, new Date('invalid')), /Invalid feed build time/);
});
