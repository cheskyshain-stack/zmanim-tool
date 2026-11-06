import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarAnnouncementText } from '../js/calendar/announcement-model.js';

test('announcements preserve plain text, Hebrew and message line breaks', () => {
  assert.equal(calendarAnnouncementText('  Update\r\nמזל טוב\r<img src=x>  '), 'Update\nמזל טוב\n<img src=x>');
  assert.equal(calendarAnnouncementText('x'.repeat(4000)).length, 4000);
});
test('empty, oversized and non-text announcements cannot be posted', () => {
  for (const value of ['', ' \n ', null, 7, {}, ['message'], 'x'.repeat(4001)]) assert.throws(() => calendarAnnouncementText(value));
});
