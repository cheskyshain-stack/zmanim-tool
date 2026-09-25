// Helpers shared between שבת קיץ and שבת חורף - both sheets use the exact same
// "day-of-year window" gate and the exact same Erev Shabbos main-Mincha menu formula.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { hebrewDateExtended, excelWeekday } from '../hebrew-calendar.js';
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

/** מנחה גדולה לחומרא, the latest it reaches Sunday through Friday of the calendar week
 *  `anchorSerial` falls in. Not assumed to be a Saturday itself: a Weekday chart's own
 *  trailing-gap and Chol Hamoed rows (see sheets/weeks.js) are anchored on a stand-in date
 *  instead of a real one, the same reason sheets/weekday.js's own sundayThroughThursday
 *  walks back to the Sunday rather than just subtracting a fixed number of days.
 *
 *  One answer for the whole week, asked once and used by both charts' early מנחה slots -
 *  sheets/weekday.js's own early מנחה and this file's Erev Shabbos one - so the two cannot
 *  look at two different windows and land on two different answers about days that sit
 *  right next to each other. */
export function weekLatestMinchaGedola(anchorSerial, settings) {
  const sunday = anchorSerial - (excelWeekday(anchorSerial) - 1);
  const days = [0, 1, 2, 3, 4, 5].map((i) => sunday + i);
  return Math.max(...days.map((d) => Z.minchaGedolaLechumra(dateFromSerial(d), settings)));
}

/** The Erev Shabbos "main" Mincha menu (קיץ column L / חורף column I) - identical
 *  formula in both sheets. Printed across two lines, split as evenly as possible
 *  (more options on the second line when the count is odd).
 *
 *  12:30 and 1:00 still read the clock: while the clocks are forward, nothing is offered
 *  before 1:35. That is the shul's rule and it is a deliberate departure from the
 *  workbook, which does not have it.
 *
 *  1:15/1:20 and 1:35/1:40 read מנחה גדולה instead, across the whole week (see
 *  weekLatestMinchaGedola), which is a change from how both used to be decided. 1:15 used
 *  to read the clock too, the same as 12:30 and 1:00, and that tied a fixed clock date to
 *  a זמן that moves with the sun: the first weeks of חורף are still on daylight saving,
 *  and through them מנחה גדולה sits just under 1:20 (measured across 5787's own five
 *  Fridays from 2 October to 30 October: 1:16, 1:15, 1:15, 1:15, 1:15), so the old rule lit
 *  a 1:15 in front of the 1:35 on a week nobody davens that early, and stayed dark once the
 *  clocks went back even on a week מנחה גדולה would have allowed it. And 1:35 used to creep
 *  with מנחה גדולה once past it, printing whatever odd minute that landed on and climbing
 *  week to week through a season; the shul asked for two round numbers instead, the same
 *  1:35/1:40 the weekday board already gives. */
