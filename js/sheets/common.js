// Helpers shared between שבת קיץ and שבת חורף - both sheets use the exact same
// "day-of-year window" gate and the exact same Erev Shabbos main-Mincha menu formula.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { formatTime, underlineTime, ceilToMinute } from '../format.js';
import { flattenNonEmpty, splitLinesInHalf, NBSP, SLASH } from '../util.js';

export const T = (h, m) => ((h % 24) + m / 60) / 24; // Excel TIME(h,m,) as a day-fraction

/** DST active AND month<6 - specifically the *spring* DST window (roughly the 2nd
 *  Sunday of March through Pesach), deliberately excluding the *fall* DST window
 *  (Sukkos through the 1st Sunday of November), which is also nominally "DST active"
 *  but must NOT count here: this same test is also the cutover point at which a שבת
 *  חורף season needs its final page generated as an actual שבת קיץ chart instead (see
 *  weeks.js's splitChorefAtSpringCutover) - that switch must only happen once, near
 *  the season's end, not at Sukkos just because the clock happens to still read DST
 *  there too. */
export function inSpringDstWindow(date, settings) {
  return Z.dstLocal(date, settings) && date.getUTCMonth() + 1 < 6;
}

/** (spring DST window) OR (Hebrew day-of-year<192): the window in which the
 *  Plag-Hamincha-based early minyanim are offered at all. The day-of-year branch
 *  additionally covers שבת קיץ's own late-season stretch (Elul into Tishrei/Sukkos),
 *  which has nothing to do with DST. */
export function inPlagWindow(serial, settings) {
  const d = dateFromSerial(serial);
  const doy = hebrewDateExtended(serial, settings.useGregorianBefore1582).dayOfYear;
  return inSpringDstWindow(d, settings) || doy < 192;
}

/** The Erev Shabbos "main" Mincha menu (קיץ column L / חורף column I) - identical
 *  formula in both sheets. Printed across two lines, split as evenly as possible
 *  (more options on the second line when the count is odd).
 *
 *  While the clocks are forward, nothing is offered before 1:35. That is the shul's rule
 *  and it is a deliberate departure from the workbook, which does not have it.
 *
 *  It matters for one stretch: חורף opens at Sukkos but the clocks do not go back until
 *  the start of November, so the first weeks of the winter schedule are still on DST.
 *  Through those weeks Mincha Gedola Lechumra sits just under 1:20 (measured across the
 *  5787 winter: 1:16, 1:15, 1:15, 1:15, 1:15 on the five Fridays from 2 October to 30
 *  October) and the early minyan below fired on its own, putting a 1:15 in front of the
 *  1:35 on a day nobody davens that early. From 6 November it is on standard time and the
 *  whole early set is right again, and by late March, when the clocks go forward at the
 *  other end of the season, Mincha Gedola has moved past 1:35 and the early minyan does not
 *  come up anyway. קיץ is on DST from end to end, and its Mincha Gedola is later still, so
 *  nothing there changes either way. */
export function fridayMainMinchaMenu(fridayDate, settings) {
  const mgl = Z.minchaGedolaLechumra(fridayDate, settings);
  const onStandardTime = !Z.dstLocal(fridayDate, settings);
  const items = flattenNonEmpty([
    onStandardTime ? [underlineTime(Math.max(T(12, 30), mgl)), underlineTime(T(1, 0))] : '',
    onStandardTime && mgl < T(13, 20) ? underlineTime(Math.max(mgl, T(13, 15))) : '',
    underlineTime(mgl > T(13, 35) ? mgl : T(1, 35)),
    '1:50',
    '2:15',
    '3:00',
  ]);
  return splitLinesInHalf(items);
}

/** Shabbos-day Mincha menu (קיץ column C / חורף column C) - identical formula.
 *  Also printed across two lines, split the same way. */
export function shabbosMinchaMenu(shabbosDate, settings) {
  const sunsetVal = Z.sunset(shabbosDate, settings);
  const candidates = [T(5, 30), T(6, 0), T(6, 30)];
  const gates = [T(17, 30), T(18, 0), T(18, 30)];
  const kept = candidates.filter((_, i) => gates[i] <= sunsetVal - 1 / 24).map((t) => underlineTime(t));
  const items = flattenNonEmpty([
    Z.dstLocal(shabbosDate, settings) ? '1:40' : '1:20',
    kept,
    // Original formula uses ROUNDUP here (not ROUNDDOWN, unlike most other columns) -
    // ceilToMinute matches that.
    formatTime(Math.min(ceilToMinute(sunsetVal - 45 / 1440), T(19, 0))),
    underlineTime(Math.min(ceilToMinute(sunsetVal - 30 / 1440), T(19, 30))),
  ]);
  return splitLinesInHalf(items);
}
function floorMin(x) {
  return Math.floor(x * 1440 + 1e-7) / 1440;
}

/** Fixed Shacharis line (קיץ column E / חורף column E) - identical, not date-dependent.
 *  Uses NBSP around the "/" so it can never wrap onto a second line. */
export function shacharisLine() {
  return `${underlineTime(T(7, 30))}${SLASH}8:15`;
}

/** Candle lighting + sunset (קיץ column H / חורף column H) - identical formula. */
export function candleLightingCell(fridayDate, settings) {
  const sunsetElevFriday = floorMin(Z.sunsetElev(fridayDate, settings));
  return `${formatTime(sunsetElevFriday - settings.candleLightingMinutes / 1440)}\nשקיעה${NBSP}${formatTime(sunsetElevFriday)}`;
}

/** If this Shabbos IS the 9th of Av, the fast is pushed off to Sunday (10 Av) - Motzei
 *  Shabbos's Maariv is really the start of Tisha B'Av. Flags it by appending "ט באב" to
 *  the Mincha (C) and Motzei-Shabbos Maariv (B) cells, alongside whatever they already
 *  computed - never replacing that content. Applies automatically to every week, not a
 *  user-editable rule, since it's a fixed calendar fact rather than a shul preference. */
export function applyTishaBavNote(row, week, settings) {
  const jdate = hebrewDateExtended(week.serial, settings.useGregorianBefore1582);
  if (jdate.month !== 5 || jdate.dayOfMonth !== 9) return row; // month 5 = Av (Nissan=1..Adar=12 numbering)
  const withNote = (text) => [text, 'ט באב'].filter(Boolean).join('\n');
  return { ...row, B: withNote(row.B), C: withNote(row.C) };
}
