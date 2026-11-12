import { dateFromSerial, excelSerial } from '../zmanim/solar.js';
import { hebrewDateExtended, jewishDateString, hebrewYear, dateFromHebrew, hasParsha, hasYomTov, hasRoshChodesh, hasTaanis, hasBehab, hasSpecialParsha, isShabbosMevarchim, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';

export const CALENDAR_TYPES = [
  { id: 'shalom-zachor', label: 'Shalom Zachor', compact: 'Shalom Z.', colour: '#356a9a' },
  { id: 'kiddush', label: 'Kiddush', compact: 'Kiddush', colour: '#24736c' },
  { id: 'vort', label: 'Vort', compact: 'Vort', colour: '#705494' },
  { id: 'aufruf', label: 'Aufruf', compact: 'Aufruf', colour: '#8c651e' },
  { id: 'wedding', label: 'Chasuna', compact: 'Chasuna', colour: '#a4476e' },
  { id: 'bar-mitzva-shabbos', label: 'Bar mitzva shabbos', compact: 'B.M. Shabbos', colour: '#356a9a' },
  { id: 'bar-mitzva-dessert', label: 'Bar mitzva dessert', compact: 'B.M. dessert', colour: '#456b3b' },
  { id: 'custom', label: 'Custom', compact: 'Custom', colour: '#596573' },
];

export const CALENDAR_LEGACY_TYPES = [
  { id: 'bar-mitzvah', label: 'Bar mitzvah', compact: 'Bar M.', colour: '#356a9a' },
  { id: 'simcha', label: 'Simcha', compact: 'Simcha', colour: '#8c651e' },
  { id: 'schedule', label: 'Schedule', compact: 'Times', colour: '#456b3b' },
  { id: 'announcement', label: 'Announcement', compact: 'Notice', colour: '#705494' },
  { id: 'other', label: 'Other', compact: 'Event', colour: '#596573' },
];

const CALENDAR_TYPE_ORDER = new Map([...CALENDAR_TYPES, ...CALENDAR_LEGACY_TYPES].map((type, index) => [type.id, index]));
export const CALENDAR_EVENT_DETAILS_MAX = 4364;

export function calendarEventCategory(event) {
  const type = [...CALENDAR_TYPES, ...CALENDAR_LEGACY_TYPES].find(item => item.id === event.type) || CALENDAR_LEGACY_TYPES.at(-1);
  return event.type === 'custom' ? { ...type, label: event.customCategory || 'Custom', compact: event.customCategory || 'Custom' } : type;
}

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
    if (out.length > limit) throw new Error(`${key === 'description' ? 'Description' : key === 'customCategory' ? 'Category name' : key[0].toUpperCase() + key.slice(1)} is too long.`);
    if (required && !out) throw new Error('Enter an event title.');
    return out;
  };
  const date = text('date', 10), endDate = text('endDate', 10) || date;
  const start = calendarSerial(date), end = calendarSerial(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Choose a valid date between 1900 and 2299.');
  if (end < start || end - start > 366) throw new Error('The end date must be on or after the start, within one year.');
  const type = text('type', 30);
  if (![...CALENDAR_TYPES, ...CALENDAR_LEGACY_TYPES].some(item => item.id === type)) throw new Error('Choose an event category.');
  const customCategory = type === 'custom' ? text('customCategory', 60) : '';
  if (type === 'custom' && !customCategory) throw new Error('Enter a category name.');
  if (value.allDay != null && typeof value.allDay !== 'boolean') throw new Error('Choose valid event times.');
  const time = value.allDay === true ? '' : text('time', 5), endTime = value.allDay === true ? '' : text('endTime', 5);
  const allDay = !time && !endTime;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid start time.');
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error('Choose a valid end time.');
  if (endDate === date && time && endTime && endTime <= time) throw new Error('The end time must follow the start time.');
  const revision = value.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) throw new Error('This event needs to be reloaded.');
  const visibility = value.visibility ?? 'everyone';
  if (!['everyone', 'admins'].includes(visibility)) throw new Error('Choose who can see this event.');
  const details = value.details;
  if (details !== undefined && (typeof details !== 'string' || !details.trim() || details.length > CALENDAR_EVENT_DETAILS_MAX)) throw new Error('Enter up to 4,364 characters of event details.');
  const reminder = text('reminder', 10);
  if (reminder && !['day-of', 'day-before', 'schedule'].includes(reminder)) throw new Error('Choose a valid phone reminder.');
  return { title: text('title', 160, true), type, customCategory, date, endDate, allDay, time, endTime,
    location: text('location', 200), description: text('description', 4000), ...(details === undefined ? {} : { details }),
    visibility, ...(reminder && visibility === 'everyone' ? { reminder } : {}), revision };
}

