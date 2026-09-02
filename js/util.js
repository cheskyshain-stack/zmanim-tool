// Small Excel-semantics helpers shared by the sheet column ports.

// Non-breaking space: used in every "/"-joined time list so the browser can never wrap
// mid-pair (e.g. "7:30 / 8:15" splitting into "7:30 /" + "8:15") when a column is
// narrow - only the sheet's own explicit \n line breaks should ever create a new line.
export const NBSP = ' ';
export const SLASH = `${NBSP}/${NBSP}`;

/* Around a Hebrew word that has to sit in a line of times, so the times after it keep their
   order. U+2066 LEFT-TO-RIGHT ISOLATE and U+2069 POP DIRECTIONAL ISOLATE, which is what a
   <bdi> does, in characters rather than markup: these strings are escaped on their way into
   a cell, so a tag would arrive as text, and they are also copied, exported and read back,
   where a tag would be wrong and these are simply invisible.

   Not a nicety. The שבת שובה cell is "דרשה 5:15 / 6:14 / 6:29", and without the isolate
   every number after the Hebrew word joins its run and the whole line reverses: measured on
   the chart, it came out on screen as "6:29 / 6:14 / 5:15 דרשה", the times in the wrong
   order on a board people read a time off. */
export const ISO_START = '\u2066';
export const ISO_END = '\u2069';
export const isolate = (text) => `${ISO_START}${text}${ISO_END}`;

/* The days of the week as the boards name them, Sunday first so it indexes straight off
   excelWeekday less one. Here rather than in either of the two files that want it, which
   had a copy each: the offline build flattens every module into one scope and two consts
   of the same name in it is a hard error, which is how the pair was found. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

/* ' lang="he"' for a string that is Hebrew, and nothing for one that is not, to be dropped
   straight into a template: `<p class="x"${hebrewLang(value)}>`.
 *
 * The documents declare themselves English (the congregation's) or Hebrew (the admin app),
 * and neither is true of every line inside them. Without this a screen reader says שחרית
 * in an English voice, letter by letter or as nonsense, which on the week's list is most of
 * the words on the page.
 *
 * It is asked of the string rather than written into the markup by hand because most of
 * these words are settings somebody types. The subtitle is Hebrew at this shul and could be
 * English at another, and a cell holds "פלג 6:48" one week and "6:48" the next. Marking the
 * element in the template would be a guess about the contents that is right today.
 *
 * A Latin letter anywhere means no, and that is the point of the rule rather than a
 * shortcut: the footer and the legend line read "All underlined מנינים will be...", one
 * Hebrew word in an English sentence, and calling that whole line Hebrew would be the
 * mistake this is meant to fix, only louder. Those keep no marking at all, which leaves one
 * word said in the wrong voice instead of a sentence. Marking the word itself means wrapping
 * runs mid-string, and those two strings are rich text that carries the underline markup the
 * boards are printed with, so it is not worth the risk to that for one word.
 *
 * Digits and punctuation are neither way and are ignored: a time beside a Hebrew word does
 * not stop the word being Hebrew. */
const HEBREW_LETTER = /[֐-׿]/;
const LATIN_LETTER = /[A-Za-z]/;
export function hebrewLang(text) {
  // Several of these strings arrive as HTML rather than as words: a cell carries the <br>
  // its line breaks became, and the boards' rich text carries the underline markup. Asked
  // of the markup, every one of them has Latin letters in it (the "br", the "u") and none
  // of them would ever be called Hebrew. The tags and any entities come out first, so what
  // is judged is what is actually read out.
  const plain = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&[#\w]+;/g, ' ');
  return HEBREW_LETTER.test(plain) && !LATIN_LETTER.test(plain) ? ' lang="he"' : '';
}

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
