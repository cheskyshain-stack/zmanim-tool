// The סליחות poster: the yomim noraim minyan schedule the shul hangs before ר"ה.
//
// The times on it are the shul's own minyan slots and are not on the zmanim board, so
// unlike the שבת שובה poster there is no cell to read them out of. They are the table
// below. What is worked out here is the part that was wrong every few years when this was
// a Word file: which days each line actually covers.
//
// Two lines carry a note that the first מנין is five minutes earlier on the days there is
// קריאת התורה, because the davening runs longer. On the hand-made posters that note was
// typed as "יום ב' וה'" or "יום ב'" and left alone the next year, and the days it names
// change with the day ר"ה falls on. So it is computed.
//
// The marks are the boards' marks, not the old poster's. The Word posters used * for
// בעזרת נשים, ** for למטה and *** for אולם השמחות; the app writes plain for the main בית
// מדרש, an underline for למטה, * for בעזרת נשים and ** for אולם השמחות. Everything below
// is written in the app's system, so somebody holding the poster and the chart is reading
// one set of marks.
import { roshHashana, excelWeekday, hebrewYear } from '../hebrew-calendar.js';

/** Excel WEEKDAY numbering, which is what excelWeekday returns: 1 is Sunday. */
const DOW_SUNDAY = 1;
const DOW_MONDAY = 2;
const DOW_THURSDAY = 5;
const DOW_SHABBOS = 7;

/** The days the Torah is read at shacharis, which is why those mornings start earlier.
 *  Named in the order the note says them. */
const KRIAS_HATORAH = [
  { dow: DOW_MONDAY, he: "יום ב'", both: "יום ב'" },
  { dow: DOW_THURSDAY, he: "יום ה'", both: "וה'" },
];

/** ר"ה of a Hebrew year, as an Excel serial. roshHashana() takes the year with the 3761
 *  taken off it, which is how the workbook's own defined name is written. */
const roshHashanaSerial = (hebrewYearNum) => roshHashana(hebrewYearNum - 3761);

/** The first morning of סליחות.
 *
 *  They begin on a Sunday (the מוצ"ש before it is the first night), and if the Sunday
 *  before ר"ה would leave fewer than four days they begin the Sunday before that. Which
 *  is why the run is four days in some years and nine in others. */
export function slichosStart(hebrewYearNum) {
  const erev = roshHashanaSerial(hebrewYearNum) - 1; // 29 אלול
  let start = erev - (excelWeekday(erev) - DOW_SUNDAY); // the Sunday on or before it
  if (erev - start + 1 < 4) start -= 7;
  return start;
}

/** צום גדליה: 3 תשרי, pushed to the 4th when the 3rd is Shabbos. Returned as a day of
 *  תשרי rather than a serial, since that is how the days around it are counted here. */
function tzomGedaliaDay(rh) {
  return excelWeekday(rh + 2) === DOW_SHABBOS ? 4 : 3;
}

/** The mornings each of the two multi-day lines covers, as Excel weekdays.
 *
 *  סליחות is every סליחות morning after that first Sunday, up to but not including ערב ר"ה,
 *  which has a line of its own. עשי"ת is 3 to 8 תשרי, less Shabbos and less צום גדליה,
 *  which also have their own lines, and less ערב יו"כ on the 9th.
 *
 *  Both skip Shabbos, which has no weekday shacharis to print. */
export function posterDays(hebrewYearNum) {
  const rh = roshHashanaSerial(hebrewYearNum);
  const erev = rh - 1;
  const start = slichosStart(hebrewYearNum);

  const slichos = [];
  for (let d = start + 1; d < erev; d++) if (excelWeekday(d) !== DOW_SHABBOS) slichos.push(excelWeekday(d));

  const tzom = tzomGedaliaDay(rh);
  const aseres = [];
  for (let n = 3; n <= 8; n++) {
    const d = rh + n - 1;
    if (excelWeekday(d) === DOW_SHABBOS || n === tzom) continue;
    aseres.push(excelWeekday(d));
  }
  return { slichos, aseres };
}

/** The note in brackets at the end of a line: which of יום ב' and יום ה' fall inside it,
 *  and what time the first מנין is on them.
 *
 *  Nothing at all if neither falls in the range, which does happen: the four-day סליחות of
 *  a year ר"ה is on Thursday runs Sunday to Wednesday and never reaches a Thursday, and the
 *  עשי"ת of a year ר"ה is on Shabbos runs Tuesday to Friday and never reaches a Monday. */
