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

/** Balance winter thirds, putting an extra week in the middle first: 28 is 9/10/9.
 *  The explicitly chosen three-page summer layout keeps its shorter first page.
 *  Other page counts use an even split with the remainder on the earlier pages. */
export function defaultPageSizes(total, numPages, season) {
  if (numPages === 3 && season === 'choref') {
    const base = Math.floor(total / 3), remainder = total % 3;
    return [base + (remainder === 2 ? 1 : 0), base + (remainder ? 1 : 0), base];
  }
  if (numPages === 3 && season === 'kayitz') {
    const full = Math.ceil(total / 3);
    const short = total - full * 2;
    return [short, full, full];
  }
  const base = Math.floor(total / numPages);
  const rem = total % numPages;
  return Array.from({ length: numPages }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Keep every Chanukah week on one part, including its Sunday-Friday weekday rows.
 *  Compare both safe sides of Chanukah and rebalance the remaining parts. Prefer
 *  the most even result, breaking ties before the holiday. */
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
    const remainingParts = numPages - i;
    const candidates = [first, last + 1].filter(value => value > cuts[i - 1] && weeks.length - value >= remainingParts)
      .map(next => {
        const adjusted = cuts.slice();
        adjusted[i] = next;
        const tail = defaultPageSizes(weeks.length - next, remainingParts, season);
        for (let j = 0; j < tail.length; j++) adjusted[i + j + 1] = adjusted[i + j] + tail[j];
        const counts = adjusted.slice(1).map((value, index) => value - adjusted[index]);
        return { cuts: adjusted, next, spread: Math.max(...counts) - Math.min(...counts), squares: counts.reduce((sum, n) => sum + n * n, 0) };
      });
    candidates.sort((a, b) => a.spread - b.spread || a.squares - b.squares || a.next - b.next);
    if (candidates.length) cuts.splice(0, cuts.length, ...candidates[0].cuts);
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
