import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAnnouncements, renderAnnouncementGroup } from '../public/display-assets/announcements.js';

// Read-only public-content fixture captured on 2026-09-24. These records are
// never inserted into the database or published by the tests.
const liveNotices = [
  ['hall-booking', 'Lakewood Commons Simcha Hall', 'For bookings, please text or call the Hauers.', 'The Hauers', '732-674-2425'],
  ['hall-bar-mitzvah', 'Bar Mitzvah hall bookings', 'You may reserve the hall a year in advance. Two families making a Bar Mitzvah Kiddush on the same Shabbos must make a joint Kiddush, unless the second family reserved less than eight months (32 weeks) before their Bar Mitzvah. Non-members may book six months before their simcha.'],
  ['hall-bris', 'Bris hall bookings', 'Please call right away. Non-members may book six days in advance.', 'The Hauers', '732-674-2425'],
  ['yom-tov-appeal', 'Please help your neighbors', 'Donations for צרכי יום טוב are urgently needed. Give through the pushka next to the coffee, the kiosk in the lobby under צרכי יום טוב, or one of the Vaad members. Thank you. תזכו למצוות'],
  ['text-messages', 'Shul text messages', '$10 per number to receive the shul texts for the year. Pay one of the Vaad members or through the kiosk in the lobby. Please include your name and number.'],
  ['coffee-sponsors', 'Coffee room sponsorships', 'Additional sponsorships are available for the coffee room expenses. Please speak to one of the Vaad members.'],
  ['belongings', 'Please take home all belongings', 'Any items left in the building more than 30 days will become property of the בית מדרש.'],
  ['rav-appointments', 'Rav’s appointments', 'Short appointments: Tuesday nights, 9:00–10:30 PM. Please call R’ Pinchos Englander at 848-226-7186'],
  ['rav-messages', 'Contact the Rav', 'To leave a message for the Rav שליט״א, please call 732-806-1369. For urgent matters or longer appointments, please call the Rebbitzen at 848-300-3565.'],
  ['simcha-gemach', 'Lakewood Commons Simcha Gemach', 'For simcha and non-routine expenses. Please call Chananya Miller. 347-404-3494'],
].map(([id, title, message, contact = '', phone = '']) => ({
  id: `uploaded-poster-${id}`, kind: 'announcement', title,
  data: { message, contact, phone, category: 'Community', priority: 'normal', behavior: 'rotating', duration: 35 },
}));

test('all ten current public notices fit four stable groups with every saved field intact', () => {
  const original = structuredClone(liveNotices);
  const groups = groupAnnouncements(liveNotices);
  assert.deepEqual(groups.map(group => [group.id, group.sections.length]), [['hall', 3], ['rav', 2], ['community', 2], ['support', 3]]);
  const sections = groups.flatMap(group => group.sections);
  assert.equal(sections.length, liveNotices.length);
  for (const notice of liveNotices) {
    const section = sections.find(section => section.sourceId === notice.id);
    assert.ok(section, notice.id);
    for (const field of ['message', 'contact', 'phone', 'category', 'priority']) assert.equal(section[field], notice.data[field], `${notice.id}: ${field}`);
    assert.equal(section.title, notice.title);
  }
  assert.deepEqual(liveNotices, original, 'the saved records are never merged or modified');
  assert.deepEqual(groupAnnouncements([...liveNotices].reverse()), groups, 'refresh order cannot reshuffle grouped content');
  for (const group of groups) {
    assert.equal(group.charCount, group.sections.reduce((total, section) => total + [section.title, section.message, section.contact, section.phone].join('').length, 0));
    assert.equal(group.sourceIds.length, group.sections.length);
  }
});

test('admin-selected groups override uploaded IDs and unknown automatic records remain independent Community sections', () => {
  const moved = structuredClone(liveNotices[0]);
  moved.data.displayGroup = 'rav';
  assert.equal(groupAnnouncements([moved])[0].id, 'rav');
  for (const displayGroup of ['automatic', undefined, 'not-an-allowed-group']) {
    const groups = groupAnnouncements([{ id: 'new-unknown', kind: 'announcement', title: 'Rav and Simcha Hall', data: { message: 'Do not guess a group from my words.', displayGroup } }]);
    assert.equal(groups[0].id, 'community');
    assert.equal(groups[0].sections[0].sourceId, 'new-unknown');
  }
  const separate = { ...moved, data: { ...moved.data, displayGroup: 'separate' } };
  const groups = groupAnnouncements([separate, liveNotices[1]]);
  assert.equal(groups.length, 2);
  assert.ok(groups.some(group => group.id === 'announcement:uploaded-poster-hall-booking' && group.sections.length === 1));
});

test('full messages never acquire pages, ellipses or a truncation limit', () => {
  const message = 'Long development notice — שחרית 7:30.\n'.repeat(50);
  const item = { id: 'long-notice', kind: 'announcement', title: 'Long development notice', data: { message, displayGroup: 'separate' } };
  const group = groupAnnouncements([item])[0];
  assert.equal(group.sections[0].message, message);
  assert.equal(group.slotSpan, 4);
  assert.equal(Object.hasOwn(group.sections[0], 'pageMessage'), false);
  assert.ok(renderAnnouncementGroup(group).includes(message));
});

test('priority orders groups without removing any notice and empty or dedication-only input makes no cards', () => {
  const items = structuredClone(liveNotices);
  items.find(item => item.id.endsWith('text-messages')).data.priority = 'urgent';
  const groups = groupAnnouncements(items);
  assert.equal(groups[0].id, 'support');
  assert.equal(groups[0].priority, 'urgent');
  assert.equal(groups.flatMap(group => group.sections).length, 10);
  assert.deepEqual(groupAnnouncements([]), []);
  assert.deepEqual(groupAnnouncements([{ id: 'private-dedication', kind: 'dedication', title: 'Not an announcement', data: {} }]), []);
});

test('rendering escapes all fields, keeps source edit IDs, and isolates phone direction', () => {
  const item = {
    id: 'unsafe"><script>', kind: 'announcement', title: '<img src=x onerror=alert(1)>',
    internalName: 'PRIVATE INTERNAL NOTE',
    data: { message: 'First line\nSecond line <script>alert(1)</script>', contact: 'איש קשר & Family', phone: '+1 (732) 555-0000', displayGroup: 'separate' },
  };
  const group = groupAnnouncements([item])[0], html = renderAnnouncementGroup(group);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('PRIVATE INTERNAL NOTE'));
  assert.ok(html.includes('data-source-id="unsafe&quot;&gt;&lt;script&gt;"'));
  assert.ok(html.includes('First line\nSecond line &lt;script&gt;'));
  assert.ok(html.includes('<bdi dir="auto">איש קשר &amp; Family</bdi>'));
  assert.ok(html.includes('<bdi dir="ltr">+1 (732) 555-0000</bdi>'));
});
