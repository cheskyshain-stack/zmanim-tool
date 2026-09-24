import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot, sunset, settings } from '../src/schedules.js';
import { validate } from '../src/model.js';
import { localToISO, localStamp } from '../public/display-assets/time.js';
import { buildSukkosPoster } from '../../js/posters/sukkos.js';
import { buildRoshHashanaPoster } from '../../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../../js/posters/yomkippur.js';
import { buildPesachPoster } from '../../js/posters/pesach.js';
import { buildTzomGedaliaPoster } from '../../js/posters/tzomgedalia.js';
import { dateFromHebrew, excelWeekday } from '../../js/hebrew-calendar.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';
import { publicPosterSections } from '../../js/ui/posters-view.js';
import { groupWeekdayPresentation } from '../public/display-assets/weekday-groups.js';

const before = at => new Date(Date.parse(at) - 1).toISOString();
const atLocal = localToISO;
const civil = serial => dateFromSerial(serial).toISOString().slice(0, 10);
const snapshotOn = (serial, time = '12:00') => scheduleSnapshot(atLocal(civil(serial) + 'T' + time));
const sameMinyan = (actual, expected) => actual.name === expected.name && actual.mins === expected.mins && actual.place === (expected.place || 'בית מדרש');

test('original pages wait for the preceding Shabbos closing events, not civil midnight', () => {
  const yk = scheduleSnapshot(atLocal('2026-09-20T02:00')).specialSheet;
  assert.equal(yk.sourceId, 'yk:5787');
  assert.equal(yk.previousShabbos, '2026-09-19');
  assert.equal(scheduleSnapshot(before(yk.previewStartsAt)).specialSheet, null);
  assert.equal(scheduleSnapshot(yk.previewStartsAt).specialSheet.placement, 'shabbos');
  assert.ok(yk.previewStartsAt > sunset(yk.previousShabbos));
  assert.equal(localStamp(yk.previewStartsAt).slice(0, 10), yk.previousShabbos);
  assert.equal(scheduleSnapshot(before(yk.previewStartsAt)).nextChangeAt, yk.previewStartsAt);
});

test('Sukkos retains ordinary erev Shacharis until the last minyan is finished', () => {
  const snapshot = scheduleSnapshot(atLocal('2026-09-24T12:00'));
  const sheet = snapshot.specialSheet;
  assert.equal(sheet.sourceId, 'sukkos:5787');
  assert.equal(sheet.placement, 'shabbos');
  const erev = scheduleSnapshot(atLocal('2026-09-25T08:00'));
  const morning = erev.today.events.filter(e => e.name === 'שחרית');
  assert.ok(morning.length);
  const last = Math.max(...morning.map(e => Date.parse(e.at)));
  assert.equal(Date.parse(sheet.coversBothAt), last + 5 * 60000);
  assert.equal(localStamp(sheet.coversBothAt), '2026-09-25T08:45');
  assert.equal(scheduleSnapshot(before(sheet.coversBothAt)).specialSheet.placement, 'shabbos');
  assert.equal(scheduleSnapshot(sheet.coversBothAt).specialSheet.placement, 'both');
  assert.equal(snapshot.nextChangeAt, sheet.coversBothAt);
});

test('an upcoming sheet cannot replace an earlier active holy day before its closing events', () => {
  const yk = scheduleSnapshot(atLocal('2026-09-21T20:00')).specialSheet;
  assert.equal(yk.sourceId, 'yk:5787');
  assert.equal(scheduleSnapshot(before(yk.endsAt)).specialSheet.sourceId, 'yk:5787');
  const sukkos = scheduleSnapshot(yk.endsAt).specialSheet;
  assert.equal(sukkos.sourceId, 'sukkos:5787');
  assert.equal(sukkos.placement, 'shabbos');
  assert.equal(localStamp(yk.endsAt), '2026-09-21T22:35');
});

