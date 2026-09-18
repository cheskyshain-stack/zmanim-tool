// The Erev Shabbos message, as a line of text somebody can paste into a chat.
//
// Somebody sends this out every Friday, typed out by hand off the board. All of it is on
// the board already, so it can be built from the same row the שבת card is built from, and
// then there is one place the times come from rather than two.
//
// A worked example, checked against a real message for כי תבוא:
//
//   Erev P' Ki Savo
//   Mincha 1:35d, 1:50m, 2:15m, 3:00m
//   Mincha 5:57m, Plag Gra 6:12
//   Mincha 6:33d, Plag MA 6:48
//   Mincha 6:53en Plag 7:08
//   Hadlakas Neiros 7:16
//   Mincha 7:19m
//   Have a great Shabbos!
//
// Where each piece comes from:
//
//   Erev P'          the parsha, in English, out of data/parsha_names.json, which already
//                    carries "Ki Savo" beside כי תבוא for the chart's own use.
//   d                the time is underlined on the board. The printed footer already says
//                    "All underlined מנינים will be למטה", so underlined is downstairs and
//                    d is what the message calls it.
//   m                not underlined, so the main בית מדרש.
//   en               the מנחה (בעזר״נ) column, which says where it davens in its own
//                    heading. It is the room, like d, so it does not depend on the
//                    underline.
//   Plag Gra / MA    the פלג on the second line of those two columns, named for whichever
//                    the column is headed with.
//
// Everything in the message is now read off the board and nothing is added to it. There was
// one exception, "& ns" on the פלג גר"א מנחה and the מנחה מעריב, saying those two also daven
// in the עזרת נשים. It was on instruction, it was never on the board, and the shul has since
// said to stop sending it. Said here rather than only in the history, because the next person
// to compare an old message with a new one will wonder where it went.
//
// Winter has none of the פלג columns (CHOREF_COLUMNS is eight wide against קיץ's twelve),
// so those three lines simply do not appear. Nothing here asks for a column by name: each
// one is recognised by its own heading and skipped when the season has not got it.

import { UL_START, UL_END } from './format.js';

/** The closing line, and the only words here that are not read off the board. */
const EREV_SIGN_OFF = 'Have a great Shabbos!';

/** Which דרשה a שבת carries, in the English the message uses.
 *
 *  Keyed on both spellings a week's special parsha can be stored under, the two the board's
 *  own DRASHA_NAMES holds (sheets/common.js). Written out here rather than paired off that
 *  list by position: a list of four strings that happens to run Hebrew, English, Hebrew,
 *  English is not something a reader of either file can see, and a fifth entry added there
 *  would quietly hand the wrong name to this one. A week this does not know gets no דרשה
 *  line at all, which is the right way for it to fail: the alternative sent a nameless
 *  "Shabbos Drasha" on a week whose דרשה was ט באב's. */
const EREV_DRASHA_NAMES = {
  'שובה': 'Shuva', Shuva: 'Shuva',
  'הגדול': 'Hagadol', Hagadol: 'Hagadol',
};


/** A cell as it is stored is plain text carrying the underline sentinels, but an override
 *  typed by hand is real HTML. Both are flattened to the same thing here: text, newlines,
 *  and the sentinels marking what is underlined.
 *
 *  Exported because the שבת שובה poster reads the same cells. One reader for both, or the
 *  poster would drift from the board it is supposed to be quoting. */