export function calendarEventDetails(event) {
  return event.details ?? [event.title, event.location, event.description].filter(Boolean).join('\n');
}

export function calendarDetailsFields(details, original = {}) {
  const text = details.trim(), firstLine = text.split('\n', 1)[0];
  if (!text) throw new Error('Enter the event details.');
  // Keep legacy fields intact when only a category, date or time is changed.
  if (details === calendarEventDetails(original)) return { title: original.title || '', location: original.location || '', description: original.description || '', details: original.details };
  // Keep the legacy summary fields bounded while storing the full, unchanged text.
  const title = firstLine.slice(0, 160), description = text.slice(title.length).trim().slice(0, 4000);
  return { title, location: '', description, details };
}

export function calendarEventsOn(events, date) {
  return events.filter(item => item.date <= date && item.endDate >= date)
    .sort((a, b) => (CALENDAR_TYPE_ORDER.get(a.type) ?? 99) - (CALENDAR_TYPE_ORDER.get(b.type) ?? 99)
      || (a.type === 'custom' && b.type === 'custom' ? (a.customCategory || '').localeCompare(b.customCategory || '') : 0)
      || Number(b.allDay) - Number(a.allDay) || (a.time || a.endTime || '').localeCompare(b.time || b.endTime || '') || a.title.localeCompare(b.title));
}

// Calendar wording follows the supplied monthly-calendar examples. These labels
// do not replace the workbook's holiday names or change any minyan calculations.
function calendarHoliday(serial, hebrew, settings, table) {
  const source = hasYomTov(serial, settings, table);
  const { month, dayOfMonth: day } = hebrew;
  if (month === 1) {
    if (day === 14) return 'ערב פסח';
    if (day === 20) return 'ערב ז׳ פסח';
    if (source.includes('חול המועד')) return 'חול המועד';
    if (source === 'פסח') return ({ 15: 'א׳ פסח', 16: 'ב׳ פסח', 21: 'ז׳ פסח', 22: 'ח׳ פסח' })[day] || source;
  }
  if (month === 9 && day === 24) return 'ערב חנוכה';
  if (source.includes('חול המועד')) return 'חול המועד';
  return source;
}

function calendarRainPrayer(serial, hebrew, settings) {
  if (settings.inIsrael) return hebrew.month === 8 && hebrew.dayOfMonth === 7;
  const year = dateFromSerial(serial).getUTCFullYear();
  // The diaspora's first daytime date is normally Dec 5, Dec 6 before a Julian
  // leap year. Gregorian/Julian century drift remains relevant after 2099.
  // Its first recitation is the preceding evening; a Shabbos start waits until
  // Motzaei Shabbos, displayed under Sunday's Hebrew date in the reference style.
  const drift = Math.floor(year / 100) - Math.floor(year / 400) - 15;
  let start = calendarSerial(`${year}-12-${String(5 + drift + ((year + 1) % 4 === 0 ? 1 : 0)).padStart(2, '0')}`);
  if (dateFromSerial(start).getUTCDay() === 6) start++;
  return serial === start;
}

