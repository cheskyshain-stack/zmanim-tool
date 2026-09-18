// Helpers shared between שבת קיץ and שבת חורף - both sheets use the exact same
// "day-of-year window" gate and the exact same Erev Shabbos main-Mincha menu formula.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { formatTime, underlineTime, ceilToMinute } from '../format.js';
import { flattenNonEmpty, splitLinesInHalf, isolate, NBSP, SLASH } from '../util.js';
import { zman, clockTime, fixedTime } from '../zmanim/trace.js';

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
export function fridayMainMinchaParts(fridayDate, settings) {
  const mglVal = Z.minchaGedolaLechumra(fridayDate, settings);
  const onStandardTime = !Z.dstLocal(fridayDate, settings);
  const mgl = () => zman('מנחה גדולה לחומרא', mglVal, 'the later of מנחה גדולה and half an hour after חצות');
  const notBefore = 'never earlier than מנחה גדולה: where the clock time would be too early, מנחה גדולה is printed instead';

  /* The printed list is these values asked for their text, in this order, rather than a
     second list built alongside them. A trace and the time it explains cannot then be paired
     up wrongly, which juggling two arrays by index invites. */
  const times = [
    onStandardTime ? mgl().laterOf(clockTime(12, 30), notBefore).underline() : null,
    onStandardTime ? clockTime(1, 0).underline() : null,
    onStandardTime && mglVal < T(13, 20) ? mgl().laterOf(clockTime(13, 15), notBefore).underline() : null,
    (mglVal > T(13, 35) ? mgl() : clockTime(1, 35)).underline(),
    fixedTime('1:50'),
    fixedTime('2:15'),
    fixedTime('3:00'),
  ].filter(Boolean);

  return {
    text: splitLinesInHalf(flattenNonEmpty(times.map((t) => t.text()))),
    times,
    note: onStandardTime
      ? 'The clocks are back this week, so the earlier מנינים are offered in front of the 1:35.'
      : 'The clocks are forward this week, so nothing is offered before 1:35. That is the shul\'s own rule and the workbook does not have it.',
  };
}
export function fridayMainMinchaMenu(fridayDate, settings) {
  return fridayMainMinchaParts(fridayDate, settings).text;
}

/** Shabbos-day Mincha menu (קיץ column C / חורף column C) - identical formula.
 *  Also printed across two lines, split the same way. */
/** The names the calendar gives שבת שובה, in both languages, since a rule or a sheet may
 *  carry either. See hebrewCalendar's hasSpecialParsha.
 *
 *  Exported because the poster asks the same question, and the offline build flattens every
 *  module into one scope where a second const of this name is a hard error. One definition
 *  of what this Shabbos is called. */
export const SHUVA_NAMES = ['שובה', 'Shuva'];

/** The two Shabbosos the דרשה afternoon belongs to.
 *
 *  שבת הגדול keeps the same shape as שבת שובה, asked for once the שובה cell had been printing
 *  for a season: an afternoon built around the דרשה rather than the standing 5:30, 6:00 and
 *  6:30. Before this it was a rule that appended the bare word "דרשה" under the ordinary times,
 *  which said one was happening and left the time to be typed in by hand each year.
 *
 *  Separate from SHUVA_NAMES rather than folded into it, because that list answers a different
 *  question: the שבת שובה poster asks it to find its week, and it wants that Shabbos and not a
 *  Shabbos that happens to be built the same way. */
export const DRASHA_NAMES = [...SHUVA_NAMES, 'הגדול', 'Hagadol'];

/** To the nearest 5 minutes. The דרשה is announced to the shul rather than derived from a
 *  zman, so it is said as a round time: 5:14 is not a time anybody is told to come at. */
function roundTo5(dayFraction) {
  return Math.round(dayFraction * 288) / 288; // 288 = 1440 minutes / 5
}

