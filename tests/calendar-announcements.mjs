import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarAnnouncementText, calendarAnnouncementView, calendarAnnouncementDate, calendarAnnouncementOrder, calendarAnnouncementAddedAt, calendarAnnouncementLocalTime, calendarAnnouncementInstant } from '../js/calendar/announcement-model.js';

test('announcements preserve plain text, Hebrew and message line breaks', () => {
  assert.equal(calendarAnnouncementText('  Update\r\nמזל טוב\r<img src=x>  '), 'Update\nמזל טוב\n<img src=x>');
  assert.equal(calendarAnnouncementText('x'.repeat(4000)).length, 4000);
});
test('added dates preserve source timestamps and order by date with stable sequence ties', () => {
  const original = { createdAt:'2026-01-03T12:00:00.000Z', sequence:1 };
  const changed = { ...original, addedAt:'2026-01-01T12:00:00.000Z' };
  assert.equal(calendarAnnouncementDate(original), original.createdAt);
  assert.equal(calendarAnnouncementDate(changed), changed.addedAt);
  assert.equal(changed.createdAt, original.createdAt);
  assert.deepEqual([changed, original, { ...original, sequence:2 }].sort(calendarAnnouncementOrder).map(value => value.sequence), [2,1,1]);
  for (const value of [null, '', '2026-02-30T12:00:00.000Z', '2026-01-01', '2099-01-01T12:00:00.000Z']) assert.throws(() => calendarAnnouncementAddedAt(value));
});
test('date editing uses the shul timezone and rejects missing or repeated daylight-saving hours', () => {
  const zone = 'America/New_York';
  assert.equal(calendarAnnouncementLocalTime('2026-01-02T02:35:42.123Z', zone), '2026-01-01T21:35');
  assert.equal(calendarAnnouncementInstant('2026-01-01T21:35', zone), '2026-01-02T02:35:00.000Z');
  assert.equal(calendarAnnouncementInstant('2026-01-01T21:35', zone, '2026-01-02T02:35:42.123Z'), '2026-01-02T02:35:42.123Z');
  assert.throws(() => calendarAnnouncementInstant('2026-03-08T02:30', zone), /does not exist/);
  assert.throws(() => calendarAnnouncementInstant('2025-11-02T01:30', zone), /occurs twice/);
});
test('empty, oversized and non-text announcements cannot be posted', () => {
  for (const value of ['', ' \n ', null, 7, {}, ['message'], 'x'.repeat(4001)]) assert.throws(() => calendarAnnouncementText(value));
});
test('legacy announcements display Shul without rewriting original stored identity or dates', () => {
  const old = { id: 'old-post', text: 'A saved update', authorId: 'original-account', authorName: 'Original organiser', createdAt: '2026-10-01T12:00:00Z', sequence: 8 };
  const view = calendarAnnouncementView(old);
  assert.equal(view.authorName, 'Shul'); assert.equal(view.revision, 1); assert.equal(view.authorId, old.authorId);
  assert.equal(view.createdAt, old.createdAt); assert.equal(view.sequence, 8); assert.equal(old.authorName, 'Original organiser');
  assert(!('lastEditId' in calendarAnnouncementView({ ...old, lastEditId: 'private-retry-id', revision: 3 })));
});
