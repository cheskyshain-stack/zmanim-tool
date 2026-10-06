// Small Excel-semantics helpers shared by the sheet column ports.

// Non-breaking space: used in every "/"-joined time list so the browser can never wrap
// mid-pair (e.g. "7:30 / 8:15" splitting into "7:30 /" + "8:15") when a column is
// narrow - only the sheet's own explicit \n line breaks should ever create a new line.
export const NBSP = ' ';
export const SLASH = `${NBSP}/${NBSP}`;
/** The same separator, but able to turn at the end of a line.
 *
 *  SLASH is non-breaking on both sides, which is right in a chart cell: a run of times there
 *  is broken where the formula says, not where the column runs out. On a sheet that sets a run
 *  across the page it is wrong twice over. The whole run becomes one unbreakable word, so it
 *  runs off the side rather than wrapping; and where it does have to wrap there is nowhere to
 *  do it, so the type cannot be grown to fill the page without spilling.
 *
 *  A non-breaking space, a slash, then an ordinary space. The slash is welded to the time in
 *  front of it and the only place the line can turn is after it, which is the one arrangement
 *  of the three that cannot strand a slash at the start of a line. A slash left at the end of
 *  one is turned into the break itself: see breakAtLineEnds in ui/week-view.js. */
export const SOFT_SLASH = `${NBSP}/ `;

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

/** Splits a list of time options across two printed lines. The bottom line gets the
 *  larger (or equal) half by default, floor(n/2) on top and ceil(n/2) below, which is
 *  what every one of these columns has always done and reads as one consistent pattern
 *  down the page.
 *
 *  That default is only overridden when it would read clearly lopsided by width - not
 *  plain item count, since 10:00 is a whole item wider than 7:00 and a board full of one
 *  but not the other (later evening times run longer than earlier afternoon ones) can
 *  split lopsided even at an even item count. A בראשית מעריב line of
 *  7:30/8:00/8:30/8:45/9:00 against 9:30/10:00/10:30/11:00/11:30/12:00 read as five short
 *  items over six longer ones, the bottom line fifteen characters wider than the top
 *  (measured) - moving the cut over one item narrows that to five, and only a gap that
 *  much worse than the alternative (here, more than double it) is worth giving up the
 *  bottom-heavier default for. A smaller gap stays bottom-heavy even if the other cut
 *  would have measured a few characters closer, since the consistent pattern is worth
 *  more than a handful of characters.
 *
 *  Only the two candidates nearest the middle are ever weighed (floor(n/2) and
 *  ceil(n/2)), never a lopsided count-wise split in the name of a closer width. Character
 *  count is the width proxy rather than a measured pixel width: this runs while the sheet
 *  is being built, before there is a rendered cell to measure at all.
 *
 *  `cut` overrides the choice outright, for a caller with its own reason to want a
 *  specific split regardless of what balances best - see the Weekday chart's "NEW" tag
 *  (sheets/weekday.js), which is not plain text and so is not honestly weighed by
 *  counting its characters. */
export function splitLinesInHalf(items, delim = SLASH, cut = null) {
  const resolvedCut = cut ?? bestSplitCut(items, delim);
  const line1 = items.slice(0, resolvedCut).join(delim);
  const line2 = items.slice(resolvedCut).join(delim);
  return [line1, line2].filter(Boolean).join('\n');
}

/** Bottom-heavier by default (see splitLinesInHalf), moved to top-heavier only when
 *  staying bottom-heavy would leave a gap more than double the alternative's. */
function bestSplitCut(items, delim) {
  const lo = Math.floor(items.length / 2); // bottom gets the larger half
  const hi = Math.ceil(items.length / 2); // top gets the larger half
  if (lo === hi) return lo;
  const widthDiff = (cut) => Math.abs(
    items.slice(0, cut).join(delim).length - items.slice(cut).join(delim).length
  );
  const bottomHeavyGap = widthDiff(lo);
  const topHeavyGap = widthDiff(hi);
  return bottomHeavyGap > topHeavyGap * 2 ? hi : lo;
}

/** HTML escaping, in the two shapes this codebase actually uses.
 *
 *  They were seven private copies of `esc`, three of one shape and four of the other, and
 *  under ES modules that is fine: each file has its own scope. The offline copy flattens
 *  every module into one script, where seven `function esc` are a legal redeclaration and
 *  the last one written wins for all of them. Which one that is depends on nothing but
 *  import order, and import order changes when any module gains an import. So they live
 *  here, one of each, named for what they are.
 *
 *  escAttr also escapes the double quote, and is what anything going into an attribute
 *  needs: a value carrying a " ends the attribute early otherwise.
 *
 *  escText leaves the quote alone, and the chart cells need it left alone. A cell's HTML is
 *  built with it and then compared against what the browser reports for that cell, to decide
 *  whether somebody has actually edited it (see baselineHtmlFor in sheet-view.js). The
 *  browser reports a quote as a quote, so escaping it here would make every cell holding one
 *  look edited, and the Hebrew on these charts is full of them: שליט"א, ר"ח, מ"א, גר"א. */
export function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function escText(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Match the straight double quote in the chart's ס"ז קר"ש heading. Only visible
 *  text changes; attributes, room keys and calculation data keep their original values. */
export function useStraightHebrewQuotes(root) {
  if (!root) return;
  const walker = root.ownerDocument.createTreeWalker(root, 4); // NodeFilter.SHOW_TEXT
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('script, style, textarea')) continue;
    const text = node.data.replace(/״/g, '"').replace(/([\u0590-\u05ff])[“”](?=[\u0590-\u05ff])/g, '$1"');
    if (text !== node.data) node.data = text;
  }
}

/** The same presentation for cell comparisons, so changing a quote's appearance
 *  cannot create a manual override when somebody only clicks into a cell and leaves. */
export function straightHebrewQuoteHtml(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  useStraightHebrewQuotes(box);
  return box.innerHTML;
}

/** Whether two שחרית schedules say different things, whatever separators they were typed with.
 *  Used to drop a season line that only repeats the everyday one: the morning of יום א' of
 *  סליחות is the ordinary list, its סליחות having been said the night before, and printing it
 *  again under its own heading says nothing the line above it did not.
 *
 *  Commas, slashes and spaces are all the same separator here, since the same list is typed
 *  with any of them (see cellSource in ui/week-sheet.js). The underline is not: it says the
 *  מנין is בבית מדרש למטה, which is a different thing to say about the same time, and stripping
 *  every tag alike made two schedules that differ only in which מנין is downstairs compare
 *  equal, so one of them would have been dropped without a word. The stars, being plain text,
 *  were never at risk. */
export function differsFromSchedule(a, b) {
  const bare = (v) => String(v ?? '')
    .replace(/<\s*\/?\s*u\s*>/gi, '_')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s,/]+/g, ' ')
    .trim();
  return bare(a) !== bare(b);
}
