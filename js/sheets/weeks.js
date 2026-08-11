// Season-boundary + week-list logic: auto-computes which Shabbosim belong on a
// Kayitz (summer) or Choref (winter) sheet for a given Hebrew year, mirroring the
// workbook's own P5 formula (SEQUENCE + FILTER on HAS_PARSHA<>"") but without
// requiring a manually-entered start date or week count.
import { dateFromHebrew, hasParsha, hasSpecialParsha, hasYomTov, isYomTovOrCholHamoed, hebrewDateExtended, excelWeekday } from '../hebrew-calendar.js';
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

function isCholHamoedAnchor(day, settings, specialDaysTable) {
  return /Chol Hamoed|חול המועד|Hoshana Rabbah|הושענה רבה/.test(hasYomTov(day, settings, specialDaysTable));
}

function anyRegularDay(fromSerial, toSerial, settings, specialDaysTable) {
  for (let day = fromSerial; day <= toSerial; day++) {
    if (!isYomTovOrCholHamoed(day, settings, specialDaysTable)) return true;
  }
  return false;
}

/** "Chol Hamoed Pesach" / "חול המועד סוכות" / "Hoshana Rabbah" -> the plain holiday
 *  name ("Pesach" / "סוכות" / "סוכות") — see the Chol Hamoed row below, which reuses
 *  whatever this Shabbos's own hasYomTov() name is but without the "Chol Hamoed"/
 *  "Hoshana Rabbah" framing, since the row is standing in for the holiday as a whole. */
function holidayNameFor(day, settings, specialDaysTable) {
  const name = hasYomTov(day, settings, specialDaysTable);
  if (/^(Hoshana Rabbah|הושענה רבה)$/.test(name)) return /[֐-׿]/.test(name) ? 'סוכות' : 'Succos';
  return name.replace(/^(Chol Hamoed |חול המועד )/, '');
}

/** Week list for a Weekday chart covering the same season date range as
 *  computeSeasonWeeks, but with a different inclusion rule: a week is included as long
 *  as at least one of its Sun-Fri days (the days a Weekday chart actually schedules) is
 *  a normal day — not Yom Tov, not Chol Hamoed. That's a superset of the Shabbos
 *  chart's own week list: a week whose Shabbos falls on Yom Tov (and so has no parsha,
 *  excluded from computeSeasonWeeks) can still need a Weekday-chart row if, say, only
 *  Thursday and Friday of that week are Yom Tov and the rest are regular days.
 *  Each week is still anchored to its Shabbos `serial` (Saturday) for consistency with
 *  the Shabbos weeks list; `parsha` falls back to that Shabbos's own Yom Tov name (e.g.
 *  "ראש השנה") when there's no regular parsha to label the row with.
 *
 *  Season boundaries (Pesach/Sukkos) essentially never line up with the fixed 7-day
 *  Saturday spacing this loop walks in, which leaves a "leftover" stretch of up to 6
 *  regular days between the last Saturday-anchored week and the boundary itself (e.g.
 *  the days between שבת הגדול and ליל פסח) — see the trailing-gap check after the main
 *  loop, which folds that stretch onto *this* (the outgoing/earlier) season as one more
 *  row, per "a week that falls between two charts belongs on the earlier one".
 *
 *  A Saturday that lands ON Chol Hamoed/Hoshana Rabbah (e.g. Shabbos Chol Hamoed Pesach)
 *  is excluded from becoming its own row in the *incoming* season's own loop above (its
 *  backward window would otherwise mix genuine pre-Yom-Tov regular days, already
 *  claimed by the outgoing chart's trailing row, together with actual Chol Hamoed days)
 *  — but it isn't dropped: the trailing-Chol-Hamoed check right after also folds it onto
 *  the *outgoing* chart as one more row, labeled with the holiday's plain name (Pesach's
 *  own Chol Hamoed row lands on the חורף chart; Sukkos's on the קיץ chart). */
export function computeWeekdayWeeks(season, hebrewYear, settings, tables) {
  const startSerial = seasonStartSerial(season, hebrewYear);
  const endSerial = seasonEndSerial(season, hebrewYear);

  let d = Math.ceil(startSerial);
  while (excelWeekday(d) !== 7) d++;

  const weeks = [];
  let guard = 0;
  while (d <= endSerial && guard < MAX_WEEKS) {
    // d === startSerial: the season's own start boundary landed exactly on Shabbos
    // (e.g. Sukkos falling on a Saturday) — its backward-attached weekdays are still
    // within the *outgoing* season's territory, already covered by its own trailing-gap
    // row below. Without this, both seasons would independently print an identical row.
    const isOwnStartBoundary = d === startSerial;
    if (!isOwnStartBoundary && !isCholHamoedAnchor(d, settings, tables.specialDays) && anyRegularDay(d - 6, d - 1, settings, tables.specialDays)) {
      const parsha = hasParsha(d, settings, tables) || hasYomTov(d, settings, tables.specialDays);
      weeks.push({ serial: d, date: dateFromSerial(d), parsha, specialParsha: hasSpecialParsha(d, settings) });
    }
    d += 7;
    guard++;
  }

  // Trailing gap: the regular days (if any) between the last Saturday-anchored week
  // above and the season's own end boundary — see the function comment. Anchored at
  // endSerial itself (not a real Shabbos, just a stand-in date/key for this row) and
  // labeled with whatever Yom Tov starts there, same fallback as any other
  // Yom-Tov-only row above. When the boundary itself was exactly Shabbos, the main loop
  // already picked it up directly and this gap comes out empty — no double-counting.
  const gapStart = d - 7 + 1;
  const gapEnd = endSerial - 1;
  if (gapStart <= gapEnd && anyRegularDay(gapStart, gapEnd, settings, tables.specialDays)) {
    const parsha = hasParsha(endSerial, settings, tables) || hasYomTov(endSerial, settings, tables.specialDays);
    weeks.push({ serial: endSerial, date: dateFromSerial(endSerial), parsha, specialParsha: hasSpecialParsha(endSerial, settings) });
  }

  // `d` is now the first Saturday *after* the boundary (Saturdays fall on the same
  // fixed 7-day cadence no matter which season's math found them, so this is exactly
  // the same date the incoming season's own loop would land on as its own first
  // candidate) — see the function comment for why a Chol-Hamoed/Hoshana-Rabbah Shabbos
  // there becomes a row here instead of there. It's folded into the trailing-gap row
  // above rather than added separately whenever that row already carries the same
  // holiday's name: the two stretches are the run-up to, and the middle of, one single
  // Yom Tov, so the chart should carry one row for it, not a pair of identical ones.
  const cholHamoedName = isCholHamoedAnchor(d, settings, tables.specialDays) ? holidayNameFor(d, settings, tables.specialDays) : '';
  if (cholHamoedName && weeks[weeks.length - 1]?.parsha !== cholHamoedName) {
    weeks.push({ serial: d, date: dateFromSerial(d), parsha: cholHamoedName, specialParsha: '' });
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