test('Sukkos keeps its full printed page but stops displaying it when Simchas Torah closes', () => {
  const sheet = scheduleSnapshot(atLocal('2026-09-26T12:00')).specialSheet;
  const poster = buildSukkosPoster(5787, settings);
  assert.equal(sheet.to, dateFromSerial(poster.span.to).toISOString().slice(0, 10));
  assert.deepEqual(sheet.sections, publicPosterSections('sukkos', poster));
  assert.equal(sheet.displayThrough, '2026-10-04');
  assert.ok(sheet.to > sheet.displayThrough, 'The following-week times remain on the printed page');
  assert.equal(localStamp(sheet.endsAt).slice(0, 10), sheet.displayThrough);
  assert.equal(scheduleSnapshot(before(sheet.endsAt)).specialSheet.sourceId, sheet.sourceId);
  assert.equal(scheduleSnapshot(sheet.endsAt).specialSheet, null);
  const monday = snapshotOn(dateFromHebrew(24, 7, 5787));
  assert.equal(monday.specialSheet, null);
  const weekdayEvents = monday.presentation.weekly.services.flatMap(service => service.groups
    .filter(group => group.days.some(day => day.date === monday.date)).flatMap(group => group.events));
  assert.ok(weekdayEvents.length, 'The following Monday is represented in the weekday panel');
  for (const event of monday.today.events.filter(event => !event.auxiliary)) {
    assert.ok(weekdayEvents.some(actual => sameMinyan(actual, event)), event.name + ' ' + event.mins);
  }
});

test('each supported original source uses its own page without inventing Shavuos times', () => {
  for (const [date, id] of [
    ['2026-09-12', 'rh:5787'],
    ['2026-09-21', 'yk:5787'], ['2026-09-26', 'sukkos:5787'],
    ['2027-04-22', 'pesach:5787']
  ]) {
    const sheet = scheduleSnapshot(atLocal(date + 'T12:00')).specialSheet;
    assert.equal(sheet?.sourceId, id, date);
    assert.ok(sheet.sections.length, date);
  }
  assert.equal(scheduleSnapshot(atLocal('2027-06-11T12:00')).specialSheet, null);
});

test('every original holiday page closes after its final holy-day events for the next twenty years', () => {
  const sources = [
    { key:'rh', build:buildRoshHashanaPoster, month:7, last:2 },
    { key:'yk', build:buildYomKippurPoster, month:7, last:10 },
    { key:'sukkos', build:buildSukkosPoster, month:7, last:23 },
    { key:'pesach', build:buildPesachPoster, month:1, last:22 },
  ];
  let attachedShabbosCases = 0;
  for (let year = 5787; year < 5807; year++) {
    for (const { key, build, month, last } of sources) {
      const id = key + ':' + year;
      const poster = build(year, settings);
      let lastDay = dateFromHebrew(last, month, year);
      // Sukkos also prints the Shabbos immediately after a Friday Simchas Torah.
      if (lastDay < poster.span.to && excelWeekday(lastDay + 1) === 7) {
        lastDay++;
        attachedShabbosCases++;
      }
      const finalDay = snapshotOn(lastDay);
      const sheet = finalDay.specialSheet;
      assert.equal(sheet?.sourceId, id, id + ' must remain on its final holy day');
      assert.equal(sheet.placement, 'both', id);
      assert.equal(sheet.displayThrough, civil(lastDay), id);
      const closing = Math.max(Date.parse(sunset(civil(lastDay))) + 72 * 60000,
        ...finalDay.today.events.map(e => Date.parse(e.at)));
      const end = new Date(closing + 5 * 60000).toISOString();
      assert.equal(sheet.endsAt, end, id + ' includes the last closing minyan and five-minute retention');
      const retained = scheduleSnapshot(before(end));
      const resumed = scheduleSnapshot(end);
      assert.equal(retained.specialSheet?.sourceId, id, id);
      assert.equal(retained.nextChangeAt, end, id + ' exposes the precise expiry boundary');
      assert.notEqual(resumed.specialSheet?.sourceId, id, id + ' expires exactly at its closing boundary');
      assert.deepEqual(resumed.today.events, retained.today.events, id + ' expiry cannot change daily events');
      assert.deepEqual(resumed.next, retained.next, id + ' expiry cannot change the next minyan');
      for (let offset = 1; offset <= 7; offset++) {
        const after = snapshotOn(lastDay + offset);
        assert.notEqual(after.specialSheet?.sourceId, id, id + ' cannot return during the following week');
        assert.ok(after.today.events.length, id + ' following daily schedule remains available');
      }
    }
  }
  assert.ok(attachedShabbosCases > 0, 'The range must exercise a printed Shabbos after Simchas Torah');
});

