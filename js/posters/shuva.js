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
import { roshHashana, excelWeekday, hasParsha, hasSpecialParsha } from '../hebrew-calendar.js';
import { excelSerial, dateFromSerial } from '../zmanim/solar.js';

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

/** Every generated chart that carries the שבת שובה of one Hebrew year.
 *
 *  This exists because the two numbers do not agree and it is easy to print the wrong
 *  year. A season is named for the year it starts in, and a קיץ season runs from Pesach
 *  through to Sukkos of the year AFTER: קיץ 5786 ends 2026-09-19, which is the שבת שובה of
 *  5787, because ר"ה 5787 is 2026-09-12. So the chart says 5786 and the poster on the wall
 *  is for 5787. Posters are chosen by the year of the ר"ה they belong to, which is the year
 *  written on them, and this is what finds the chart behind that.
 *
 *  שבת שובה is the Shabbos between ר"ה and יו"כ, so it lands inside the ten days that open
 *  the year. Normally exactly one chart covers it, but nothing stops two saved sheets from
 *  covering the same one, so this returns all of them and lets the caller see whether they
 *  actually disagree. */
export function shuvaSheetsFor(sheets, hebrewYearNum) {
  const rh = roshHashana(hebrewYearNum - 3761);
  return (sheets || []).filter((sheet) => {
    const week = shuvaWeekOf(sheet);
    if (!week) return false;
    const serial = excelSerial(new Date(week.date));
    return serial > rh && serial < rh + 10;
  });
}

/** The date שבת שובה falls on, as an Excel serial: the first Shabbos after ר"ה opens, which
 *  is the same ten days the search above looks through.
 *
 *  The poster itself does not use this. It reads its date off the chart week it was built
 *  from, because the times come from that week's cell and the two must agree. This is for
 *  ordering the posters by date, which has to be answerable before anything is built and for
 *  a year that may have no chart saved at all.
 *
 *  ר"ה can only open on a Monday, Tuesday, Thursday or Shabbos. A Thursday ר"ה puts שבת שובה
 *  on 3 תשרי, in front of צום גדליה rather than after it, which is the whole reason the order
 *  is worked out per year instead of written down once. */
export function shabbosShuvaSerial(hebrewYearNum) {
  const rh = roshHashana(hebrewYearNum - 3761);
  // Days from ר"ה to the next Shabbos. Zero would mean ר"ה is itself Shabbos, and the Shabbos
  // of the ten days is then the one a week later, so an exact hit takes the full seven.
  return rh + ((7 - excelWeekday(rh)) % 7 || 7);
}

/** The poster's content, read out of one מנחה cell.
 *
 *  Returns the דרשה's time and the מנחה times as they stand on the board, each knowing
 *  whether it was underlined and whether it carried a *, so the view can draw them the way
 *  the chart draws them and the foot can say only what is needed.
 *
 *  Split out from buildShuvaPoster because the cell can now come from two places, a saved
 *  chart or the calendar, and everything after the cell is the same either way.
 */
function posterFromCell(week, cell) {
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
    // The one Shabbos it is about, said the way every other poster says its dates, so
    // anything asking "is this sheet current" can ask all of them the same question. This
    // one was the exception and so it never answered: see currentPosters in posters-view.
    span: { from: week.serial, to: week.serial },
    drasha: drasha ? drasha.text : null,
    mincha,
    // Only the marks that are actually on this poster get explained. Each line says which
    // direction it has to be set in: the underline line is an English sentence carrying
    // Hebrew and reads left to right, the star line is Hebrew and reads right to left, and
    // setting that one the wrong way puts the star at the far end of the line instead of
    // against the words it marks. Same split as the week card's legend.
    legend: [
      mincha.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      mincha.some((t) => t.mark === '*') ? { dir: 'rtl', text: '*בעזרת נשים' } : null,
    ].filter(Boolean),
  };
}

/** The poster off a saved chart: the מנחה cell of its שבת שובה week, or nothing if this sheet
 *  does not cover one.
 *
 *  Preferred over the calendar below wherever a chart exists, and that is the whole point of
 *  reading the cell rather than recomputing beside it: a hand edit to that cell on the board
 *  is on the poster too, and a season the shul set by hand is the season the poster uses. */
export function buildShuvaPoster(sheet, state, settings) {
  const week = shuvaWeekOf(sheet);
  if (!week) return null;
  const { row } = rowFor({ ...week, date: new Date(week.date) }, sheet, state, settings);
  return posterFromCell(week, row.C);
}

/** The same poster with no chart at all, worked out from the calendar.
 *
 *  The chart was never the source of these times. Its מנחה cell is itself computed, by the
 *  same rowFor this calls, out of Settings and the rules: what a saved chart adds is the
 *  season somebody chose for that week and any hand edit made to that one cell. So a year
 *  with no chart saved is not a year the poster cannot be made for, and with the Year picker
 *  now offering ten of them it would otherwise be blank for nine.
 *
 *  The stand-in sheet is a קיץ one because that is the only season שבת שובה can fall in: a
 *  קיץ season runs from Pesach to the Sukkos after it, and שבת שובה is inside the ten days
 *  that open the year, which is before that Sukkos. It carries no overrides, there being no
 *  sheet for anyone to have edited.
 *
 *  Needs the parsha tables, which the app has loaded before anything is drawn. Without them
 *  it says so rather than guessing at a parsha, since a rule can be keyed on one. */
export function buildShuvaFromCalendar(hebrewYearNum, state, settings, tables) {
  if (!tables) return null;
  const serial = shabbosShuvaSerial(hebrewYearNum);
  const week = {
    serial,
    date: dateFromSerial(serial),
    parsha: hasParsha(serial, settings, tables),
    specialParsha: hasSpecialParsha(serial, settings),
  };
  const { row } = rowFor(week, { season: 'kayitz' }, state, settings);
  return posterFromCell(week, row.C);
}
