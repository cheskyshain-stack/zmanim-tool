import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot, sunset, settings } from '../src/schedules.js';
import { validate } from '../src/model.js';
import { localToISO, localStamp } from '../public/display-assets/time.js';
import { buildSukkosPoster } from '../../js/posters/sukkos.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';

const before = at => new Date(Date.parse(at) - 1).toISOString();
const atLocal = localToISO;

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

test('the original Sukkos page retains all its dated source span and then resumes ordinary schedules', () => {
  const sheet = scheduleSnapshot(atLocal('2026-09-26T12:00')).specialSheet;
  const poster = buildSukkosPoster(5787, settings);
  assert.equal(sheet.to, dateFromSerial(poster.span.to).toISOString().slice(0, 10));
  assert.equal(scheduleSnapshot(before(sheet.endsAt)).specialSheet.sourceId, sheet.sourceId);
  assert.equal(scheduleSnapshot(sheet.endsAt).specialSheet, null);
});

test('each supported original source uses its own page without inventing Shavuos times', () => {
  for (const [date, id] of [
    ['2026-09-12', 'rh:5787'], ['2026-09-14', 'gedalia:5787'],
    ['2026-09-21', 'yk:5787'], ['2026-09-26', 'sukkos:5787'],
    ['2027-04-22', 'pesach:5787']
  ]) {
    const sheet = scheduleSnapshot(atLocal(date + 'T12:00')).specialSheet;
    assert.equal(sheet?.sourceId, id, date);
    assert.ok(sheet.sections.length, date);
  }
  assert.equal(scheduleSnapshot(atLocal('2027-06-11T12:00')).specialSheet, null);
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