test('Gedalya stays in the weekday schedule and never automatically takes over a full chart for twenty years', () => {
  let postponedCases = 0;
  for (let year = 5787; year < 5807; year++) {
    const poster = buildTzomGedaliaPoster(year, settings);
    const fastDay = poster.span.from;
    if (fastDay !== dateFromHebrew(3, 7, year)) postponedCases++;
    for (const time of ['00:00', '07:00', '12:00', '17:00', '23:00']) {
      const snapshot = snapshotOn(fastDay, time);
      assert.notEqual(snapshot.specialSheet?.sourceId, 'gedalia:' + year, year + ' ' + time);
      assert.notEqual(snapshot.specialSheet?.placement, 'both', year + ' ' + time + ' must leave the weekday panel visible');
      for (const event of poster.minyanim) {
        assert.ok(snapshot.today.events.some(actual => sameMinyan(actual, event)), year + ' ' + event.name + ' ' + event.mins);
      }
      const instant = atLocal(civil(fastDay) + 'T' + time);
      const upcoming = snapshot.today.events.find(e => !e.auxiliary && e.at >= instant);
      if (upcoming) assert.deepEqual(snapshot.next, upcoming, year + ' ' + time);
    }
    const grouped = groupWeekdayPresentation(snapshotOn(fastDay).presentation.weekly.services);
    const fast = grouped.daySections.find(section => section.days.some(day => day.date === civil(fastDay)));
    assert.ok(fast, year + ' fast details remain in the weekday panel');
    assert.deepEqual(fast.services.map(service => [service.name, service.events.length]), [['סליחות',5],['מנחה',5],['מעריב',2]], String(year));
  }
  assert.ok(postponedCases > 0, 'The range must include a postponed Sunday fast');
});

test('publication controls retain precedence and return their next visibility boundary', () => {
  const control = validate({
    kind: 'schedule', status: 'published', title: 'DEVELOPMENT TEST: explicit special override',
    startLocal: '2026-09-24T13:00', endLocal: '2026-09-24T14:00',
    data: { source: 'sukkos:5787', appliesFrom: '2026-09-26', appliesTo: '2026-09-26', portion: 'morning', precedence: 90 }
  });
  const beforeControl = scheduleSnapshot(atLocal('2026-09-24T12:00'), [control]);
  assert.equal(beforeControl.specialSheet.sourceId, 'sukkos:5787');
  assert.equal(beforeControl.nextChangeAt, control.startsAt);
  assert.equal(scheduleSnapshot(control.startsAt, [control]).specialSheet, null);
  assert.equal(scheduleSnapshot(control.endsAt, [control]).specialSheet.sourceId, 'sukkos:5787');
  for (const status of ['draft', 'hidden', 'archived']) {
    assert.equal(scheduleSnapshot(control.startsAt, [{...control, status}]).specialSheet.sourceId, 'sukkos:5787');
  }
});

test('changing sheet placement does not change actual next-minyan source events', () => {
  const sheet = scheduleSnapshot(atLocal('2026-09-24T12:00')).specialSheet;
  const left = scheduleSnapshot(before(sheet.coversBothAt));
  const right = scheduleSnapshot(sheet.coversBothAt);
  assert.equal(left.specialSheet.placement, 'shabbos');
  assert.equal(right.specialSheet.placement, 'both');
  assert.deepEqual(left.today.events, right.today.events);
  assert.deepEqual(left.next, right.next);
});

test('the two-stage Sukkos transition follows the source calendar for the next twenty years', () => {
  for (let year = 5787; year < 5807; year++) {
    const poster = buildSukkosPoster(year, settings);
    const firstDay = dateFromSerial(poster.span.from + 1).toISOString().slice(0, 10);
    const sheet = scheduleSnapshot(atLocal(firstDay + 'T12:00')).specialSheet;
    assert.equal(sheet?.sourceId, 'sukkos:' + year, firstDay);
    assert.equal(sheet.placement, 'both', firstDay);
    assert.ok(sheet.previewStartsAt < sheet.coversBothAt, firstDay);
    assert.equal(scheduleSnapshot(before(sheet.coversBothAt)).specialSheet?.placement, 'shabbos', firstDay);
    assert.equal(scheduleSnapshot(sheet.coversBothAt).specialSheet?.placement, 'both', firstDay);
    const eve = scheduleSnapshot(sheet.coversBothAt).today;
    const morning = eve.events.filter(e => e.name === 'שחרית');
    assert.ok(morning.length, firstDay);
    assert.equal(Date.parse(sheet.coversBothAt), Math.max(...morning.map(e => Date.parse(e.at))) + 5 * 60000, firstDay);
  }
});
