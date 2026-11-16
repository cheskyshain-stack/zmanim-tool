import { WEEKDAY_SHACHARIS_SPECIAL } from '../settings.js';
import { parseTimes } from './slichos.js';
import { fixedTime, zman } from '../zmanim/trace.js';
import { dateFromSerial } from '../zmanim/solar.js';
import { sunriseElev } from '../zmanim/zmanim.js';
import { hebrewDateExtended, excelWeekday, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';

/** The seasonal chart's special morning list, retaining its room marks and traces. */
export function specialShacharisLines() {
  return WEEKDAY_SHACHARIS_SPECIAL.split('\n').map(line =>
    parseTimes(line.replace(/\s+/g, ',')).map(time => {
      let trace = fixedTime(time.text, { am: true, label: 'the seasonal chart\'s special Shacharis schedule' });
      if (time.underlined) trace = trace.underline();
      if (time.mark) trace = trace.mark(time.mark);
      return { text: trace.plain(), underlined: Boolean(trace.flags.underlined), mark: trace.flags.mark || '', trace };
    }));
}

export const RC_BEFORE_NETZ_MINUTES = 25;

export const specialShacharisHtml = lines => lines.map(line => line.map(cell =>
  `${cell.underlined ? `<u>${cell.text}</u>` : cell.text}${cell.mark}`).join(' ')).join('\n');

/** One schedule for the whole weekday portion of a Rosh Chodesh. The later
 * sunrise governs both dates, and rounding up never crosses the earliest start. */
export function roshChodeshBaseSchedule(serial, settings) {
  const at = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  if (![1, 30].includes(at.dayOfMonth)) return null;
  const before = hebrewDateExtended(serial - 1, settings.useGregorianBefore1582);
  const first = at.dayOfMonth === 30 ? serial : before.dayOfMonth === 30 ? serial - 1 : serial;
  const last = at.dayOfMonth === 30 ? serial + 1 : serial;
  const month = hebrewDateExtended(last, settings.useGregorianBefore1582).month;
  if (month === 7) return null;
  const days = Array.from({ length: last - first + 1 }, (_, i) => first + i)
    .filter(day => excelWeekday(day) !== 7);
  if (!days.length) return null;
  const latest = days.reduce((a, b) => sunriseElev(dateFromSerial(b), settings) > sunriseElev(dateFromSerial(a), settings) ? b : a);
  const earliest = zman('נץ', sunriseElev(dateFromSerial(latest), settings),
    `Latest sunrise on the weekday Rosh Chodesh dates: ${days.map(day => dateFromSerial(day).toISOString().slice(0, 10)).join(', ')}`)
    .minus(RC_BEFORE_NETZ_MINUTES, 'The first two Rosh Chodesh minyanim cannot start earlier than 25 minutes before netz')
    .ceil('Round up to a whole minute so the start never precedes netz minus 25 minutes');
  let index = 0;
  const lines = specialShacharisLines().map(line => line.map(cell => {
    if (index++ >= 2) return cell;
    const trace = cell.trace.laterOf(earliest, 'Keep the standing time unless netz minus 25 minutes is later');
    return { ...cell, text: trace.plain(), trace };
  }));
  return { days, month, title: `ר"ח ${JEWISH_MONTHS_HE[month - 1]}`, lines,
    html: specialShacharisHtml(lines) };
}
