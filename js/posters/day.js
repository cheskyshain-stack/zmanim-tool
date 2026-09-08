// The days the sheets on the wall speak for, and what is davening on them.
//
// Sixteen days a year the schedule is not on either chart: ערב ר"ה, the two days of ר"ה, צום
// גדליה, ערב יו"כ and יו"כ, and then ערב סוכות through שמחת תורה. On those days the shul hangs
// a sheet, and the charts carry the ordinary weekday row for the week they fall in. "What is
// on next" on the congregation's home page was reading that row and offering it: on יום כיפור
// it said מנחה 1:15 where the sheet on the wall says 4:15, and on the second day of ר"ה it
// said 1:35 where the sheet says 5:15. Wrong on the days it matters most, and wrong
// confidently, which is worse.
//
// So the poster is asked first. Each of the builders gathers its own מנינים as it works the
// sheet out, off the same numbers the printed lines are made of (see posters/minyanim.js), and
// this file is only the question "which of them is on this day".
//
// A day is taken over here only where the sheet is the whole of it: שחרית, מנחה and מעריב all
// on the one sheet. The morning after יו"כ is not one of them, though its sheet prints a
// שחרית: that day's מנחה and מעריב are on the Weekday chart and nowhere else, and the chart
// already carries the whole of that stretch. Nor is שבת שובה, whose מנחה the poster reads off
// the chart to begin with. Half a day taken over would be a card with a morning on it and
// nothing after.
//
// The סוכות sheet answers for its own Shabbosos too, and those are the one place it and the
// charts overlap: the sheet works them off the שבת חורף chart's own columns, so what it hands
// over is the chart's answer with the two lines the chart has no column for added. Every other
// day it covers is one the charts do not have.
import { roshHashana, hebrewDateExtended, specialDaysInWeek } from '../hebrew-calendar.js';
import { buildRoshHashanaPoster } from './roshhashana.js';
import { buildYomKippurPoster } from './yomkippur.js';
import { buildTzomGedaliaPoster } from './tzomgedalia.js';
import { buildSukkosPoster } from './sukkos.js';
import { slichosMornings, slichosWeekLines } from './slichos.js';
import { minyanList, MORNING } from './minyanim.js';
import { DAY_NAMES, differsFromSchedule } from '../util.js';

/** How far either side of ר"ה a whole day can be taken over: ערב ר"ה is the day before, and
 *  the last day the סוכות sheet speaks for is שבת בראשית on 24 תשרי, which is 23 days after.
 *  Every day outside that answers in one calendar call and builds nothing, which matters
 *  because this is asked of eight days in a row every time the home page draws its card. */
const BEFORE = 1;
const AFTER = 23;

/** How far back the סליחות season can start. They begin on a Sunday and run at least four
 *  days, and in a year where that would be too few they begin the Sunday before that, which
 *  at the furthest is fifteen days before ר"ה. Sixteen, to have a day in hand. */
const SEASON_BEFORE = 16;

/** The sheets for one year, built once.
 *
 *  nextMinyan walks up to eight days looking for the next one, and inside the yomim noraim
 *  most of those days are covered here, so without this the same sheets would be built eight
 *  times over on a phone. Keyed on the settings object as well as the year: Settings moves
 *  candle lighting and the horizon, and a stale sheet would be worse than a slow one. */
let built = null;
function sheetsFor(year, settings) {
  if (built && built.year === year && built.settings === settings) return built.list;
  const list = [];
  for (const build of [buildRoshHashanaPoster, buildYomKippurPoster, buildTzomGedaliaPoster, buildSukkosPoster]) {
    let poster = null;
    // A sheet that will not build must not take the home page's card down with it. The card
    // then falls back to the charts, which is where it was before any of this.
    try { poster = build(year, settings); } catch { poster = null; }
    if (poster?.minyanim) list.push(...poster.minyanim);
  }
  built = { year, settings, list };
  return list;
}

/** Every מנין on one day that comes off a sheet rather than off a chart, earliest first.
 *
 *  Empty on every other day of the year, which is the signal to the caller that the charts
 *  are the answer.
 *
 *  Two years are tried because ערב ר"ה is the day before the year turns over: its own Hebrew
 *  year is the old one, and the sheet it is on belongs to the new. */
export function specialMinyanim(serial, settings) {
  const here = hebrewDateExtended(serial, settings.useGregorianBefore1582).year;
  for (const year of [here, here + 1]) {
    const rh = roshHashana(year - 3761);
    if (serial < rh - BEFORE || serial > rh + AFTER) continue;
    const found = sheetsFor(year, settings).filter((m) => m.serial === serial);
    if (found.length) return found.slice().sort((a, b) => a.mins - b.mins);
  }
  return [];
}

/** The סליחות season's mornings, day by day, built once for a year. Same reasoning as
 *  sheetsFor above: this is asked of eight days in a row and the answer does not move. */
