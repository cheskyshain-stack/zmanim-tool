// Small Excel-semantics helpers shared by the sheet column ports.

// Non-breaking space: used in every "/"-joined time list so the browser can never wrap
// mid-pair (e.g. "7:30 / 8:15" splitting into "7:30 /" + "8:15") when a column is
// narrow - only the sheet's own explicit \n line breaks should ever create a new line.
export const NBSP = ' ';
export const SLASH = `${NBSP}/${NBSP}`;

export function textjoin(delim, ignoreEmpty, parts) {
  const flat = [];
  for (const p of parts) {
    if (Array.isArray(p)) flat.push(...p);
    else flat.push(p);
  }
  const filtered = ignoreEmpty ? flat.filter((x) => x !== '' && x != null) : flat;
  return filtered.join(delim);
}
export function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

/** Flattens arrays (e.g. HSTACK-style pairs) and drops empty/blank entries. */
export function flattenNonEmpty(parts) {
  const flat = [];
  for (const p of parts) {
    if (Array.isArray(p)) flat.push(...p);
    else flat.push(p);
  }
  return flat.filter((x) => x !== '' && x != null);
}

/** Splits a list of time options across two printed lines, first line getting the
 *  smaller half when the count is odd (4 -> 2+2, 5 -> 2+3, 6 -> 3+3, ...). */
export function splitLinesInHalf(items, delim = SLASH) {
  const cut = Math.floor(items.length / 2);
  const line1 = items.slice(0, cut).join(delim);
  const line2 = items.slice(cut).join(delim);
  return [line1, line2].filter(Boolean).join('\n');
}