export function fridayMainMinchaParts(fridayDate, settings, shabbosSerial) {
  const mglVal = Z.minchaGedolaLechumra(fridayDate, settings);
  const onStandardTime = !Z.dstLocal(fridayDate, settings);
  const mgl = () => zman('מנחה גדולה לחומרא', mglVal,
    'the later of מנחה גדולה, which is half a proportional hour after חצות, and חצות plus thirty clock minutes. Both move with חצות, so this walks through the season');
  /* Short, because the מנחה גדולה it is weighed against now explains itself. */
  const notBefore = 'a מנחה is never offered before it';

  const weekMgl = weekLatestMinchaGedola(shabbosSerial, settings);
  const weekMglText = formatTime(weekMgl);
  const sundayFriday = 'somewhere Sunday through Friday';

  /* The printed list is these values asked for their text, in this order, rather than a
     second list built alongside them. A trace and the time it explains cannot then be paired
     up wrongly, which juggling two arrays by index invites. */
  /* **Every candidate is built, including the ones this week does not print.**

     They used to be branched away to null, so a week on daylight saving simply had no 12:30
     and no 1:00 and the page had nothing to say about them. That is the same fault the shul
     found on the 1:35, one step further on: not a rule with a side missing but a מנין missing
     altogether. A time that is not offered this week is still part of what this column is,
     and it now says so and why, the way the שבת afternoon's 5:30, 6:00 and 6:30 already did.

     Silenced rather than removed: onlyWhen hands back a value whose text is empty, and both
     flattenNonEmpty and splitLinesInHalf drop empties, so the printed cell is unchanged. */
  const clocksBack = 'offered only while the clocks are back';
  const all = [
    /* The shul's own time first and מנחה גדולה weighed against it, not the other way round.
       Math.max is symmetric so the answer is the same, but the chain starts where the name
       does: this is the 12:30 מנין, held back on the weeks מנחה גדולה is later. Written the
       other way the page headed it 1:22 on such a week, which is not what anybody calls it. */
    clockTime(12, 30, 'the first of the earlier ערב שבת מנחה מנינים').laterOf(mgl(), notBefore).underline().onlyWhen(onStandardTime, clocksBack),
    clockTime(1, 0, 'one of the earlier ערב שבת מנחה מנינים').underline().onlyWhen(onStandardTime, clocksBack),
    /* 1:15, or 1:20 behind it if מנחה גדולה creeps past 1:15 anywhere in the week, or
       neither if it creeps past 1:20 too. Two fixed candidates, never an odd minute between
       them: the same choice sheets/weekday.js makes for its own early מנחה, against the
       same window. */
    clockTime(13, 15, 'the earlier of the two early ערב שבת מנחה מנינים').underline()
      .onlyWhen(weekMgl <= T(13, 15), `מנחה גדולה לחומרא reaching ${weekMglText} ${sundayFriday}, past 1:15`),
    clockTime(13, 20, 'the later of the two early ערב שבת מנחה מנינים, offered instead of 1:15').underline()
      .onlyWhen(weekMgl > T(13, 15) && weekMgl <= T(13, 20), `offered instead of 1:15, מנחה גדולה לחומרא reaching ${weekMglText} ${sundayFriday}`),
    /* 1:35 unless מנחה גדולה is too late for it anywhere in the week, in which case 1:40.
       Never anything else. */
    clockTime(13, 35, 'the earlier of the two main ערב שבת מנחה מנינים').underline()
      .onlyWhen(weekMgl <= T(13, 35), `מנחה גדולה לחומרא reaching ${weekMglText} ${sundayFriday}, past 1:35`),
    clockTime(13, 40, 'the later of the two main ערב שבת מנחה מנינים, offered instead of 1:35').underline()
      .onlyWhen(weekMgl > T(13, 35), `offered instead of 1:35, מנחה גדולה לחומרא reaching ${weekMglText} ${sundayFriday}`),
    fixedTime('1:50'),
    fixedTime('2:15'),
    fixedTime('3:00'),
  ];

  return {
    text: splitLinesInHalf(flattenNonEmpty(all.map((t) => t.text()))),
    times: all.filter((t) => t.held !== false),
    dropped: all.filter((t) => t.held === false),
    note: onStandardTime
      ? 'The clocks are back this week, so 12:30 and 1:00 are offered in front of the rest.'
      : 'The clocks are forward this week, so 12:30 and 1:00 are not offered. That is the shul\'s own rule and the workbook does not have it.',
  };
}
export function fridayMainMinchaMenu(fridayDate, settings, shabbosSerial) {
  return fridayMainMinchaParts(fridayDate, settings, shabbosSerial).text;
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
  /* Both values named, not only the one printed this week. A label that says "while the
     clocks are forward" and stops there leaves a reader thinking 1:40 is simply what this
     column says. */
  const early = fixedTime(onDst ? '1:40' : '1:20', {
    label: onDst
      ? 'the opening מנחה while the clocks are forward. Once they go back it is 1:20 instead'
      : 'the opening מנחה while the clocks are back. Once they go forward it is 1:40 instead',
  });

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

