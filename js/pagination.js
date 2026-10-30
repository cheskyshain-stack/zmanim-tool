import { roshHashana, dateFromHebrew } from './hebrew-calendar.js';

/** Winter includes Adar's extra month; summer is always the usual length. */
export function defaultSeasonPageCount(season, hebrewYear) {
  const yearLength = roshHashana(hebrewYear - 3760) - roshHashana(hebrewYear - 3761);
  return season === 'choref' && yearLength > 365 ? 3 : 2;
}

// Splits a generated week list across the chosen number of printable pages.
export function validatePageSizes(total, sizes) {
  const sum = sizes.reduce((a, b) => a + (Number(b) || 0), 0);
  if (sum !== total) return `Page sizes add up to ${sum}, but there are ${total} weeks. They must add up to exactly ${total}.`;
  if (sizes.some((s) => Number(s) < 0)) return 'Page sizes cannot be negative.';
  return null;
}

/** Even default split across `numPages` pages, used to pre-fill the page-size inputs before
 *  the user adjusts them, and to size a season chart's pages when nobody has typed
 *  a custom split.
 *
 *  A season's three pages split unevenly on purpose when the weeks do not divide by three,
 *  and the short page sits at whichever end the shul asked for rather than being spread a
 *  week at a time across all three. A 28 week חורף season is 10, 10, 8: the last page is the
 *  short one. A 28 week קיץ season is the same three numbers reversed, 8, 10, 10, the first
 *  page short. Each is two full pages of `ceil(total / 3)` and one page of whatever is left,
 *  which is never more than two weeks shorter than a full page.
 *
 *  Only for a season's own three pages: `season` has to be 'kayitz' or 'choref' and
 *  `numPages` has to be exactly 3, or this falls back to the plain even split, remainder
 *  absorbed by the earlier pages one at a time, which is what any other page count uses. */
export function defaultPageSizes(total, numPages, season) {
  if (numPages === 3 && (season === 'kayitz' || season === 'choref')) {
    const full = Math.ceil(total / 3);
    const short = total - full * 2;
    return season === 'choref' ? [full, full, short] : [short, full, full];
  }
  const base = Math.floor(total / numPages);
  const rem = total % numPages;
  return Array.from({ length: numPages }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Keep every Chanukah week on one part, including its Sunday-Friday weekday rows.
 *  Move only the offending boundary. On an equal-distance choice, finish Chanukah
 *  on the earlier part. This takes priority over making the final part shortest. */
export function defaultSeasonPageSizes(weeks, season, hebrewYear, numPages = defaultSeasonPageCount(season, hebrewYear)) {
  const sizes = defaultPageSizes(weeks.length, numPages, season);
  if (season !== 'choref' || numPages < 2) return sizes;
  const firstDay = dateFromHebrew(25, 9, hebrewYear), lastDay = firstDay + 7;
  const protectedWeeks = weeks.map((week, index) => week.serial >= firstDay && week.serial - 6 <= lastDay ? index : -1)
    .filter(index => index >= 0);
  if (protectedWeeks.length < 2) return sizes;
  const first = protectedWeeks[0], last = protectedWeeks.at(-1);
  const cuts = [0];
  for (const size of sizes) cuts.push(cuts.at(-1) + size);
  for (let i = 1; i < cuts.length - 1; i++) {
    const cut = cuts[i];
    if (cut <= first || cut > last) continue;
    const candidates = [last + 1, first].filter(value => value > cuts[i - 1] && value < cuts[i + 1]);
    candidates.sort((a, b) => Math.abs(a - cut) - Math.abs(b - cut) || b - a);
    if (candidates.length) cuts[i] = candidates[0];
  }
  return cuts.slice(1).map((cut, index) => cut - cuts[index]);
}

/** Per-page counts that break `targetWeeks` at the same dates `sourceSizes` breaks
 *  `sourceWeeks` - so a Weekday chart's page 1 covers the same stretch of the year as
 *  its Shabbos sheet's page 1, even though the two lists aren't the same length (the
 *  Weekday one also carries Yom Tov weeks that have no parsha). A target week falling in
 *  the gap between two source pages lands on the earlier one, matching how the season
 *  boundaries themselves are assigned in sheets/weeks.js. */
export function alignPageSizesTo(sourceWeeks, sourceSizes, targetWeeks) {
  const cutoffs = []; // serial of the first source week on each page after the first
  let idx = 0;
  for (let i = 0; i < sourceSizes.length - 1; i++) {
    idx += Number(sourceSizes[i]) || 0;
    cutoffs.push(sourceWeeks[idx] ? sourceWeeks[idx].serial : Infinity);
  }
  const counts = new Array(sourceSizes.length).fill(0);
  for (const week of targetWeeks) {
    let page = 0;
    while (page < cutoffs.length && week.serial >= cutoffs[page]) page++;
    counts[page]++;
  }
  return counts;
}

export function splitWeeksIntoPages(weeks, sizes) {
  const pages = [];
  let i = 0;
  for (const size of sizes) {
    pages.push(weeks.slice(i, i + size));
    i += size;
  }
  return pages;
}
