import { CALENDAR_TYPES, calendarISO, calendarSerial } from './model.js';

export const CALENDAR_REMINDER_TYPES = CALENDAR_TYPES.filter(type => type.id !== 'custom');
export const DEFAULT_CALENDAR_REMINDER_RULE = { day: 'day-of', time: '09:00', fridayTime: '' };
export const DEFAULT_CALENDAR_REMINDER_SCHEDULE = { revision: 0, standard: null, categories: {} };

export function calendarReminderSchedule(value) {
  const validTime = time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const timing = rule => {
    const { day, time, fridayTime = '' } = rule || {};
    if (!['day-of', 'day-before'].includes(day)) throw new Error('Choose the day of the simcha or the day before.');
    if (!validTime(time) || fridayTime !== '' && !validTime(fridayTime)) throw new Error('Choose valid reminder times.');
    return { day, time, fridayTime };
  };
  const { revision, standard, categories, sameTime } = value || {};
  if (!Number.isSafeInteger(revision) || revision < 0 || !categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('Reload the reminder schedule before saving.');
  if (sameTime !== undefined && typeof sameTime !== 'boolean') throw new Error('Choose how to set the reminder times.');
  const overrides = Object.entries(categories).map(([id, rule]) => {
    if (!CALENDAR_REMINDER_TYPES.some(type => type.id === id)) throw new Error('Choose a simcha category.');
    return [id, timing(rule)];
  });
  return { revision, standard: standard == null ? null : timing(standard), categories: Object.fromEntries(overrides), ...(sameTime === undefined ? {} : { sameTime }) };
}

export const calendarReminderShabbos = date => new Date(date + 'T12:00:00Z').getUTCDay() === 6;

export function calendarReminderDate(date, mode) {
  const day = calendarSerial(date);
  if (!Number.isFinite(day) || !['day-of', 'day-before'].includes(mode)) return '';
  return calendarISO(day - (calendarReminderShabbos(date) || mode === 'day-before' ? 1 : 0));
}

export function calendarReminderSlot(event, schedule = DEFAULT_CALENDAR_REMINDER_SCHEDULE) {
  if (!event.reminder) return null;
  const supported = CALENDAR_REMINDER_TYPES.some(type => type.id === event.type);
  if (!supported && event.reminder === 'schedule') return null;
  const override = schedule.sameTime === true ? null : schedule.categories[event.type];
  const personal = supported && (override || schedule.standard);
  const rule = personal || (event.reminder === 'schedule' ? DEFAULT_CALENDAR_REMINDER_RULE : { ...DEFAULT_CALENDAR_REMINDER_RULE, day: event.reminder });
  const date = calendarReminderDate(event.date, rule.day);
  const time = calendarReminderShabbos(event.date) && rule.fridayTime || rule.time;
  return date ? { date, time } : null;
}
