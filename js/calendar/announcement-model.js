export const CALENDAR_ANNOUNCEMENT_LENGTH = 4000;

export function calendarAnnouncementView(message) {
  const { lastEditId, ...record } = message;
  return { ...record, authorName: 'Shul', revision: message.revision || 1 };
}

export function calendarAnnouncementText(value, maximum = CALENDAR_ANNOUNCEMENT_LENGTH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter an announcement.');
  if (value.length > maximum) throw new Error('Use up to ' + maximum.toLocaleString('en-US') + ' characters for an announcement.');
  return value.replace(/\r\n?/g, '\n').trim();
}
