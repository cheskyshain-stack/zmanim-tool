import { civilDate, shiftDate, midnight, DAY, HOUR } from '../traffic-calendar.js';

export function calendarSessionExpiration(signedInAt) {
  const earliest = signedInAt + 7 * DAY;
  const date = civilDate(earliest);
  // New York changes its clocks before 3 a.m. Count back from the following midnight.
  const tonight = midnight(shiftDate(date, 1)) - 21 * HOUR;
  return tonight >= earliest ? tonight : midnight(shiftDate(date, 2)) - 21 * HOUR;
}