export function kriasHatorahNote(days, time) {
  if (!time) return '';
  const hit = KRIAS_HATORAH.filter((d) => days.includes(d.dow));
  if (!hit.length) return '';
  // "יום ב' וה'" when both, and each on its own reads as itself.
  const named = hit.length === 2 ? `${hit[0].both} ${hit[1].both}` : hit[0].he;
  return `(${named} ${time})`;
}

/** The poster, line by line, in the order it is hung.
 *
 *  `times` is written the way a chart cell is: a plain time is the main בית מדרש, <u> is
 *  למטה, a trailing * is בעזרת נשים and ** is באולם השמחות. `earlier` is the five-minutes-
 *  earlier first מנין on a קריאת התורה morning, and `days` says which range decides which
 *  of those mornings the line actually has.
 *
 *  Here rather than in settings, the same as the שבת שובה wording: these are the shul's
 *  fixed מנין slots and they have not moved in the posters we have. The year's worth of
 *  it that does change is computed above. */
export const SLICHOS_ROWS = [
  { label: 'דרשה מאת הרב שליט"א', times: '12:30' },
  { label: 'סליחות מוצ"ש', times: '12:55' },
  { label: "שחרית יום א' (no סליחות)", times: '7:00, 7:20*, <u>7:35</u>, 8:00, 8:20*, <u>8:40</u>' },
  { label: 'סליחות', times: '6:40, 7:00*, <u>7:15</u>, 7:35**, 8:00, 8:30*', earlier: '6:35', days: 'slichos' },
  { label: 'ערב ר"ה', times: '6:30, <u>7:10</u>' },
  { label: 'צום גדליה', times: '6:20, 6:40*, <u>7:00</u>, 7:35**, 8:00' },
  { label: 'עשי"ת', times: '6:25, 6:45*, <u>7:00</u>, 7:35**, 8:00, 8:30*', earlier: '6:20', days: 'aseres' },
  { label: 'ערב יו"כ', times: '7:00, 7:20*, <u>7:35</u>, 8:00**, 8:20' },
];

export const SLICHOS_TEXT = { title: 'סליחות' };

/** One line's times, split into the pieces the poster draws.
 *
 *  Reads the same notation a chart cell uses, so a row above can be written the way the
 *  board writes it: <u> for למטה, a trailing * for בעזרת נשים and ** for באולם השמחות.
 *  The marks come off the text and become flags, so the view decides how to draw them and
 *  the foot can count which ones are actually on the sheet. */
export function parseTimes(str) {
  return String(str ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const underlined = /^<u>.*<\/u>\**$/.test(part);
      const bare = part.replace(/<\/?u>/g, '');
      const stars = (bare.match(/\*+$/) || [''])[0];
      return { text: bare.slice(0, bare.length - stars.length), underlined, mark: stars };
    });
}

/** The finished poster for one Hebrew year.
 *
 *  The year is the שבת קיץ / שבת חורף year the sheet was generated for. סליחות and עשי"ת
 *  both sit at the very start of a Hebrew year, so this is the year they belong to. */
export function buildSlichosPoster(hebrewYearNum) {
  if (!hebrewYearNum) return null;
  const days = posterDays(hebrewYearNum);
  const rows = SLICHOS_ROWS.map((row) => ({
    label: row.label,
    times: parseTimes(row.times),
    note: row.days ? kriasHatorahNote(days[row.days], row.earlier) : '',
  }));
  const all = rows.flatMap((r) => r.times);

  // Only the marks that are actually on this poster get explained, same as שבת שובה. The
  // two star notes share a line and sit in the order the printed chart's footer has them.
  //
  // Each line carries the direction it has to be set in, because they do not agree. The
  // underline line is an English sentence with Hebrew in it and is left to right; the star
  // line is Hebrew and is right to left, and setting it the other way puts the star on the
  // far side of the phrase instead of against the word it belongs to. Same split as the
  // week card's legend in week-view.js, and the same as the printed chart's own footer.
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');
  return {
    hebrewYear: hebrewYearNum,
    yearLabel: hebrewYear(hebrewYearNum),
    rows,
    days,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
