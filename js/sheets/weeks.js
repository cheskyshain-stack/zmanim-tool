// Season-boundary + week-list logic: auto-computes which Shabbosim belong on a
// Kayitz (summer) or Choref (winter) sheet for a given Hebrew year, mirroring the
// workbook's own P5 formula (SEQUENCE + FILTER on HAS_PARSHA<>"") but without
// requiring a manually-entered start date or week count.
import { dateFromHebrew, hasParsha, hasSpecialParsha, hebrewDateExtended, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial, excelSerial } from '../zmanim/solar.js';
import { inSpringDstWindow } from './common.js';

const MAX_WEEKS = 60; // safety cap, well above any real season's length

/** Season(hebrewYear) date-range boundaries — Kayitz(Y): Pesach(Y) -> Sukkos(Y+1);
 *  Choref(Y): Sukkos(Y) -> Pesach(Y), both within AM year Y. Factored out of
 *  computeSeasonWeeks so the "which year is next" helpers below can use the same
 *  boundaries without needing a parsha table. */
function seasonStartSerial(season, hebrewYear) {
  return season === 'kayitz' ? dateFromHebrew(15, 1, hebrewYear) : dateFromHebrew(15, 7, hebrewYear);
}
function seasonEndSerial(season, hebrewYear) {
  return season === 'kayitz' ? dateFromHebrew(15, 7, hebrewYear + 1) : dateFromHebrew(15, 1, hebrewYear);
}

/**
 * @param {'kayitz'|'choref'} season
 * @param {number} hebrewYear AM year anchoring the season (see README for the exact
 *   convention: Kayitz(Y) runs Pesach(Y) -> Sukkos(Y+1); Choref(Y) runs Sukkos(Y) -> Pesach(Y), both within AM year Y)
 * @param {object} settings
 * @param {object} tables {parshaChutz, parshaEY, parshaNames}
 * @returns {{startSerial:number, endSerial:number, weeks: Array<{serial:number,date:Date,parsha:string,specialParsha:string}>}}
 */
export function computeSeasonWeeks(season, hebrewYear, settings, tables) {
  const startSerial = seasonStartSerial(season, hebrewYear);
  const endSerial = seasonEndSerial(season, hebrewYear);

  let d = Math.ceil(startSerial);
  while (excelWeekday(d) !== 7) d++;

  const weeks = [];
  let guard = 0;
  while (d <= endSerial && guard < MAX_WEEKS) {
    const parsha = hasParsha(d, settings, tables);
    if (parsha) {
      weeks.push({ serial: d, date: dateFromSerial(d), parsha, specialParsha: hasSpecialParsha(d, settings) });
    }
    d += 7;
    guard++;
  }
  return { startSerial, endSerial, weeks };
}

/** Where a שבת חורף season's weeks cross the *spring* DST cutover (2nd Sunday of
 *  March — not the fall one near Sukkos at the season's start). From that week on,
 *  the season needs an actual שבת קיץ chart (not just a couple of extra columns) —
 *  the shul still davens on a "summer" schedule through Pesach once the clock springs
 *  forward. Returns the index in `weeks` of the first week on/after the cutover
 *  (weeks.length if the whole season is still before it — shouldn't happen in
 *  practice, since Pesach always falls after the 2nd Sunday of March). */
export function splitChorefAtSpringCutover(weeks, settings) {
  const idx = weeks.findIndex((w) => inSpringDstWindow(w.date, settings));
  return idx === -1 ? weeks.length : idx;
}

/** The smallest hebrewYear for `season` whose date range hasn't already fully elapsed
 *  (its end is still today or later) — i.e. the soonest occurrence of that season still
 *  worth preparing a schedule for. Used to keep the Generate form's year field from
 *  ever defaulting to an already-passed season. */
export function nextAvailableYearFor(season, settings) {
  const today = excelSerial(new Date());
  let y = hebrewDateExtended(today, settings.useGregorianBefore1582).year - 1; // step back one to not overshoot a season that started in a lower-numbered year
  for (let i = 0; i < 6 && seasonEndSerial(season, y) < today; i++) y++;
  return y;
}

/** Which season+year the Generate form should default to: the *next* season
 *  chronologically after whichever one contains today — a schedule is always being
 *  prepared ahead of time for the upcoming season, not the one currently in progress.
 *  E.g. if today falls within a קיץ season, default to the חורף season right after it
 *  (never the קיץ season itself, and never a season that's already over). */
export function defaultSeasonAndYear(settings) {
  const today = excelSerial(new Date());
  const y0 = hebrewDateExtended(today, settings.useGregorianBefore1582).year;
  const sukkosY0 = dateFromHebrew(15, 7, y0);
  const pesachY0 = dateFromHebrew(15, 1, y0);
  const sukkosY0plus1 = dateFromHebrew(15, 7, y0 + 1);

  let currentSeason, currentYear;
  if (today < sukkosY0) {
    currentSeason = 'kayitz';
    currentYear = y0 - 1; // still in last cycle's קיץ — Sukkos(y0) hasn't happened yet
  } else if (today < pesachY0) {
    currentSeason = 'choref';
    currentYear = y0;
  } else if (today < sukkosY0plus1) {
    currentSeason = 'kayitz';
    currentYear = y0;
  } else {
    currentSeason = 'choref';
    currentYear = y0 + 1;
  }

  return currentSeason === 'choref' ? { season: 'kayitz', hebrewYear: currentYear } : { season: 'choref', hebrewYear: currentYear + 1 };
}
