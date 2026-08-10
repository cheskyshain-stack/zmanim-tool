// Splits a generated week list across 3 printable pages by user-chosen counts.
export function validatePageSizes(total, sizes) {
  const sum = sizes.reduce((a, b) => a + (Number(b) || 0), 0);
  if (sum !== total) return `Page sizes add up to ${sum}, but there are ${total} weeks. They must add up to exactly ${total}.`;
  if (sizes.some((s) => Number(s) < 0)) return 'Page sizes cannot be negative.';
  return null;
}

/** Even 3-way default split (last page absorbs the remainder), used to pre-fill the
 *  page-size inputs before the user adjusts them. */
export function defaultPageSizes(total) {
  const base = Math.floor(total / 3);
  const rem = total % 3;
  return [base + (rem > 0 ? 1 : 0), base + (rem > 1 ? 1 : 0), base];
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
