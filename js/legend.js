// The key at the foot of a printed page: what an underline and the stars on it mean.
//
// One definition. The wording was written out in thirteen files, which is thirteen chances for
// two pages to explain the same mark differently, and this project has been hurt by that shape
// more than once: the published file went on printing a schedule the admin had already fixed,
// and two retired rules went on firing for months. Read a thing off the one place that owns it.
//
// **The line is read right to left**, the way the shul reads it: the underline first, then one
// star, then two. That is why the row itself is set right to left while each piece inside it is
// its own left-to-right isolate, which is what keeps a star on the left of the words it marks.
// Measured rather than reasoned about, because this line is Hebrew, Latin and punctuation on one
// line and stored order is not display order (see CLAUDE.md). On the chart's footer the ink
// paints Underlined@721, בב״מ למטה@772 with the two starred pieces to their left, which is the
// order it is written in here.
//
// **Only the marks a page actually carries are named.** Telling a reader what a star means on a
// page with no star on it is noise, and the שבת chart is exactly that page: underlines and no
// stars at all.

import { escAttr } from './util.js';

/** The three pieces, in the order they are read.
 *
 *  `mark` is what the board prints beside a time, so the key and the boards cannot come to
 *  disagree about which mark means which room. The underline has no mark of its own: it is the
 *  word itself, underlined, which is the whole of what it has to say. */
export const LEGEND_PIECES = [
  { key: 'underline', mark: '', en: 'Underlined', he: 'בב״מ למטה' },
  { key: 'ezras', mark: '*', en: '', he: 'בעזרת נשים' },
  { key: 'simcha', mark: '**', en: '', he: 'באולם השמחות' },
];

const LEGEND_ORDER = LEGEND_PIECES.map((p) => p.key);

/** The pieces a page carries, from three yes-or-no answers, always in reading order. */
export function legendKeys({ underlined = false, star = false, twoStars = false } = {}) {
  return [underlined && 'underline', star && 'ezras', twoStars && 'simcha'].filter(Boolean);
}

/** The same, asked of a list of printed times: `{ text, underlined, mark }`, which is the
 *  shape every poster's lines are already made of. */
export function legendForTimes(times) {
  const all = times || [];
  return legendKeys({
    underlined: all.some((t) => t?.underlined),
    star: all.some((t) => t?.mark === '*'),
    twoStars: all.some((t) => t?.mark === '**'),
  });
}

/** The same, asked of a page that is already markup.
 *
 *  The two are looked for in different places on purpose. An underline only ever exists as
 *  markup, so it is looked for there. A star is a character the reader sees, and the wall
 *  chart sets it in an element of its own beside the time it marks ("7:20" and "*" in two
 *  divs), so a regex over the HTML never finds one: the tags come out first and the stars are
 *  looked for in the words that are left. Measured on the chart, which is how this was found. */
export function legendForHtml(html) {
  const markup = String(html ?? '');
  const words = markup.replace(/<[^>]*>/g, ' ');
  return legendKeys({
    underlined: /<u[\s>]/i.test(markup),
    star: /\d:\d\d\s*\*(?!\*)/.test(words),
    twoStars: /\d:\d\d\s*\*\*/.test(words),
  });
}

/** One key for several pages, each mark named once and in reading order. Two sheets on a page
 *  and the whole season on a page both want this. */
export function legendUnion(...lists) {
  const all = new Set(lists.flat().filter(Boolean));
  return LEGEND_ORDER.filter((k) => all.has(k));
}

/** The key as one line of markup, or nothing where the page carries no marks at all.
 *
 *  The row is right to left so the first piece is at the right; each piece is a left-to-right
 *  isolate so its star stays on the left of its own words and the Hebrew inside it still reads
 *  as Hebrew. The word is underlined because it is the mark it is explaining. */
export function legendHtml(keys) {
  const on = LEGEND_PIECES.filter((p) => (keys || []).includes(p.key));
  if (!on.length) return '';
  const piece = (p) => `<span dir="ltr">${p.en ? `<u>${escAttr(p.en)}</u> ` : escAttr(p.mark)}`
    + `<bdi lang="he">${escAttr(p.he)}</bdi></span>`;
  return `<span class="legend-key" dir="rtl">${on.map(piece).join('')}</span>`;
}