export function erevPlain(value) {
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
export function erevTimes(value) {
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
    // The stars that follow a time are part of it: they say which room, the same as the
    // underline does. Captured here so a reader can ask where a מנין is without going back
    // to the raw cell for the characters just after it.
    const m = /^(\d{1,2}:\d{2})(\*{0,2})/.exec(text.slice(i));
    if (m) {
      out.push({ text: m[1], mark: m[2], underlined, line, before: text.slice(0, i) });
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

/** Where a מנין davens, off the marks the board itself carries: underlined is בית מדרש למטה,
 *  one star is the עזרת נשים, two is the אולם השמחות, unmarked is the main בית מדרש.
 *
 *  One definition, used by every message. The yom tov ones read poster times and this reads
 *  chart cells, and the two carry the mark the same way, so the letter must not be worked out
 *  twice: the day they disagreed would be the day a message sent somebody to the wrong room. */
export function erevWhereMark(time) {
  if (time?.mark === '**') return 'sh';
  if (time?.mark === '*') return 'en';
  return time?.underlined ? 'd' : 'm';
}

/** The דרשה the board prints on a שבת שובה or a שבת הגדול: the Shabbos afternoon one, which
 *  shabbosMinchaParts in sheets/common.js writes into the Shabbos מנחה column.
 *
 *  Read off the board rather than worked out again, like every other time in this message.
 *  But off **that** column and nothing else, because it is not the only דרשה the board knows:
 *  on שבת חזון the מעריב column carries the ט באב evening, "דרשה 8:45 / זמן 72 9:22 / מעריב
 *  9:35", and asking the whole row for the word found it and announced a 8:45 "Shabbos Drasha"
 *  on the Friday before ט באב. Measured over five years, which is how it was caught. That
 *  evening is a different message the shul has not sent one of, so nothing here invents it.
 *
 *  The column is the one whose heading is מנחה and nothing else: every other מנחה column on
 *  these boards says something more in its heading, which erevKindOf is already the list of.
 *
 *  No room letter after the time. d and m say which בית מדרש a מנין is in and a דרשה is not a
 *  מנין, which is also why the board leaves the underline off it while the מנחה above it
 *  carries one. The fast messages leave שקיעה bare for the same reason. */
function erevDrasha(columns, row) {
  for (const col of columns) {
    const header = String(col.header ?? '').replace(/\s+/g, ' ');
    if (erevKindOf(col.header) || !header.includes('מנחה')) continue;
    for (const line of erevPlain(row[col.key]).split('\n')) {
      if (!line.includes('דרשה')) continue;
      const at = /\d{1,2}:\d{2}/.exec(line);
      if (at) return at[0];
    }
  }
  return null;
}

/** d, m or en: where this מנין davens, for a column whose heading already says the room. */
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
 *  @param specialParsha - the week's own, "שובה" or "הגדול" where it has one, which is the
 *    only thing here that is not in the row. The דרשה's time is read off the board like
 *    everything else; this says which דרשה it is, which the board does not spell in English.
 *
 *  The order is the order the message is written in, which is the order the evening
 *  happens in, and that is the printed order of the columns reversed. */
export function erevShabbosText(columns, row, parshaEnglish, specialParsha = '') {
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
    // The פלג is the time written under the מנין, so anything on a later line of the cell.
    const plag = times.find((t) => t.line > first.line);
    let line = `Mincha ${first.text}${erevWhere(kind, first)}`;
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

  /* After the sign-off, which is where the shul's own sent message puts it. Every other line
     of this message is part of the Friday evening and the דרשה is the Shabbos afternoon, so
     it reads as the note it is rather than as one more מנין in the run. Written the way they
     sent it: "Shabbos Shuva Drasha 5:15". */
  /* Only on a week this file can name, which is the second half of the guard above: a דרשה
     it cannot name is one it does not know the shape of, and "Shabbos Drasha 8:45" with no
     name on it was exactly the wrong answer rather than a cautious one. */
  const named = EREV_DRASHA_NAMES[String(specialParsha ?? '').trim()];
  const drasha = named ? erevDrasha(columns, row) : null;
  if (drasha) lines.push(`Shabbos ${named} Drasha ${drasha}`);
  return lines.join('\n');
}

/** "Ki Savo" for כי תבוא, out of the table the chart already uses. Falls back to the Hebrew
 *  rather than to nothing: a message naming the parsha in Hebrew is still usable, one
 *  naming no parsha at all is not. */
export function erevParshaEnglish(hebrewParsha, parshaNames) {
  const want = String(hebrewParsha ?? '').trim();
  const row = parshaNames?.rows?.find((r) => String(r[0]).trim() === want);
  return (row && row[1]) || want;
}