let mornings = null;
function morningsFor(year, settings) {
  if (mornings && mornings.year === year && mornings.settings === settings) return mornings.list;
  const M = minyanList();
  try {
    for (const day of slichosMornings(year)) M.list(day.serial, day.name, day.times, MORNING);
  } catch {
    // Same as above: a sheet that will not build leaves the charts answering, which is where
    // this was before any of it.
  }
  mornings = { year, settings, list: M.out };
  return mornings.list;
}

/** The morning schedule for one day of the סליחות season, or nothing.
 *
 *  Half a day rather than a whole one, and deliberately: through אלול and עשרת ימי תשובה the
 *  שחרית on the sheet is not the everyday one out of Settings (סליחות are said and the מנין
 *  starts earlier), while the מנחה and מעריב of those days are ordinary and are on the
 *  Weekday chart. So this stands in for the morning and the chart answers for the rest of
 *  the day, where specialMinyanim above hands the whole day over.
 *
 *  Never for a day specialMinyanim already covers: slichosMornings leaves out ערב ר"ה, צום
 *  גדליה and ערב יו"כ for exactly that reason, and the two days of ר"ה and יו"כ are not in
 *  its range at all. */
export function specialShacharis(serial, settings) {
  const here = hebrewDateExtended(serial, settings.useGregorianBefore1582).year;
  for (const year of [here, here + 1]) {
    const rh = roshHashana(year - 3761);
    if (serial < rh - SEASON_BEFORE || serial > rh + AFTER) continue;
    const found = morningsFor(year, settings).filter((m) => m.serial === serial);
    if (found.length) return found.slice().sort((a, b) => a.mins - b.mins);
  }
  return [];
}

/** The mornings of one week's חול block, and whether the everyday שחרית still belongs on it.
 *
 *  Two views draw this block, the week card and the week's One sheet, and they were working
 *  the same three things out separately. The pieces are handed back rather than the finished
 *  lines, because the two do not set them in the same order or label them the same way; what
 *  they must not do is disagree about which mornings there are.
 *
 *  The everyday שחרית is the list out of Settings, and it stands only while some weekday of
 *  the week is actually davening it. Through the ימים נוראים it often is not: measured on
 *  תשפ״ז, the week of שבת שובה has צום גדליה on the Monday and סליחות on all four of the days
 *  after it, and its Sunday is יום ב' ראש השנה, which the sheet on the wall speaks for. Every
 *  morning of that week was already on the card under its own name, and the everyday 7:00
 *  through 8:40 was printed above them as though it were the rule, which nobody davens that
 *  week. So the line comes off when nothing is left for it.
 *
 *  A day counts as spoken for three ways: a סליחות line covers it, a line of its own covers it
 *  (a fast, or the ר"ח and בה"ב list), or a sheet on the wall has taken the whole day over,
 *  which is specialMinyanim above and is what the two days of ר"ה and יו"כ are.
 *
 *  Only the lines that are really drawn count: the ר"ח and בה"ב days are covered only where
 *  there is a second list in Settings to print. That test lives here rather than in the two
 *  views, so what is counted and what is drawn cannot come apart.
 *
 *  Once the season has said anything at all about a week, it says all of it. The first day of
 *  סליחות has none in the morning and davens the ordinary list, so its line reads the same as
 *  the everyday one; that line used to be dropped as a repeat, which left its day unspoken for
 *  and put the everyday list back at the head of the block with no day on it. On the week of
 *  ר"ה תשפ״ז that read as "שחרית 7:00 ... " over two סליחות lines, as though the week ran on
 *  those times and the סליחות were the exception, where it is the other way round. Kept, it is
 *  the same times under the day they belong to. The whole season comes off only where it says
 *  nothing the everyday list does not, which is a week nobody would call a סליחות week. */
export function weekdayMornings(shabbosSerial, settings, everyday, special) {
  const lines = slichosWeekLines(shabbosSerial, settings);
  const season = lines.some((g) => differsFromSchedule(g.html, everyday)) ? lines : [];
  const days = specialDaysInWeek(shabbosSerial, settings);
  const fasts = days.filter((d) => d.fast);
  const rest = days.filter((d) => !d.fast);
  const others = rest.length && special ? rest : null;

  const covered = new Set();
  const mark = (list) => { for (const d of list) for (const name of d.split(', ')) covered.add(name); };
  mark(season.map((g) => g.day));
  mark(fasts.map((d) => d.day));
  if (others) mark(others.map((d) => d.day));
  // offset 6 is the Sunday of that week and offset 1 the Friday, the same walk
  // specialDaysInWeek makes.
  for (let offset = 6; offset >= 1; offset -= 1) {
    if (specialMinyanim(shabbosSerial - offset, settings).length) covered.add(DAY_NAMES[6 - offset]);
  }
  return {
    season,
    fasts,
    others,
    everydayStands: DAY_NAMES.slice(0, 6).some((d) => !covered.has(d)),
  };
}
