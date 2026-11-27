import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot } from '../src/schedules.js';
import { localToISO } from '../public/display-assets/time.js';
import { candleLightingForScreen, candleCountdownText, CANDLE_HOLD_MS, isCandleLighting } from '../public/display-assets/candle-lighting.js';
import { candleLightingHTML, nextMinyanHTML } from '../public/display-assets/renderer.js';
import { quarterSchedule } from '../public/display-assets/quarter-schedules.js';
import { QuarterPanel } from '../public/display-assets/quarter-panels.js';
import { dateFromHebrew } from '../../js/hebrew-calendar.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';
const atOffset = (at, offset) => new Date(Date.parse(at) + offset).toISOString();

test('the center card uses the source candle time and the incoming Shabbos or Yom Tov title', () => {
  for (const [date, title] of [['2026-11-27', 'שבת'], ['2026-09-11', 'שבת · יום א׳ ראש השנה'], ['2026-09-20', 'יום כיפור'], ['2027-04-21', 'יום א׳ פסח']]) {
    const at = localToISO(date + 'T12:00'), schedule = scheduleSnapshot(at);
    const source = schedule.today.events.find(event => event.auxiliary && isCandleLighting(event.name));
    const candle = candleLightingForScreen(schedule, at);
    assert.deepEqual(candle, {...source, title});
    const html = candleLightingHTML(candle, at);
    assert(html.includes(title) && html.includes(source.time));
    assert(html.indexOf('candle-title') < html.indexOf('הדלקת נרות'));
    assert.match(html, /next-period">PM<\/span>/);
    assert.doesNotMatch(nextMinyanHTML(schedule.next, at), /Location|next-location-label/);
    assert(nextMinyanHTML(schedule.next, at).includes(schedule.next.place));
  }
});

test('twenty Hebrew years of holiday eves retain their actual source times and day labels', () => {
  let checked = 0;
  for (let year = 5787; year <= 5806; year++) for (const [day, month] of [[29,6],[9,7],[14,7],[14,1],[20,1]]) {
    const date = dateFromSerial(dateFromHebrew(day, month, year)).toISOString().slice(0, 10);
    const at = localToISO(date + 'T12:00'), schedule = scheduleSnapshot(at);
    const source = schedule.today.events.find(event => event.auxiliary && isCandleLighting(event.name));
    const candle = candleLightingForScreen(schedule, at);
    if (!source) { assert.equal(candle, null); continue; }
    assert.equal(candle.time, source.time); assert.equal(candle.at, source.at);
    assert.equal(candle.title, schedule.today.prayerHeadings.evening.title); checked++;
  }
  assert(checked > 60);
});

test('today only, invalid sources and the 25-minute hold match the congregation card', () => {
  const at = localToISO('2026-11-27T12:00'), schedule = scheduleSnapshot(at);
  const candle = candleLightingForScreen(schedule, at);
  assert(candleLightingForScreen(schedule, candle.at));
  assert(candleLightingForScreen(schedule, atOffset(candle.at, CANDLE_HOLD_MS - 1)));
  assert.equal(candleLightingForScreen(schedule, atOffset(candle.at, CANDLE_HOLD_MS)), null);
  assert.equal(candleLightingForScreen(schedule, localToISO('2026-11-28T00:00')), null);
  const weekdayAt = localToISO('2026-11-26T12:00');
  assert.equal(candleLightingForScreen(scheduleSnapshot(weekdayAt), weekdayAt), null);
  assert.equal(candleLightingForScreen({...schedule, today: {...schedule.today, events: [{...candle, at: 'invalid'}]}}, at), null);
});

test('candle countdown keeps hours, seconds, now, and elapsed time at exact boundaries', () => {
  const at = '2026-11-27T21:15:00.000Z';
  for (const [offset, expected] of [[-3660000,'in 1 hour 1 minute'],[-3600000,'in 1 hour'],[-600001,'in 11 minutes'],[-600000,'10:00'],[-1,'0:01'],[0,'now'],[1000,'0:01 ago'],[CANDLE_HOLD_MS - 1,'24:59 ago'],[CANDLE_HOLD_MS,'']])
    assert.equal(candleCountdownText(at, atOffset(at, offset)), expected);
});

test('only the duplicate candle row leaves Zmanei Tefillah, keeping the source data and prayers', () => {
  for (const date of ['2026-11-27','2026-09-11','2026-09-20','2027-04-21']) {
    const at = localToISO(date + 'T12:00'), schedule = scheduleSnapshot(at), original = structuredClone(schedule);
    const data = quarterSchedule(schedule, at);
    const rows = QuarterPanel.prototype.descriptors.call({kind:'prayers'}, data).filter(row => row.type === 'prayer');
    assert(!rows.some(row => row.html.includes('הדלקת נרות')));
    for (const group of data.prayerSections.flatMap(section => section.groups)) {
      if (group.auxiliary && isCandleLighting(group.label)) continue;
      // The existing prayer panel separately omits Shema deadlines.
      if (group.auxiliary && /ס.*ז.*ק.*ש/.test(group.label)) continue;
      const row = rows.find(row => row.key === 'p:' + group.key);
      assert(row, group.label);
      for (const event of group.events) assert(row.html.includes(event.time), group.label + ': ' + event.time);
    }
    assert.deepEqual(schedule, original);
  }
});


test('Shul View keeps the recently announced Chanukah pair and Asara 1:00 opening', () => {
  for (const date of ['2026-12-04','2026-12-06','2026-12-11']) {
    const schedule = scheduleSnapshot(localToISO(date + 'T12:00'));
    const mincha = schedule.today.events.filter(event => !event.auxiliary && /מנחה/.test(event.name));
    for (const minutes of [740,755]) assert(mincha.some(event => event.mins === minutes && event.place === 'למטה'), date);
    assert(!mincha.some(event => event.mins === 750), date + ': the former 12:30 moved to 12:35');
  }
  const fast = scheduleSnapshot(localToISO('2026-12-20T12:44'));
  assert.equal(fast.next.mins,780);assert.equal(fast.next.place,'למטה');
  assert(!fast.today.events.some(event => !event.auxiliary && /מנחה/.test(event.name) && event.mins === 765));
});
