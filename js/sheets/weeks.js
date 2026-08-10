// Season-boundary + week-list logic: auto-computes which Shabbosim belong on a
// Kayitz (summer) or Choref (winter) sheet for a given Hebrew year, mirroring the
// workbook's own P5 formula (SEQUENCE + FILTER on HAS_PARSHA<>"") but without
// requiring a manually-entered start date or week count.
import { dateFromHebrew, hasParsha, hasSpecialParsha, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';

const MAX_WEEKS = 60; // safety cap, well above any real season's length

/**
 * @param {'kayitz'|'choref'} season
 * @param {number} hebrewYear AM year anchoring the season (see README for the exact
 *   convention: Kayitz(Y) runs Pesach(Y) -> Sukkos(Y+1); Choref(Y) runs Sukkos(Y) -> Pesach(Y), both within AM year Y)
 * @param {object} settings
 * @param {object} tables {parshaChutz, parshaEY, parshaNames}
 * @returns {{startSerial:number, endSerial:number, weeks: Array<{serial:number,date:Date,parsha:string,specialParsha:string}>}}
 */
export function computeSeasonWeeks(season, hebrewYear, settings, tables) {
  let startSerial, endSerial;
  if (season === 'kayitz') {
    startSerial = dateFromHebrew(15, 1, hebrewYear); // Pesach
    endSerial = dateFromHebrew(15, 7, hebrewYear + 1); // next Sukkos
  } else {
    startSerial = dateFromHebrew(15, 7, hebrewYear); // Sukkos
    endSerial = dateFromHebrew(15, 1, hebrewYear); // Pesach later the same AM year
  }

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
