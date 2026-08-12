// Splits a generated week list across however many printable pages the user chooses
// (3, 4, or any other count), by user-chosen per-page counts.
export function validatePageSizes(total, sizes) {
  const sum = sizes.reduce((a, b) => a + (Number(b) || 0), 0);
  if (sum !== total) return `Page sizes add up to ${sum}, but there are ${total} weeks. They must add up to exactly ${total}.`;
  if (sizes.some((s) => Number(s) < 0)) return 'Page sizes cannot be negative.';
  return null;
}

/** Even default split across `numPages` pages (earlier pages absorb the remainder one
 *  at a time), used to pre-fill the page-size inputs before the user adjusts them. */
export function defaultPageSizes(total, numPages) {
  const base = Math.floor(total / numPages);
  const rem = total % numPages;
  return Array.from({ length: numPages }, (_, i) => base + (i < rem ? 1 : 0));
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
