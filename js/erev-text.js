// The Erev Shabbos message, as a line of text somebody can paste into a chat.
//
// Somebody sends this out every Friday, typed out by hand off the board. All of it is on
// the board already, so it can be built from the same row the שבת card is built from, and
// then there is one place the times come from rather than two.
//
// A worked example, checked against a real message for כי תבא:
//
//   Erev P' Ki Savo
//   Mincha 1:35d, 1:50m, 2:15m, 3:00m
//   Mincha 5:57m & ns, Plag Gra 6:12
//   Mincha 6:33d, Plag MA 6:48
//   Mincha 6:53en Plag 7:08
//   Hadlakas Neiros 7:16
//   Mincha 7:19m & ns
//   Have a great Shabbos!
//
// Where each piece comes from:
//
//   Erev P'          the parsha, in English, out of data/parsha_names.json, which already
//                    carries "Ki Savo" beside כי תבא for the chart's own use.
//   d                the time is underlined on the board. The printed footer already says
//                    "All underlined מנינים will be למטה", so underlined is downstairs and
//                    d is what the message calls it.
//   m                not underlined, so the main בית מדרש.
//   en               the מנחה (בעזר״נ) column, which says where it davens in its own
//                    heading. It is the room, like d, so it does not depend on the
//                    underline.
//   Plag Gra / MA    the פלג on the second line of those two columns, named for whichever
//                    the column is headed with.
//   & ns             NOT on the board. The פלג גר"א מנחה and the מנחה מעריב also daven in
//                    the עזרת נשים, which is something the sender knows and the chart does
//                    not say. Fixed to those two columns, on instruction.
//
// Winter has none of the פלג columns (CHOREF_COLUMNS is eight wide against קיץ's twelve),
// so those three lines simply do not appear. Nothing here asks for a column by name: each
// one is recognised by its own heading and skipped when the season has not got it.

import { UL_START, UL_END } from './format.js';

/** The closing line, and the only words here that are not read off the board. */
const EREV_SIGN_OFF = 'Have a great Shabbos!';

/** Which columns get "& ns" bolted on. Named by what their heading says rather than by
 *  column key, since the keys differ between the two seasons. */
const EREV_ALSO_NASHIM = ['plagGra', 'minchaMaariv'];

/** A cell as it is stored is plain text carrying the underline sentinels, but an override
 *  typed by hand is real HTML. Both are flattened to the same thing here: text, newlines,
 *  and the sentinels marking what is underlined. */
function erevPlain(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?u\b[^>]*>/gi, (tag) => (tag[1] === '/' ? UL_END : UL_START))
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Every clock time in a cell, in order, each with whether it was underlined and which
 *  line of the cell it sat on. The line matters because the פלג of a column is written
 *  under its מנחה rather than beside it. */
function erevTimes(value) {
  const text = erevPlain(value);
  const out = [];
  let line = 0;
  let underlined = false;
  // Walked character by character rather than by one regex, so that a sentinel opening
  // before a time and closing after it is tracked across the whole cell.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { line++; continue; }
    if (ch === UL_START) { underlined = true; continue; }
    if (ch === UL_END) { underlined = false; continue; }
    const m = /^\d{1,2}:\d{2}/.exec(text.slice(i));
    if (m) {
      out.push({ text: m[0], underlined, line, before: text.slice(0, i) });
      i += m[0].length - 1;
    }
  }
  return out;
}

/** What a column is, by what its heading says. Headings carry newlines and quote marks of
 *  several kinds, so this asks only for the words that tell the columns apart. */
function erevKindOf(header) {
  const h = String(header ?? '').replace(/\s+/g, ' ');
  if (h.includes('ערב שבת')) return 'erevShabbos';
  if (h.includes('הדלקת')) return 'candles';
  if (h.includes('בעזר')) return 'ezrasNashim';
  if (h.includes('למטה')) return 'lmata';
  if (h.includes('פלג גר')) return 'plagGra';
  if (h.includes('מנחה') && h.includes('מעריב')) return 'minchaMaariv';
  return null;
}

/** Which פלג a column's second line is, said the way the message says it. */
function erevPlagLabel(kind) {
  if (kind === 'plagGra') return 'Plag Gra';
  if (kind === 'lmata') return 'Plag MA';
  return 'Plag';
}

/** d, m or en: where this מנין davens. */
function erevWhere(kind, time) {
  if (kind === 'ezrasNashim') return 'en';
  return time.underlined ? 'd' : 'm';
}

/** The message for one week.
 *
 *  @param columns/row - straight from rowFor(), so this reads exactly what the card and
 *    the chart read and cannot drift from them.
 *  @param parshaEnglish - "Ki Savo". Left to the caller because looking it up needs the
 *    tables, which are loaded asynchronously, and this stays a plain function.
 *
 *  The order is the order the message is written in, which is the order the evening
 *  happens in, and that is the printed order of the columns reversed. */
export function erevShabbosText(columns, row, parshaEnglish) {
  const lines = [];
  lines.push(`Erev P' ${parshaEnglish}`);

  for (const col of [...columns].reverse()) {
    const kind = erevKindOf(col.header);
    if (!kind) continue;
    const times = erevTimes(row[col.key]);
    if (!times.length) continue;

    if (kind === 'erevShabbos') {
      // The whole row, every time with where it davens, which is the one column that
      // lists more than one מנין.
      lines.push('Mincha ' + times.map((t) => t.text + erevWhere(kind, t)).join(', '));
      continue;
    }
    if (kind === 'candles') {
      // The first time only. The second is שקיעה, which the message does not carry.
      lines.push(`Hadlakas Neiros ${times[0].text}`);
      continue;
    }

    const first = times[0];
    const alsoNashim = EREV_ALSO_NASHIM.includes(kind) ? ' & ns' : '';
    // The פלג is the time written under the מנין, so anything on a later line of the cell.
    const plag = times.find((t) => t.line > first.line);
    let line = `Mincha ${first.text}${erevWhere(kind, first)}${alsoNashim}`;
    if (plag) {
      // No comma on the בעזר״נ line, which is how the message is written. The others take
      // one.
      line += kind === 'ezrasNashim'
        ? ` ${erevPlagLabel(kind)} ${plag.text}`
        : `, ${erevPlagLabel(kind)} ${plag.text}`;
    }
    lines.push(line);
  }

  lines.push(EREV_SIGN_OFF);
  return lines.join('\n');
}

/** "Ki Savo" for כי תבא, out of the table the chart already uses. Falls back to the Hebrew
 *  rather than to nothing: a message naming the parsha in Hebrew is still usable, one
 *  naming no parsha at all is not. */
export function erevParshaEnglish(hebrewParsha, parshaNames) {
  const want = String(hebrewParsha ?? '').trim();
  const row = parshaNames?.rows?.find((r) => String(r[0]).trim() === want);
  return (row && row[1]) || want;
}
