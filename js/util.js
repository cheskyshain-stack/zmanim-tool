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

/** Keep times in order and minimize the difference between printed line widths.
 *  Prefer wider lines below only when the balance is equally good. `prefixes`
 *  holds each item's separator, removed at a line start. Notes stay on the first line. */
export function balancedLineCuts(widths, { lines = 2, prefixes = [], lead = 0 } = {}) {
  const count = Math.min(widths.length, Math.max(1, Math.floor(lines)));
  if (count <= 1) return [];
  const sums = [0];
  widths.forEach(width => sums.push(sums.at(-1) + width));
  const lineWidth = (from, to) => sums[to] - sums[from] - (prefixes[from] || 0) + (from === 0 ? lead : 0);
  let best = null;
  const consider = cuts => {
    const ends = [0, ...cuts, widths.length];
    const lengths = ends.slice(1).map((end, i) => lineWidth(ends[i], end));
    const spread = Math.max(...lengths) - Math.min(...lengths);
    const widest = Math.max(...lengths);
    const lowerWeight = lengths.reduce((sum, width, i) => sum + i * width, 0);
    if (!best || spread < best.spread - 0.001 || Math.abs(spread - best.spread) <= 0.001
      && (widest < best.widest - 0.001 || Math.abs(widest - best.widest) <= 0.001
        && lowerWeight > best.lowerWeight + 0.001)) {
      best = { spread, widest, lowerWeight, cuts };
    }
  };
  // Most lists have two lines. Compare every possible cut without imposing a direction.
  if (count === 2) {
    for (let end = 1; end < widths.length; end++) consider([end]);
    return best.cuts;
  }
  // For longer lists, try each possible minimum line width. A memoized minimax
  // partition finds its narrowest range without enumerating all combinations of cuts.
  const minima = new Set();
  for (let from = 0; from < widths.length; from++) {
    for (let end = from + 1; end <= widths.length; end++) minima.add(lineWidth(from, end));
  }
  for (const minimum of minima) {
    const memo = new Map();
    const finish = (from, left) => {
      const key = `${from}:${left}`;
      if (memo.has(key)) return memo.get(key);
      let answer = null;
      for (let end = from + 1; end <= widths.length - left + 1; end++) {
        if (left === 1 && end !== widths.length) continue;
        const width = lineWidth(from, end);
        if (width < minimum - 0.001) continue;
        const rest = left === 1 ? { widest: 0, lowerWeight: 0, cuts: [] } : finish(end, left - 1);
        if (!rest) continue;
        const widest = Math.max(width, rest.widest);
        const lowerWeight = (count - left) * width + rest.lowerWeight;
        if (!answer || widest < answer.widest - 0.001 || Math.abs(widest - answer.widest) <= 0.001
          && lowerWeight > answer.lowerWeight + 0.001) {
          answer = { widest, lowerWeight, cuts: left === 1 ? [] : [end, ...rest.cuts] };
        }
      }
      memo.set(key, answer);
      return answer;
    };
    const result = finish(0, count);
    if (result) consider(result.cuts);
  }
  return best.cuts;
}

/** A text-only estimate until the browser can measure the actual font and tags.
 *  Invisible formatting marks and underline lead-in spaces do not add width. */
export function splitLinesInHalf(items, delim = SLASH, cut = null) {
  const visibleWidth = text => String(text).replace(/<[^>]*>/g, '')
    .replace(/[\uE000-\uF8FF\u2066-\u2069]/g, '').trim().length;
  const prefixes = items.map((_, i) => i ? delim.length : 0);
  const resolvedCut = cut ?? balancedLineCuts(items.map((item, i) => visibleWidth(item) + prefixes[i]), { prefixes })[0] ?? items.length;
  const line1 = items.slice(0, resolvedCut).join(delim);
  const line2 = items.slice(resolvedCut).join(delim);
  return [line1, line2].filter(Boolean).join('\n');
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
