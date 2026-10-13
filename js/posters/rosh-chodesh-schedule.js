import { roshChodeshBaseSchedule, specialShacharisHtml } from './special-shacharis.js';
import { chanukahPostedShacharisRows } from './chanukah.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';

/** The posted Rosh Chodesh morning, including Chanukah's shared first-minute
 * average. The Chanukah calculation itself reads the base schedule, avoiding
 * recursion. Every chart, handout, message and upcoming time quotes this result. */
export function roshChodeshSchedule(serial, settings) {
  const schedule = roshChodeshBaseSchedule(serial, settings);
  if (!schedule || schedule.month !== 10) return schedule;
  const year = hebrewDateExtended(serial, settings.useGregorianBefore1582).year;
  const posted = chanukahPostedShacharisRows(year, settings).find(row => row.isRoshChodesh);
  if (!posted) return schedule;
  let index = 0;
  const lines = schedule.lines.map(line => line.map(cell => index++ === 0
    ? { ...cell, text: posted.vasikin.time, trace: posted.vasikin.trace } : cell));
  return { ...schedule, lines, html: specialShacharisHtml(lines) };
}
