import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { calendarMonth, calendarSerial, calendarISO, calendarStepMonth, calendarEvent, calendarEventsOn } from '../js/calendar/model.js';
import { calendarReadPreview, calendarWritePreview, CALENDAR_STORAGE_KEY } from '../js/calendar/storage.js';

const read = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const [published, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(['published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days'].map(read));
const settings = resolveSettings(published.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const event = fields => calendarEvent({ title: 'Synthetic Kiddush', type: 'kiddush', date: '2026-11-07', ...fields });

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
  assert(rh.facts.some(value => /Rosh/i.test(value))); assert.equal(rh.parsha, '');
  assert(september.days.find(day => day.iso === '2026-09-21').facts.some(value => /Kippur/i.test(value)));
  const november = calendarMonth('2026-11', settings, tables);
  assert.equal(november.days.find(day => day.iso === '2026-11-07').parsha, 'חיי שרה');
  for (const date of ['2026-11-10', '2026-11-11']) assert(november.days.find(day => day.iso === date).facts.includes('Rosh Chodesh Kislev'));
  assert(calendarMonth('2024-02', settings, tables).hebrewRange.includes('Adar I'));
  assert(calendarMonth('2024-03', settings, tables).hebrewRange.includes('Adar II'));
  const december = calendarMonth('2026-12', settings, tables);
  assert(december.days.find(day => day.iso === '2026-12-05').facts.some(value => /Chanuk/i.test(value)));
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
  assert.throws(() => event({ type: 'admin', createdBy: 'owner' }), /event type/);
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
