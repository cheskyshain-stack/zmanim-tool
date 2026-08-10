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

export function splitWeeksIntoPages(weeks, sizes) {
  const pages = [];
  let i = 0;
  for (const size of sizes) {
    pages.push(weeks.slice(i, i + size));
    i += size;
  }
  return pages;
}
