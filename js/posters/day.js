// The days the sheets on the wall speak for, and what is davening on them.
//
// Six days a year the schedule is not on either chart: ערב ר"ה, the two days of ר"ה, צום
// גדליה, ערב יו"כ and יו"כ. On those days the shul hangs a sheet, and the charts carry the
// ordinary weekday row for the week they fall in. "What is on next" on the congregation's
// home page was reading that row and offering it: on יום כיפור it said מנחה 1:15 where the
// sheet on the wall says 4:15, and on the second day of ר"ה it said 1:35 where the sheet says
// 5:15. Wrong on the days it matters most, and wrong confidently, which is worse.
//
// So the poster is asked first. Each of the three builders gathers its own מנינים as it works
// the sheet out, off the same numbers the printed lines are made of (see posters/minyanim.js),
// and this file is only the question "which of them is on this day".
//
// Six days and no more. A day is taken over here only where the sheet is the whole of it:
// שחרית, מנחה and מעריב all on the one sheet. The morning after יו"כ is not one of them,
// though its sheet prints a שחרית: that day's מנחה and מעריב are on the Weekday chart and
// nowhere else, and the chart already carries the whole of that stretch. Nor is שבת שובה,
// whose מנחה the poster reads off the chart to begin with. Half a day taken over would be a
// card with a morning on it and nothing after.
import { roshHashana, hebrewDateExtended } from '../hebrew-calendar.js';
import { buildRoshHashanaPoster } from './roshhashana.js';
import { buildYomKippurPoster } from './yomkippur.js';
import { buildTzomGedaliaPoster } from './tzomgedalia.js';
import { slichosMornings } from './slichos.js';
import { minyanList, MORNING } from './minyanim.js';

/** How far either side of ר"ה a whole day can be taken over: ערב ר"ה is the day before, and
 *  the morning after יו"כ is 10 days after. Every day outside that answers in one calendar
 *  call and builds nothing, which matters because this is asked of eight days in a row every
 *  time the home page draws its card. */
const BEFORE = 1;
const AFTER = 10;

/** How far back the סליחות season can start. They begin on a Sunday and run at least four
 *  days, and in a year where that would be too few they begin the Sunday before that, which
 *  at the furthest is fifteen days before ר"ה. Sixteen, to have a day in hand. */
const SEASON_BEFORE = 16;

/** The three sheets for one year, built once.
 *
 *  nextMinyan walks up to eight days looking for the next one, and inside the yomim noraim
 *  most of those days are covered here, so without this the same three sheets would be built
 *  eight times over on a phone. Keyed on the settings object as well as the year: Settings
 *  moves candle lighting and the horizon, and a stale sheet would be worse than a slow one. */
let built = null;
function sheetsFor(year, settings) {
  if (built && built.year === year && built.settings === settings) return built.list;
  const list = [];
  for (const build of [buildRoshHashanaPoster, buildYomKippurPoster, buildTzomGedaliaPoster]) {
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
