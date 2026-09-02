// The שבת שובה poster, read off the board rather than typed out.
//
// The shul hangs a sheet on שבת שובה saying when the דרשה is and when מנחה is. Until now
// it was a Word file, retyped every year from whatever the chart said, which is two places
// for one set of times and one of them always a year behind.
//
// Everything here comes out of the chart's own מנחה cell for that week, through the same
// rowFor() the sheet is drawn with. So it carries the rules, and it carries a per-cell
// override too: if somebody edits that cell on the sheet, the poster says what the sheet
// says. That is the point of reading the cell rather than recomputing the times beside it.
//
// The old posters marked where a minyan was with asterisks, ** for למטה. The boards use a
// different system now and the poster follows them: plain is the main bais medrash,
// underlined is למטה, * is בעזרת נשים. The note at the foot is built from whichever of
// those actually appear, so a poster never explains a mark it does not carry.
import { rowFor } from '../sheets/rows.js';
import { erevPlain, erevTimes } from '../erev-text.js';
import { SHUVA_NAMES } from '../sheets/common.js';

/** The lines that are the poster rather than the times: what it is, and who is speaking.
 *
 *  In one place and not in settings, for now. They have not changed in the years of posters
 *  we have, and a settings field nobody edits is a field to keep working. When a second
 *  poster wants its own wording this is where they both come from. */
export const SHUVA_TEXT = {
  title: 'שבת שובה דרשה',
  lines: ['בעזהשי"ת הרב שליט"א', 'ידרוש בהלכה ובאגדה'],
  at: 'בשעה',
  minchaLabel: 'מנחה',
};

/** Which of the sheet's weeks is שבת שובה, or nothing if this sheet does not cover it.
 *
 *  Asked of the week's own specialParsha, which the calendar has already worked out, so
 *  this does not need its own idea of when שבת שובה falls. */
export function shuvaWeekOf(sheet) {
  if (!sheet || !Array.isArray(sheet.weeks)) return null;
  // A Weekday chart covers the same dates and has no מנחה column of this kind to read, so
  // it is not a sheet this poster can come from even though שבת שובה falls inside it.
  if (sheet.season === 'weekday') return null;
  return sheet.weeks.find((w) => SHUVA_NAMES.includes(w.specialParsha)) || null;
}

/** The poster's content for a sheet, or null when that sheet has no שבת שובה in it.
 *
 *  Returns the דרשה's time and the מנחה times as they stand on the board, each knowing
 *  whether it was underlined and whether it carried a *, so the view can draw them the way
 *  the chart draws them and the foot can say only what is needed.
 */
export function buildShuvaPoster(sheet, state, settings) {
  const week = shuvaWeekOf(sheet);
  if (!week) return null;
  const { row } = rowFor({ ...week, date: new Date(week.date) }, sheet, state, settings);
  const cell = row.C;
  const found = erevTimes(cell);

  // The דרשה is the time whose own line says דרשה. Asked of the text in front of it rather
  // than of its position, since a hand-edited cell can put it anywhere, and asked of the
  // line rather than of the whole cell so a second time on that line is not mistaken for it.
  const isDrasha = (t) => /דרשה[^\n]*$/.test(t.before);
  const drasha = found.find(isDrasha) || null;

  // A time is בעזרת נשים if a * is stuck to it. The boards write the star after the digits
  // (see the Weekday chart), so that is where this looks. Measured against erevPlain's own
  // output, because that is what erevTimes counted its offsets against: flattening any
  // other way puts the offsets somewhere else in the string.
  const flat = erevPlain(cell);
  const starred = (t) => /^\s*\*/.test(flat.slice(t.before.length + t.text.length));

  // mark is the same field the סליחות poster carries, so one renderer draws both: '' is
  // the main בית מדרש, '*' is בעזרת נשים, '**' is באולם השמחות, and למטה is the underline.
  const mincha = found
    .filter((t) => !isDrasha(t))
    .map((t) => ({ text: t.text, underlined: t.underlined, mark: starred(t) ? '*' : '' }));

  return {
    week,
    drasha: drasha ? drasha.text : null,
    mincha,
    // Only the marks that are actually on this poster get explained.
    legend: [
      mincha.some((t) => t.underlined) ? 'All underlined מנינים will be בבית מדרש למטה' : '',
      mincha.some((t) => t.mark === '*') ? '*בעזרת נשים' : '',
    ].filter(Boolean),
  };
}
