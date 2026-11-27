import { chanukahYearFor, excelWeekday } from './hebrew-calendar.js';
import { dateFromSerial } from './zmanim/solar.js';
import { minchaGedolaLechumra } from './zmanim/zmanim.js';
import { clockTime, zman } from './zmanim/trace.js';

/** The new downstairs minyan begins with Chanukah 5787. Keep older schedules intact.
 * Friday includes the first candle's afternoon when 25 Kislev falls on Shabbos. */
export function chanukahEarlyMincha(serial, settings) {
  const weekday = excelWeekday(serial);
  if (weekday !== 1 && weekday !== 6) return null;
  const year = chanukahYearFor(serial, settings) || (weekday === 6 ? chanukahYearFor(serial + 1, settings) : null);
  if (!year || year < 5787) return null;
  const limit = zman('מנחה גדולה לחומרא', minchaGedolaLechumra(dateFromSerial(serial), settings),
    `on this Chanukah ${weekday === 6 ? 'Friday' : 'Sunday'}`)
    .ceilToStep(5, 'round up to five minutes, keeping the exact zman and its seconds until rounding');
  return clockTime(12, 15, 'the extra early downstairs Mincha on Chanukah Fridays and Sundays')
    .laterOf(limit, 'the early minyan cannot begin before Mincha Gedola Lechumra').underline();
}

/** Keep the following 12:30 minyan at least fifteen minutes after the early minyan. */
export function chanukahMinchaFollowing(time, early) {
  return early ? time.laterOf(early.plus(15, 'leave fifteen minutes before the following minyan'),
    'the following minyan must start at least fifteen minutes after the early Mincha') : time;
}
