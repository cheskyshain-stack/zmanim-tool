import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarAnnouncementText, calendarAnnouncementView } from '../js/calendar/announcement-model.js';

test('announcements preserve plain text, Hebrew and message line breaks', () => {
  assert.equal(calendarAnnouncementText('  Update\r\nמזל טוב\r<img src=x>  '), 'Update\nמזל טוב\n<img src=x>');
  assert.equal(calendarAnnouncementText('x'.repeat(4000)).length, 4000);
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