export function calendarMonth(month, settings, tables) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month.');
  const first = calendarSerial(month + '-01');
  if (!Number.isFinite(first)) throw new Error('Choose a month between 1900 and 2299.');
  const date = dateFromSerial(first), year = date.getUTCFullYear(), index = date.getUTCMonth();
  const last = first + new Date(Date.UTC(year, index + 1, 0)).getUTCDate() - 1;
  const start = first - date.getUTCDay(), count = Math.ceil((last - start + 1) / 7) * 7;
  const hebrewSettings = { ...settings, english: false };
  const days = Array.from({ length: count }, (_, offset) => {
    const serial = start + offset, iso = calendarISO(serial), hebrew = hebrewDateExtended(serial, settings.useGregorianBefore1582);
    const label = jewishDateString(serial, false, settings.useGregorianBefore1582);
    const holiday = calendarHoliday(serial, hebrew, hebrewSettings, tables.specialDays);
    const roshChodesh = hasRoshChodesh(serial, hebrewSettings).replace(/^ראש חדש /, 'ר״ח ');
    const fast = hasTaanis(serial, hebrewSettings);
    const special = hasSpecialParsha(serial, hebrewSettings);
    const specialLabel = special ? (['שובה', 'שירה', 'הגדול', 'חזון', 'נחמו'].includes(special) ? 'שבת ' + special : special) : '';
    const parsha = hasParsha(serial, hebrewSettings, tables);
    const mevarchim = isShabbosMevarchim(serial, hebrewSettings);
    const bechoros = dateFromHebrew(14, 1, hebrew.year);
    const bechorosDate = dateFromSerial(bechoros).getUTCDay() === 6 ? bechoros - 2 : bechoros;
    const yizkor = hebrew.month === 7 && [10, 22].includes(hebrew.dayOfMonth)
      || hebrew.month === 1 && hebrew.dayOfMonth === (settings.inIsrael ? 21 : 22)
      || hebrew.month === 3 && hebrew.dayOfMonth === (settings.inIsrael ? 6 : 7);
    const facts = [...new Set([holiday, roshChodesh, fast, serial === bechorosDate ? 'ת׳ בכורים' : '',
      hasBehab(serial, hebrewSettings), calendarRainPrayer(serial, hebrew, settings) ? 'טל ומטר' : '', yizkor ? 'יזכור' : ''].filter(Boolean))];
    return { serial, iso, inMonth: serial >= first && serial <= last, day: dateFromSerial(serial).getUTCDate(),
      hebrew, hebrewLabel: label, hebrewDay: label.split(' ')[0].replace(/[׳״]/g, ''), parsha, special, specialLabel, mevarchim, facts,
      shabbos: dateFromSerial(serial).getUTCDay() === 6 };
  });
  const a = hebrewDateExtended(first, settings.useGregorianBefore1582), b = hebrewDateExtended(last, settings.useGregorianBefore1582);
  const hebrewRange = a.month === b.month ? `${JEWISH_MONTHS_HE[a.month - 1]} ${hebrewYear(a.year)}`
    : `${JEWISH_MONTHS_HE[a.month - 1]}${a.year === b.year ? '' : ' ' + hebrewYear(a.year)} - ${JEWISH_MONTHS_HE[b.month - 1]} ${hebrewYear(b.year)}`;
  return { month, first: calendarISO(first), last: calendarISO(last), days, hebrewRange,
    title: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date) };
}

export function calendarStepMonth(month, amount) {
  const date = new Date(month + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function calendarReaderMonths(today) {
  if (!Number.isFinite(calendarSerial(today))) throw new Error('Choose a valid calendar date.');
  const current = today.slice(0, 7);
  return {
    first: current === '1900-01' ? current : calendarStepMonth(current, -1),
    current,
    last: current === '2299-12' ? current : calendarStepMonth(current, 1),
  };
}

export function calendarClock(time) {
  if (!time) return '';
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function calendarEventTime(event) {
  if (event.time && event.endTime) return `${calendarClock(event.time)} - ${calendarClock(event.endTime)}`;
  if (event.endTime) return `Until ${calendarClock(event.endTime)}`;
  return calendarClock(event.time);
}
