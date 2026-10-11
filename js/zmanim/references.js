import * as Z from './zmanim.js';
import { dateFromSerial } from './solar.js';
import { excelWeekday } from '../hebrew-calendar.js';
import { weekLatestMinchaGedola } from '../sheets/common.js';
import { nineHours } from '../posters/reckonings.js';

export const ZMANIM_REFERENCE_GROUPS = {
  shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv', other: 'Other zmanim',
};

/** Dates actually covered by chart rows, including the weekdays which set the early
 * Mincha limit. An anchor can be a holiday stand-in rather than a Shabbos. */
export function chartReferenceDates(weeks, weekday = false) {
  return [...new Set(weeks.flatMap(week => {
    const sunday = week.serial - (excelWeekday(week.serial) - 1);
    return Array.from({ length: weekday ? 6 : 7 }, (_, i) => sunday + i);
  }))].sort((a, b) => a - b);
}

/** Combined runs retain each schedule's dates; BHB and Rosh Chodesh keep their
 * explicit days, without turning gaps into additional scheduled mornings. */
export function posterReferenceDates(poster) {
  if (!poster) return [];
  const children = poster.sheets || poster.items?.map(item => item.poster);
  if (children) return [...new Set(children.flatMap(posterReferenceDates))].sort((a, b) => a - b);
  if (poster.days?.length && poster.days.every(Number.isInteger)) return [...poster.days];
  const { from, to } = poster.span || {};
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** These are references, not new schedule rules. Read the same named functions and
 * Settings as the chart, retaining fractions until presentation. */
export function zmanimReferences(serial, settings, group, { weeklyLimit = false } = {}) {
  const date = dateFromSerial(serial), refs = [];
  const add = (key, label, value, note = '') => refs.push({ key, label, value, note });
  const elevationNote = settings.elevation ? (settings.useElevation ? 'Elevation included' : 'Elevation excluded') : '';
  const shkia = Z.sunsetElev(date, settings);
  const sunsetRefs = () => {
    add('shkia', 'שקיעה', shkia, elevationNote);
    const elevated = Z.sunset(date, settings);
    if (Math.abs(elevated - shkia) > 1e-9) add('shkia-elevation', 'שקיעה (עם גובה)', elevated, 'Elevation always included, as in the Shabbos Mincha formulas');
  };
  if (group === 'shacharis') {
    const netz = Z.sunriseElev(date, settings);
    add('netz', 'נץ החמה', netz, elevationNote);
    const elevated = Z.sunrise(date, settings);
    if (Math.abs(elevated - netz) > 1e-9) add('netz-elevation', 'נץ (עם גובה)', elevated, 'Elevation always included');
    add('alos-16', 'עלות 16.1°', Z.alos16_1(date, settings));
    add('alos-72', 'עלות 72', Z.alos72(date, settings));
    add('misheyakir', 'משיכיר 10.2°', Z.misheyakir10_2(date, settings));
    add('shma-mga', 'סוף זמן ק״ש מ״א 72', Z.sofZmanShmaMGA72(date, settings));
    add('shma-gra', 'סוף זמן ק״ש גר״א', Z.sofZmanShmaGRA(date, settings));
    add('tefila', 'סוף זמן תפילה גר״א', Z.sofZmanTfilaGRA(date, settings));
  } else if (group === 'mincha') {
    sunsetRefs();
    add('chatzos', 'חצות', Z.solarNoon(date, settings), 'Astronomical midday');
    add('gedola', 'מנחה גדולה גר״א', Z.minchaGedola(date, settings));
    add('chatzos-30', 'חצות + 30 דקות', Z.minchaGedola30MinAfterChatzos(date, settings));
    add('gedola-lechumra', 'מנחה גדולה לחומרא', Z.minchaGedolaLechumra(date, settings), 'Later of Gedola and Chatzos + 30');
    if (weeklyLimit) add('gedola-week', 'מנחה גדולה: גבול שבועי', weekLatestMinchaGedola(serial, settings), 'Latest Sun–Fri, excluding Yom Tov; rounded to the nearest minute');
    add('gedola-mga', 'מנחה גדולה מ״א 16.1°', Z.minchaGedolaMGA16_1(date, settings));
    add('plag-gra', 'פלג גר״א', Z.plagHamincha(date, settings));
    add('plag-mga', 'פלג מ״א (צאת 50)', Z.plagHaminchaCustom(Z.tzais50(date, settings), Z.alos16_1(date, settings)), 'Alos 16.1° to Shkiya + 50 minutes, as on the chart');
    add('plag-mga-72', 'פלג מ״א 72', Z.plagHaminchaCustom(Z.tzais72(date, settings), Z.alos16_1(date, settings)), 'Alos 16.1° to Shkiya + 72 minutes, as on the chart');
    add('ketana', 'מנחה קטנה', Z.minchaKetana(date, settings));
    add('samuch-ketana', 'סמוך למנחה קטנה', Z.samuchLeminchaKetana(date, settings));
  } else if (group === 'maariv') {
    sunsetRefs();
    for (const minutes of [35, 40, 50, 55, 60, 72]) {
      add('shkia-plus-' + minutes, `שקיעה + ${minutes} דקות`, shkia + minutes / 1440, elevationNote);
      const elevated = Z.sunset(date, settings);
      if (Math.abs(elevated - shkia) > 1e-9) add('shkia-elevation-plus-' + minutes, `שקיעה עם גובה + ${minutes}`, elevated + minutes / 1440, 'Elevation always included, as in the Friday Maariv formulas');
    }
    add('tzais-8', 'צאת 8.5°', Z.tzaisGeonim8_5(date, settings));
    add('tzais-16', 'צאת 16.1°', Z.tzais16_1(date, settings));
  } else if (group === 'other') {
    sunsetRefs();
    add('candles', 'הדלקת נרות (לפני עיגול)', shkia - settings.candleLightingMinutes / 1440, `${settings.candleLightingMinutes} minutes before true sunset, before schedule rounding`);
    const hours = nineHours(date, settings);
    add('nine-gra', 'ט׳ שעות גר״א', hours.gra);
    add('nine-mga', 'ט׳ שעות מ״א 72', hours.mga);
  }
  const secondary = {
    shacharis: ['alos-16', 'alos-72', 'misheyakir'],
    mincha: ['gedola-mga', 'plag-gra', 'plag-mga', 'plag-mga-72', 'ketana', 'samuch-ketana'],
    maariv: ['shkia-plus-40', 'shkia-plus-55', 'shkia-elevation-plus-40', 'shkia-elevation-plus-55', 'tzais-8', 'tzais-16'],
  }[group] || [];
  return refs.map(ref => ({ ...ref, secondary: secondary.includes(ref.key) }));
}

/** Truncate at hundredths of a second so a reference cannot claim a later minute
 * has arrived. AM/PM is explicit for comparing a full day's schedule. */
export function referenceClock(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  const hundredths = Math.floor((((value % 1) + 1) % 1) * 8640000 + 1e-5) % 8640000;
  const hours = Math.floor(hundredths / 360000), minutes = Math.floor(hundredths / 6000) % 60;
  const seconds = Math.floor(hundredths / 100) % 60, fraction = hundredths % 100;
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}
