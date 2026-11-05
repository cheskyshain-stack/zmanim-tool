import { dateFromSerial, excelSerial } from '../zmanim/solar.js';
import { hebrewDateExtended, jewishDateString, hasParsha, hasYomTov, hasRoshChodesh, hasTaanis, hasSpecialParsha, JEWISH_MONTHS_EN } from '../hebrew-calendar.js';

export const CALENDAR_TYPES = [
  { id: 'kiddush', label: 'Kiddush', compact: 'Kiddush', colour: '#24736c' },
  { id: 'wedding', label: 'Wedding', compact: 'Wedding', colour: '#a4476e' },
  { id: 'bar-mitzvah', label: 'Bar mitzvah', compact: 'Bar M.', colour: '#356a9a' },
  { id: 'simcha', label: 'Simcha', compact: 'Simcha', colour: '#8c651e' },
  { id: 'schedule', label: 'Schedule', compact: 'Times', colour: '#456b3b' },
  { id: 'announcement', label: 'Announcement', compact: 'Notice', colour: '#705494' },
  { id: 'other', label: 'Other', compact: 'Event', colour: '#596573' },
];

export function calendarISO(serial) { return dateFromSerial(serial).toISOString().slice(0, 10); }

export function calendarSerial(value) {
  if (typeof value !== 'string' || !/^(19|20|21|22)\d{2}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN;
  return Math.floor(excelSerial(date));
}

export function calendarEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid calendar event.');
  const text = (key, limit, required = false) => {
    if (typeof (value[key] ?? '') !== 'string') throw new Error('Enter valid event information.');
    const out = (value[key] || '').trim();
    if (out.length > limit) throw new Error(`${key === 'description' ? 'Description' : key[0].toUpperCase() + key.slice(1)} is too long.`);
    if (required && !out) throw new Error('Enter an event title.');
    return out;
  };
  const date = text('date', 10), endDate = text('endDate', 10) || date;
  const start = calendarSerial(date), end = calendarSerial(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Choose a valid date between 1900 and 2299.');
  if (end < start || end - start > 366) throw new Error('The end date must be on or after the start, within one year.');
  const type = text('type', 30);
  if (!CALENDAR_TYPES.some(item => item.id === type)) throw new Error('Choose an event type.');
  if (value.allDay != null && typeof value.allDay !== 'boolean') throw new Error('Choose an all-day event or a time.');
  const allDay = value.allDay !== false;
  const time = allDay ? '' : text('time', 5), endTime = allDay ? '' : text('endTime', 5);
  if (!allDay && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a start time.');
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error('Choose a valid end time.');
  if (endDate === date && endTime && endTime <= time) throw new Error('The end time must follow the start time.');
  const revision = value.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) throw new Error('This event needs to be reloaded.');
  return { title: text('title', 160, true), type, date, endDate, allDay, time, endTime,
    location: text('location', 200), description: text('description', 4000), revision };
}

export function calendarEventsOn(events, date) {
  return events.filter(item => item.date <= date && item.endDate >= date)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

export function calendarMonth(month, settings, tables) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month.');
  const first = calendarSerial(month + '-01');
  if (!Number.isFinite(first)) throw new Error('Choose a month between 1900 and 2299.');
  const date = dateFromSerial(first), year = date.getUTCFullYear(), index = date.getUTCMonth();
  const last = first + new Date(Date.UTC(year, index + 1, 0)).getUTCDate() - 1;
  const start = first - date.getUTCDay(), count = Math.ceil((last - start + 1) / 7) * 7;
  const english = { ...settings, english: true };
  const days = Array.from({ length: count }, (_, offset) => {
    const serial = start + offset, iso = calendarISO(serial), hebrew = hebrewDateExtended(serial, settings.useGregorianBefore1582);
    const label = jewishDateString(serial, false, settings.useGregorianBefore1582);
    const holiday = hasYomTov(serial, english, tables.specialDays);
    const roshChodesh = hasRoshChodesh(serial, english);
    const fast = hasTaanis(serial, english);
    const special = hasSpecialParsha(serial, english);
    const parsha = hasParsha(serial, settings, tables);
    const facts = [...new Set([holiday, roshChodesh, fast].filter(Boolean))];
    return { serial, iso, inMonth: serial >= first && serial <= last, day: dateFromSerial(serial).getUTCDate(),
      hebrew, hebrewLabel: label, hebrewDay: label.split(' ')[0], parsha, special, facts,
      shabbos: dateFromSerial(serial).getUTCDay() === 6 };
  });
  const a = hebrewDateExtended(first, settings.useGregorianBefore1582), b = hebrewDateExtended(last, settings.useGregorianBefore1582);
  const hebrewRange = a.month === b.month ? `${JEWISH_MONTHS_EN[a.month - 1]} ${a.year}`
    : `${JEWISH_MONTHS_EN[a.month - 1]}${a.year === b.year ? '' : ' ' + a.year} - ${JEWISH_MONTHS_EN[b.month - 1]} ${b.year}`;
  return { month, first: calendarISO(first), last: calendarISO(last), days, hebrewRange,
    title: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date) };
}

export function calendarStepMonth(month, amount) {
  const date = new Date(month + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function calendarClock(time) {
  if (!time) return 'All day';
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
