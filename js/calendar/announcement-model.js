export const CALENDAR_ANNOUNCEMENT_LENGTH = 4000;
export const CALENDAR_ANNOUNCEMENT_HISTORY_DAYS = 10;

export const calendarAnnouncementDate = message => message.addedAt || message.createdAt;
export const calendarAnnouncementOrder = (a, b) => calendarAnnouncementDate(b).localeCompare(calendarAnnouncementDate(a)) || b.sequence - a.sequence;

export function calendarAnnouncementAddedAt(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || Date.parse(value) < 0 || Date.parse(value) > now + 300000) throw new Error('Choose a valid added date and time that is not in the future.');
  return value;
}

export function calendarAnnouncementLocalTime(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function calendarAnnouncementInstant(value, timeZone, original = '') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose an added date and time.');
  if (original && calendarAnnouncementLocalTime(original, timeZone) === value) return original;
  const wall = Date.parse(value + ':00.000Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) throw new Error('Choose a valid added date and time.');
  const matches = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = wall + hours * 3600000;
    const offset = Date.parse(calendarAnnouncementLocalTime(probe, timeZone) + ':00.000Z') - probe;
    const candidate = new Date(wall - offset).toISOString();
    if (calendarAnnouncementLocalTime(candidate, timeZone) === value) matches.add(candidate);
  }
  if (matches.size !== 1) throw new Error(matches.size ? 'This time occurs twice when the clocks change. Choose a time outside that repeated hour.' : 'This time does not exist when the clocks change. Choose another time.');
  return calendarAnnouncementAddedAt([...matches][0]);
}

export function calendarAnnouncementView(message) {
  const { lastEditId, ...record } = message;
  return { ...record, authorName: 'Shul', revision: message.revision || 1 };
}

export function calendarAnnouncementText(value, maximum = CALENDAR_ANNOUNCEMENT_LENGTH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter an announcement.');
  if (value.length > maximum) throw new Error('Use up to ' + maximum.toLocaleString('en-US') + ' characters for an announcement.');
  return value.replace(/\r\n?/g, '\n').trim();
}
