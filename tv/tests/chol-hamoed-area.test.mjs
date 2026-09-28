import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot } from '../src/schedules.js';
import { localToISO } from '../public/display-assets/time.js';
import { boardSchedules, usesCholHamoedAnnouncementArea } from '../public/display-assets/board-schedules.js';
import { groupAnnouncements, groupCholHamoedAnnouncements } from '../public/display-assets/announcements.js';

const snapshot = local => scheduleSnapshot(localToISO(local));
const reserved = value => usesCholHamoedAnnouncementArea(value.presentation, value.specialSheet);

test('the real Sukkos reference reserves the center only after the regular weekdays finish', () => {
  const cases = [
    ['2026-09-22T12:00', false],
    ['2026-09-25T08:00', false],
    ['2026-09-25T13:00', true],
    ['2026-09-28T12:00', true],
    ['2026-10-02T08:00', true],
    ['2026-10-02T12:00', false],
    ['2026-10-05T12:00', false],
  ];
  for (const [local, expected] of cases) assert.equal(reserved(snapshot(local)), expected, local);
  const nextWeek = snapshot('2026-10-02T12:00');
  assert.ok(nextWeek.specialSheet, 'the original sheet still appears while the next weekday reference returns');
  assert.equal(nextWeek.presentation.weekly.title, 'חול פרשת בראשית');
  assert.equal(snapshot('2026-10-05T12:00').specialSheet, null);
});

test('Pesach reserves the CHM area while preserving the underlying future Friday and live minyan data', () => {
  for (const local of ['2027-04-21T02:09', '2027-04-25T12:00']) {
    const value = snapshot(local);
    const original = structuredClone(value);
    assert.equal(reserved(value), true, local);
    assert.ok(value.presentation.weekly.services.some(service => service.groups.some(group =>
      group.events.length && group.days.some(day => day.date === '2027-04-30'))),
    'the future Friday reference is retained in the schedule data while its panel is reserved');
    const html = boardSchedules(value.presentation, '', { reserveCholHamoed: true });
    assert.match(html, /class="board-chol-hamoed-announcements"[^>]*><\/section>/);
    assert.doesNotMatch(html, /class="board-weekly"/);
    assert.deepEqual(value, original, 'presentation does not change real daily schedules or next-minyan data');
  }
  const after = snapshot('2027-04-30T08:00');
  assert.equal(after.specialSheet, null);
  assert.equal(reserved(after), false);
  assert.match(boardSchedules(after.presentation), /class="board-weekly"/);
});

test('missing, mismatched, or incomplete charts keep the weekly Chol Hamoed schedule visible', () => {
  const value = snapshot('2026-09-28T12:00');
  const { presentation, specialSheet: sheet } = value;
  const variants = [
    ['missing chart', null],
    ['preview-only placement', { ...sheet, placement: 'shabbos' }],
    ['wrong holiday', { ...sheet, sourceId: 'pesach:5787' }],
    ['wrong Hebrew year', { ...sheet, sourceId: 'sukkos:5788' }],
    ['empty chart', { ...sheet, sections: [] }],
    ['missing CHM section', { ...sheet, sections: sheet.sections.filter(section => section.title !== 'חול המועד') }],
    ['missing Hoshana Rabba section', { ...sheet, sections: sheet.sections.filter(section => section.title !== 'הושענא רבה') }],
    ['empty CHM section', { ...sheet, sections: sheet.sections.map(section => section.title === 'חול המועד' ? { ...section, rows: [] } : section) }],
    ['chart ends before covered Hoshana date', { ...sheet, displayThrough: '2026-10-01' }],
  ];
  for (const [label, source] of variants) assert.equal(usesCholHamoedAnnouncementArea(presentation, source), false, label);
  assert.match(boardSchedules(presentation), /data-poster-dates="2026-09-28,2026-09-29,2026-09-30,2026-10-01,2026-10-02"/);
});

test('an ordinary week never turns into a holiday announcement area', () => {
  const ordinary = snapshot('2026-11-03T13:00');
  assert.equal(reserved(ordinary), false);
  assert.equal(usesCholHamoedAnnouncementArea(ordinary.presentation, snapshot('2026-09-28T12:00').specialSheet), false);
});

// Development-only placement fixtures: these are never saved or published.
const notices = [
  { id: 'development-bottom', kind: 'announcement', title: 'Regular bottom notice', data: { message: 'Keep this in the bottom band.', displayGroup: 'community' } },
  { id: 'development-chm-one', kind: 'announcement', title: 'שמחת בית השואבה', data: { placement: 'chol-hamoed', displayGroup: 'community', message: 'The full first announcement.\nIts second line remains visible.', contact: 'First contact', phone: '732-555-0101', priority: 'important' } },
  { id: 'development-chm-two', kind: 'announcement', title: 'Second holiday announcement', data: { placement: 'chol-hamoed', message: 'Every detail in the second announcement remains.', contact: 'Second contact', phone: '732-555-0102', priority: 'normal' } },
  { id: 'development-dedication', kind: 'dedication', title: 'פרנס היום', data: { placement: 'chol-hamoed', message: 'This is not an announcement.' } },
];

test('explicit holiday notices stay out of the bottom band and retain all saved content in their own area', () => {
  const original = structuredClone(notices);
  const bottom = groupAnnouncements(notices);
  assert.deepEqual(bottom.flatMap(group => group.sourceIds), ['development-bottom']);
  const holiday = groupCholHamoedAnnouncements(notices);
  assert.equal(holiday.length, 1);
  assert.equal(holiday[0].id, 'chol-hamoed');
  assert.deepEqual(new Set(holiday[0].sourceIds), new Set(['development-chm-one', 'development-chm-two']));
  for (const notice of notices.filter(item => item.kind === 'announcement' && item.data.placement === 'chol-hamoed')) {
    const section = holiday[0].sections.find(section => section.sourceId === notice.id);
    assert.ok(section, notice.id);
    assert.equal(section.title, notice.title);
    for (const field of ['message', 'contact', 'phone', 'priority']) assert.equal(section[field], notice.data[field], `${notice.id}: ${field}`);
  }
  assert.deepEqual(notices, original, 'grouping never changes source records or their placements');
  assert.deepEqual(groupCholHamoedAnnouncements(notices.filter(item => item.data.placement !== 'chol-hamoed')), [], 'no holiday notices means no fallback card');
  assert.deepEqual(groupCholHamoedAnnouncements([]), []);
});