export function shabbosMinchaParts(shabbosDate, settings, specialParsha = '') {
  const sunsetVal = Z.sunset(shabbosDate, settings);
  const onDst = Z.dstLocal(shabbosDate, settings);
  const early = fixedTime(onDst ? '1:40' : '1:20',
    { label: onDst ? 'the opening מנחה while the clocks are forward' : 'the opening מנחה while the clocks are back' });

  /* Rounded **up** here, where almost every other column on these boards rounds down. That
     is what the workbook does on this one cell, and it is exactly the sort of thing a reader
     comes to this page to find, so it is recorded rather than described. */
  const roundsUp = 'rounded up, which this column does and almost no other does';
  const main = zman('שקיעה', sunsetVal, 'on the שבת').minus(45).ceil(roundsUp)
    .earlierOf(clockTime(19, 0), 'never later than 7:00');
  const late = zman('שקיעה', sunsetVal, 'on the שבת').minus(30).ceil(roundsUp)
    .earlierOf(clockTime(19, 30), 'never later than 7:30').underline();

  if (DRASHA_NAMES.includes(specialParsha)) {
    /* Both worked from the מנחה 45 minutes before שקיעה rather than from שקיעה itself,
       because that is the מנין the דרשה is timed against. To the nearest five, since this is
       a time the shul is told to come at and 5:14 is not one.
       The דרשה carries no underline: the underline on these boards means downstairs, and a
       speech is not somewhere to daven. The מנחה above it is underlined, because that one is. */
    const drasha = main.minus(60, 'an hour before the מנחה it belongs to')
      .roundToStep(5, 'said as a round time, the shul being told to come at it');
    const minchaLmata = drasha.minus(30, 'half an hour before the דרשה').underline();
    return {
      text: [
        `${early.text()}${SLASH}${minchaLmata.text()}`,
        isolate(`דרשה ${drasha.plain()}`),
        `${main.text()}${SLASH}${late.text()}`,
      ].join('\n'),
      times: [early, minchaLmata, drasha, main, late],
      note: 'שבת שובה and שבת הגדול carry the דרשה afternoon instead of the standing 5:30, 6:00 and 6:30.',
    };
  }

  /* 5:30, 6:00 and 6:30 are on the board only once שקיעה is late enough for them: each is
     kept when its own clock time is at or before שקיעה less an hour.

     The underline goes on before the condition, not after. onlyWhen hands back a value whose
     text is silenced when the condition fails, and anything chained after that would be
     built from the unsilenced one underneath and quietly lose the condition again. */
  const standing = [[5, 30, 17, 30], [6, 0, 18, 0], [6, 30, 18, 30]].map(([h, m, gh, gm]) =>
    clockTime(h, m, 'one of the standing afternoon מנינים').underline()
      .onlyWhen(T(gh, gm) <= sunsetVal - 1 / 24, 'printed once שקיעה is at least an hour after it'));

  const times = [early, ...standing.filter((t) => t.held), main, late];
  return {
    text: splitLinesInHalf(flattenNonEmpty(times.map((t) => t.text()))),
    times,
    dropped: standing.filter((t) => !t.held),
  };
}
export function shabbosMinchaMenu(shabbosDate, settings, specialParsha = '') {
  return shabbosMinchaParts(shabbosDate, settings, specialParsha).text;
}
function floorMin(x) {
  return Math.floor(x * 1440 + 1e-7) / 1440;
}

/* The four cells below each come in two forms: a `...Parts` function that is the one
   implementation, returning the printed text together with the traced times that made it,
   and the plain function the charts have always called, which is now a one line wrapper
   round it. One computation, two ways of asking, so the calculations page cannot describe a
   time the board did not print. See zmanim/trace.js. */

/** Fixed Shacharis line (קיץ column E / חורף column E) - identical, not date-dependent.
 *  Uses NBSP around the "/" so it can never wrap onto a second line. */
export function shacharisParts() {
  /* Nothing here is worked out: the shul davens at half past seven and quarter past eight
     and that is the whole rule. Still traced, so the page can say so in as many words
     rather than leaving the one column that is not calculated looking unexplained. */
  const early = clockTime(7, 30, 'the שחרית the shul davens every שבת').underline();
  const later = fixedTime('8:15', { am: true, label: 'the second שחרית' });
  return { text: `${early.text()}${SLASH}${later.text()}`, times: [early, later] };
}
export function shacharisLine() {
  return shacharisParts().text;
}

/** Candle lighting + sunset (קיץ column H / חורף column H) - identical formula. */
export function candleLightingParts(fridayDate, settings) {
  /* שקיעה is put down to the whole minute first and the candle lighting is taken off that
     rounded value, not off the true one, which is why the floor comes before the minus. */
  const shkia = zman('שקיעה', Z.sunsetElev(fridayDate, settings), "on the Friday, at the shul's elevation").floor();
  const candles = shkia.minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings, which moves every Friday on every chart with it');
  return {
    text: `${candles.text()}\nשקיעה${NBSP}${shkia.text()}`,
    times: [candles, shkia],
  };
}
export function candleLightingCell(fridayDate, settings) {
  return candleLightingParts(fridayDate, settings).text;
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

/** Motzei Shabbos when Tisha B'Av begins that evening, including a postponed fast.
 * Use actual sunset plus 72 minutes before rounding any displayed times. */
export function tishaBavMaariv(serial, settings) {
  const shabbosDate = dateFromSerial(serial);
  const hd = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  if (shabbosDate.getUTCDay() !== 6 || hd.month !== 5 || ![8, 9].includes(hd.dayOfMonth)) return null;
  const sunset = Z.sunset(shabbosDate, settings);
  const seventyTwo = sunset + 72 / 1440;
  const downFive = value => Math.floor((value * 1440 + 1e-7) / 5) * 5 / 1440;
  const drasha = downFive(seventyTwo - 35 / 1440);
  const maariv = downFive(seventyTwo + 15 / 1440);
  return [
    'שקיעה ' + formatTime(ceilToMinute(sunset)),
    'דרשה ' + formatTime(drasha),
    'זמן 72 ' + formatTime(ceilToMinute(seventyTwo)),
    'מעריב ' + formatTime(maariv),
  ].join('\n');
}

