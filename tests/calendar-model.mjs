import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { CALENDAR_TYPES, CALENDAR_LEGACY_TYPES, calendarEventCategory, calendarEventDetails, calendarCongregationDetails, calendarAdminDetails, calendarDetailsFields, calendarEventTime, calendarClock, calendarMonth, calendarSerial, calendarISO, calendarStepMonth, calendarReaderMonths, calendarEvent, calendarEventsOn } from '../js/calendar/model.js';
import { calendarReadPreview, calendarWritePreview, CALENDAR_STORAGE_KEY } from '../js/calendar/storage.js';
import { calendarSessionExpiration } from '../worker/calendar/session-expiration.js';
import { calendarReminderDate } from '../js/calendar/reminder-date.js';

const read = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const [published, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(['published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days'].map(read));
const settings = resolveSettings(published.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const event = fields => calendarEvent({ title: 'Synthetic Kiddush', type: 'kiddush', date: '2026-11-07', ...fields });

test('new sessions expire at the first New York 3 a.m. after a full week', () => {
  for (const [signedIn, expires] of [
    ['2026-11-09T07:59:59.999Z', '2026-11-16T08:00:00.000Z'],
    ['2026-11-09T08:00:00.000Z', '2026-11-16T08:00:00.000Z'],
    ['2026-11-09T08:00:00.001Z', '2026-11-17T08:00:00.000Z'],
    ['2026-03-01T06:30:00.000Z', '2026-03-08T07:00:00.000Z'],
    ['2026-10-25T06:30:00.000Z', '2026-11-01T08:00:00.000Z'],
  ]) {
    assert.equal(new Date(calendarSessionExpiration(Date.parse(signedIn))).toISOString(), expires, signedIn);
  }
});

test('simcha reminders can be the morning of or before, with Shabbos always on Friday', () => {
  assert.equal(calendarReminderDate('2026-11-12', 'day-of'), '2026-11-12');
  assert.equal(calendarReminderDate('2026-11-12', 'day-before'), '2026-11-11');
  assert.equal(calendarReminderDate('2026-11-14', 'day-of'), '2026-11-13');
  assert.equal(calendarReminderDate('2026-11-14', 'day-before'), '2026-11-13');
  assert.equal(calendarReminderDate('2027-01-01', 'day-before'), '2026-12-31');
  assert.equal(calendarReminderDate('2026-11-14', ''), '');
  assert.equal(event({ reminder: 'day-before' }).reminder, 'day-before');
  assert.throws(() => event({ reminder: 'late-night' }), /Choose a valid phone reminder/);
});

test('calendar offers the requested categories and preserves older event types', () => {
  assert.deepEqual(CALENDAR_TYPES.map(type => type.label), ['Shalom Zachor', 'Kiddush', 'Vort', 'Aufruf', 'Chasuna', 'Bar mitzva shabbos', 'Bar mitzva dessert', 'Custom']);
  for (const type of [...CALENDAR_TYPES, ...CALENDAR_LEGACY_TYPES]) assert.equal(event({ type: type.id, customCategory: 'Community learning' }).type, type.id);
  assert.equal(calendarEventCategory(event({ type: 'wedding' })).label, 'Chasuna');
  assert.equal(calendarEventCategory(event({ type: 'bar-mitzvah' })).label, 'Bar mitzvah');
});
test('custom category names persist as plain text and are required only for Custom', () => {
  const customCategory = 'Community learning שיעור <img src=x>';
  const custom = event({ type: 'custom', customCategory: '  ' + customCategory + '  ' });
  assert.equal(custom.customCategory, customCategory); assert.equal(calendarEventCategory(custom).label, customCategory);
  assert.deepEqual(calendarEvent(JSON.parse(JSON.stringify(custom))), custom);
  for (const value of ['', '   ', undefined, 5, {}, 'x'.repeat(61)]) assert.throws(() => event({ type: 'custom', customCategory: value }));
  assert.equal(event({ type: 'custom', customCategory: 'x'.repeat(60) }).customCategory.length, 60);
  assert.equal(event({ type: 'kiddush', customCategory: 'Old draft' }).customCategory, '');
});

test('monthly grids cover consecutive complete Sunday to Shabbos weeks across 51 years', () => {
  for (let year = 2000; year <= 2050; year++) for (let index = 1; index <= 12; index++) {
    const month = year + '-' + String(index).padStart(2, '0'), result = calendarMonth(month, settings, tables);
    assert.equal(new Date(result.days[0].iso + 'T12:00:00Z').getUTCDay(), 0);
    assert.equal(new Date(result.days.at(-1).iso + 'T12:00:00Z').getUTCDay(), 6);
    assert.equal(result.days.length % 7, 0);
    const inside = result.days.filter(day => day.inMonth);
    assert.equal(inside.length, new Date(Date.UTC(year, index, 0)).getUTCDate());
    assert.equal(inside[0].iso, month + '-01'); assert.equal(inside.at(-1).iso, result.last);
    result.days.forEach((day, offset) => {
      assert.equal(day.serial, result.days[0].serial + offset);
      assert.equal(day.iso, calendarISO(day.serial));
      assert(day.hebrewLabel && day.hebrewDay);
      if (day.parsha) assert(day.shabbos, 'Parshas appear on Shabbos only');
    });
  }
  assert.equal(calendarMonth('2100-02', settings, tables).days.filter(day => day.inMonth).length, 28);
});

test('Hebrew dates, Jewish holidays, leap Adars and known parshas appear on their dates', () => {
  const september = calendarMonth('2026-09', settings, tables);
  const rh = september.days.find(day => day.iso === '2026-09-12');
  assert.deepEqual([rh.hebrew.dayOfMonth, rh.hebrew.month, rh.hebrew.year], [1, 7, 5787]);
  assert(rh.facts.some(value => /ראש השנה/.test(value))); assert.equal(rh.parsha, '');
  assert(september.days.find(day => day.iso === '2026-09-21').facts.some(value => /כפור|כיפור/.test(value)));
  const november = calendarMonth('2026-11', settings, tables);
  assert.equal(november.days.find(day => day.iso === '2026-11-07').parsha, 'חיי שרה');
  for (const date of ['2026-11-10', '2026-11-11']) assert(november.days.find(day => day.iso === date).facts.includes('ר״ח כסלו'));
  assert(calendarMonth('2024-02', settings, tables).hebrewRange.includes('אדר א׳'));
  assert(calendarMonth('2024-03', settings, tables).hebrewRange.includes('אדר ב׳'));
  const december = calendarMonth('2026-12', settings, tables);
  assert(december.days.find(day => day.iso === '2026-12-05').facts.some(value => /חנוכה/.test(value)));
});

test('Hebrew wording matches the April 2028 and December 2027 reference calendars', () => {
  const day = date => calendarMonth(date.slice(0, 7), settings, tables).days.find(item => item.iso === date);
  assert.equal(calendarMonth('2028-04', settings, tables).hebrewRange, 'ניסן - אייר תשפ״ח');
  assert.equal(day('2028-04-01').hebrewDay, 'ה');
  assert.equal(day('2028-04-08').specialLabel, 'שבת הגדול');
  assert.deepEqual(day('2028-04-10').facts, ['ערב פסח', 'ת׳ בכורים']);
  assert(day('2028-04-11').facts.includes('א׳ פסח'));
  assert(day('2028-04-12').facts.includes('ב׳ פסח'));
  assert(day('2028-04-13').facts.includes('חול המועד'));
  assert(day('2028-04-16').facts.includes('ערב ז׳ פסח'));
  assert(day('2028-04-17').facts.includes('ז׳ פסח'));
  assert.deepEqual(day('2028-04-18').facts, ['ח׳ פסח', 'יזכור']);
  assert(day('2028-04-22').mevarchim);
  assert(day('2028-04-26').facts.includes('ר״ח אייר'));
  assert(day('2028-04-27').facts.includes('ר״ח אייר'));
  assert(day('2028-05-01').facts.includes('בה״ב'));
  assert(day('2027-12-06').facts.includes('טל ומטר'));
  assert(day('2027-12-24').facts.includes('ערב חנוכה'));
  assert(day('2027-12-25').facts.includes('א׳ חנוכה'));
  assert.equal(day('2027-12-25').parsha, 'וישב'); assert(day('2027-12-25').mevarchim);
  assert.deepEqual(day('2027-12-30').facts, ['ו׳ חנוכה', 'ר״ח טבת']);
  assert.deepEqual(day('2027-12-31').facts, ['ז׳ חנוכה', 'ר״ח טבת']);
  assert.deepEqual(day('2028-01-01').facts, ['ח׳ חנוכה']);
  const english = calendarMonth('2028-04', { ...settings, english: true }, tables);
  assert.equal(english.days.find(item => item.iso === '2028-04-01').parsha, 'ויקרא');
  for (const date of english.days) assert(!/[a-z]/i.test(date.facts.join(' ') + date.specialLabel + date.parsha));
});

test('firstborn fast shifts from Shabbos and rain-prayer labels follow the first recitation day', () => {
  const date = iso => calendarMonth(iso.slice(0, 7), settings, tables).days.find(day => day.iso === iso);
  assert(date('2025-04-10').facts.includes('ת׳ בכורים'));
  assert(!date('2025-04-12').facts.includes('ת׳ בכורים'));
  assert(!date('2026-12-05').facts.includes('טל ומטר'));
  assert(date('2026-12-06').facts.includes('טל ומטר'));
  assert(date('2028-12-05').facts.includes('טל ומטר'));
  assert(date('2103-12-07').facts.includes('טל ומטר'));
  const israel = calendarMonth('2026-10', { ...settings, inIsrael: true }, tables);
  assert(israel.days.find(day => day.hebrew.month === 8 && day.hebrew.dayOfMonth === 7).facts.includes('טל ומטר'));
});

test('month stepping and date parsing retain calendar dates without local timezone shifts', () => {
  assert.equal(calendarStepMonth('2026-12', 1), '2027-01');
  assert.equal(calendarStepMonth('2026-01', -1), '2025-12');
  for (const date of ['2026-03-08', '2026-11-01', '2024-02-29']) assert.equal(calendarISO(calendarSerial(date)), date);
  for (const value of ['2026-02-30', '2026-13-01', '2026-04-31', '2026-1-01', 'not a date']) assert(Number.isNaN(calendarSerial(value)));
});

test('event validation rejects impossible dates and times and allowlists fields', () => {
  assert.throws(() => event({ date: '2026-02-30' }), /valid date/);
  assert.throws(() => event({ endDate: '2026-11-06' }), /end date/);
  assert.throws(() => event({ allDay: false, time: '25:00' }), /start time/);
  assert.throws(() => event({ allDay: false, time: '18:00', endTime: '17:00' }), /end time/);
  assert.throws(() => event({ type: 'admin', createdBy: 'owner' }), /event category/);
  assert.throws(() => event({ title: '' }), /title/);
  assert.throws(() => event({ title: 'x'.repeat(161) }), /too long/);
  const value = event({ title: '<img src=x onerror=alert(1)>', description: 'מזל טוב\nA second line', createdBy: 'owner', revision: 2 });
  assert(!('createdBy' in value)); assert(value.title.startsWith('<img')); assert(value.description.includes('\n'));
});

test('multi-day events are inclusive and daily lists put all-day entries before timed entries', () => {
  const list = [event({ allDay: false, time: '19:00', title: 'Evening' }), event({ title: 'All day' }), event({ allDay: false, time: '08:30', title: 'Morning' }), event({ date: '2026-11-06', endDate: '2026-11-08', title: 'Three days' })];
  assert.deepEqual(calendarEventsOn(list, '2026-11-07').map(value => value.title), ['All day', 'Three days', 'Morning', 'Evening']);
  assert.equal(calendarEventsOn(list, '2026-11-08').length, 1); assert.equal(calendarEventsOn(list, '2026-11-09').length, 0);
});

test('daily events group matching categories, named custom groups and times without changing saved order', () => {
  const list = [event({ type:'kiddush', title:'Late Kiddush', allDay:false, time:'13:00' }), event({ type:'custom', customCategory:'Learning', title:'Learning later', allDay:false, endTime:'21:00' }), event({ type:'shalom-zachor', title:'Shalom Zachor' }), event({ type:'kiddush', title:'Early Kiddush', allDay:false, time:'11:00' }), event({ type:'custom', customCategory:'Community', title:'Community event' }), event({ type:'kiddush', title:'Untimed Kiddush' }), event({ type:'custom', customCategory:'Learning', title:'Learning first', allDay:false, time:'19:00' })];
  const original = JSON.stringify(list);
  assert.deepEqual(calendarEventsOn(list, '2026-11-07').map(value => value.title), ['Shalom Zachor','Untimed Kiddush','Early Kiddush','Late Kiddush','Community event','Learning first','Learning later']);
  assert.equal(JSON.stringify(list), original);
});

test('event times are independently optional and blank times have no label', () => {
  const untimed = event({ allDay: false, time: '', endTime: '' });
  assert.equal(untimed.allDay, true); assert.equal(calendarEventTime(untimed), ''); assert.equal(calendarClock(''), '');
  assert.equal(calendarEventTime(event({ time: '19:00' })), '7:00 PM');
  const endOnly = event({ allDay: false, endTime: '21:00' });
  assert.equal(endOnly.time, ''); assert.equal(endOnly.allDay, false); assert.equal(calendarEventTime(endOnly), 'Until 9:00 PM');
  assert.equal(calendarEventTime(event({ time: '19:00', endTime: '21:00' })), '7:00 PM - 9:00 PM');
  assert.throws(() => event({ endTime: '25:00' }), /valid end time/);
  assert.throws(() => event({ time: '19:00', endTime: '19:00' }), /follow/);
  const legacy = event({ allDay: true, time: '19:00', endTime: '21:00' });
  assert.equal(legacy.time, ''); assert.equal(legacy.endTime, ''); assert.equal(calendarEventTime(legacy), '');
  assert.deepEqual(calendarEvent(JSON.parse(JSON.stringify(endOnly))), endOnly);
});

test('one details box keeps legacy information and separates a short calendar summary without dropping text', () => {
  const original = event({ title: 'Kiddush', location: 'Downstairs', description: 'מזל טוב\nAll are welcome' });
  const details = calendarEventDetails(original);
  assert.equal(details, 'Kiddush\nDownstairs\nמזל טוב\nAll are welcome');
  const unchanged = calendarEvent({ ...original, ...calendarDetailsFields(details, original), time: '10:00', allDay: false });
  for (const field of ['title', 'location', 'description']) assert.equal(unchanged[field], original[field]);
  const changed = event(calendarDetailsFields('New Kiddush\nDownstairs\nמזל טוב'));
  assert.equal(changed.title, 'New Kiddush'); assert.equal(changed.location, ''); assert.equal(changed.description, 'Downstairs\nמזל טוב');
  assert.equal(calendarEventDetails(changed), 'New Kiddush\nDownstairs\nמזל טוב');
  const long = 'A'.repeat(200), split = calendarDetailsFields(long);
  assert.equal(split.title + split.description, long); assert.equal(split.title.length, 160);
  assert.throws(() => calendarDetailsFields('  '), /details/);
  const formatted = '\n  Mazel tov!\n\n  מזל טוב  \n';
  const adminOnly = event({ ...calendarDetailsFields(formatted), visibility: 'admins', reminder: 'schedule' });
  assert.equal(calendarEventDetails(calendarEvent(JSON.parse(JSON.stringify(adminOnly)))), formatted);
  assert.equal(adminOnly.reminder, undefined);
  assert.equal(event({}).visibility, 'everyone');
  assert.throws(() => event({ visibility: 'public' }), /who can see/);
});

test('an event stores each audience’s original wording and summarizes only the shared text when present', () => {
  const admin = '\n  Private wording\n\nמזל טוב  \n', congregation = 'Community Kiddush\n\nAll are welcome.\n';
  const internal = event({ adminDetails: admin, congregationDetails: '', reminder: 'schedule' });
  assert.equal(internal.visibility, 'admins');
  assert.equal(internal.reminder, undefined);
  assert.equal(calendarAdminDetails(internal), admin);
  assert.equal(calendarCongregationDetails(internal), '');
  const shared = event({ adminDetails: admin, congregationDetails: congregation });
  assert.equal(shared.visibility, 'everyone');
  assert.equal(shared.title, 'Community Kiddush');
  assert.equal(calendarAdminDetails(shared), admin);
  assert.equal(calendarCongregationDetails(shared), congregation);
  assert.equal(calendarAdminDetails(event({ congregationDetails: congregation })), '');
  assert.throws(() => event({ adminDetails: ' \n ', congregationDetails: '' }), /Enter admin information or congregation information/);
  assert.throws(() => event({ adminDetails: 'א'.repeat(4365), congregationDetails: congregation }), /admin information/);
  const legacyInternal = event({ title: 'Private legacy summary', details: 'Wording to share', visibility: 'admins' });
  const published = calendarEvent({ ...legacyInternal, congregationDetails: legacyInternal.details, adminDetails: '' }, legacyInternal);
  assert.equal(published.title, 'Wording to share', 'Switching audiences rebuilds the summary from the shared text');
});

test('preview storage preserves corrupt data and reports unavailable storage instead of claiming a save', () => {
  let saved = '{broken'; const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  assert.throws(() => calendarReadPreview(storage), /data has been kept/); assert.equal(saved, '{broken');
  calendarWritePreview([{ ...event({}), id: 'synthetic-event-1', revision: 1 }], storage);
  assert.equal(calendarReadPreview(storage)[0].title, 'Synthetic Kiddush');
  const duplicate = JSON.parse(saved); duplicate.events.push(duplicate.events[0]); saved = JSON.stringify(duplicate);
  assert.throws(() => calendarReadPreview(storage), /could not be read/);
  assert.throws(() => calendarWritePreview([], { setItem() { throw new Error('quota'); } }), /could not be saved/);
  assert.equal(CALENDAR_STORAGE_KEY, 'lakewood-commons-calendar-preview-v1');
});

test('congregation month limits follow the current month across years and calendar boundaries', () => {
  assert.deepEqual(calendarReaderMonths('2026-11-06'), { first:'2026-10', current:'2026-11', last:'2026-12' });
  assert.deepEqual(calendarReaderMonths('2027-01-01'), { first:'2026-12', current:'2027-01', last:'2027-02' });
  assert.deepEqual(calendarReaderMonths('2026-12-31'), { first:'2026-11', current:'2026-12', last:'2027-01' });
  assert.deepEqual(calendarReaderMonths('1900-01-01'), { first:'1900-01', current:'1900-01', last:'1900-02' });
  assert.deepEqual(calendarReaderMonths('2299-12-31'), { first:'2299-11', current:'2299-12', last:'2299-12' });
  assert.throws(() => calendarReaderMonths('2026-02-30'), /valid calendar date/);
});
