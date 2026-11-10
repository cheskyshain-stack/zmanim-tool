import { calendarISO, calendarSerial } from './model.js';

export function calendarReminderDate(date, mode) {
  const day = calendarSerial(date);
  if (!Number.isFinite(day) || !['day-of', 'day-before'].includes(mode)) return '';
  const shabbos = new Date(date + 'T12:00:00Z').getUTCDay() === 6;
  return calendarISO(day - (shabbos || mode === 'day-before' ? 1 : 0));
}
