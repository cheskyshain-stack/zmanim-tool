// שבת קיץ (Summer Shabbos) column formulas, ported 1:1 from the workbook's
// SUMMER_ZMANIM_1 table (columns B:M). `week.serial` is the Shabbos (Saturday)
// Excel-style serial date; Friday-anchored columns use `week.serial - 1`.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { ceilToMinute, floorToMinute, formatTime, underlineTime } from '../format.js';
import { T, inPlagWindow, fridayMainMinchaMenu, tishaBavMaariv, shabbosMinchaMenu, shacharisLine, candleLightingCell } from './common.js';
import { SLASH } from '../util.js';
import { zman } from '../zmanim/trace.js';

/** AND(dayOfYear>16, dayOfYear<65): roughly the Sefirah stretch (after Pesach, before
 *  Shavuos), where the workbook adds a few extra minutes to the Friday Maariv time and
 *  offers a second (later) Maariv. */
function inExtraMaarivWindow(serial, settings) {
  const doy = hebrewDateExtended(serial, settings.useGregorianBefore1582).dayOfYear;
  return doy > 16 && doy < 65;
}

/** The three early מנחה and פלג pairs of an ערב שבת, in the order the chart's own columns hold
 *  them: the מגן אברהם counted to צאת 72, the same counted to צאת 50, and the גר"א.
 *
 *  Columns I, J and K are these three, one to a cell as the מנין over its פלג, and the פסח
 *  sheet prints the same three on its שבת חול המועד and on שביעי של פסח, where the shul asked
 *  for the קיץ chart's early Shabbos and early יום טוב times with all the plags. Handed back
 *  structured rather than as those cells so a poster can set them its own way, and worked out
 *  here so the board and the sheet cannot come to different numbers.
 *
 *  מנחה is a quarter of an hour before its own פלג, and both are put up to the whole minute,
 *  which is what the columns have always done.
 *
 *  Where each מנין davens is in the chart's column headers rather than in its cells, so it is
 *  carried here instead: I is בעזר"נ, which is a star, J is למטה, which is an underline, and K
 *  is the main בית מדרש and takes neither. A poster has no column headers to say it. `name` is
 *  the same header's own way of telling the two מ"א apart, the 72 being the צאת the day is
 *  counted to. */
export function earlyMinchaPlag(fridayDate, settings) {
  const alos = Z.alos16_1(fridayDate, settings);
  const pairs = [
    { name: 'מ"א 72', plag: Z.plagHaminchaCustom(Z.tzais72(fridayDate, settings), alos), underlined: false, mark: '*' },
    { name: 'מ"א', plag: Z.plagHaminchaCustom(Z.tzais50(fridayDate, settings), alos), underlined: true, mark: '' },
    { name: 'גר"א', plag: Z.plagHamincha(fridayDate, settings), underlined: false, mark: '' },
  ];
  /* `trace` is added beside the numbers rather than replacing them: every existing caller,
     the פסח sheet included, keeps reading .plag and .mincha as before. See zmanim/trace.js. */
  return pairs.map((p) => {
    const base = zman(`פלג המנחה ${p.name}`, p.plag, 'the day measured to the צאת its name gives');
    const plagT = base.ceil();
    let minchaT = base.minus(15, 'the מנין is a quarter of an hour before its own פלג').ceil();
    if (p.underlined) minchaT = minchaT.underline();
    return { ...p, plag: ceilToMinute(p.plag), mincha: ceilToMinute(p.plag - 15 / 1440),
             trace: { plag: plagT, mincha: minchaT } };
  });
}

/** Whether the early מנחה and פלג are printed at all on a given ערב שבת or ערב יום טוב. */
export function hasEarlyPlag(friday, settings) {
  return inPlagWindow(friday, settings);
}

export function buildKayitzRow(week, settings) {
  const shabbos = week.serial;
  const friday = shabbos - 1;
  const shabbosDate = dateFromSerial(shabbos);
  const fridayDate = dateFromSerial(friday);

  /* Built through traced values, which do the arithmetic and record what it meant in the
     same call: see zmanim/trace.js, and the note at the head of sheets/choref.js. The
     printed strings are unchanged, proved by diffing a season of cells against the old
     output. */
  const tishaEvening = tishaBavMaariv(shabbos, settings)?.split('\n');

  const tz60 = zman('צאת 60', Z.tzais60(shabbosDate, settings), '60 minutes after שקיעה, taken at the shul\'s elevation').ceil();
  const tz72 = zman('צאת 72', Z.tzais72(shabbosDate, settings), '72 minutes after שקיעה, taken at the shul\'s elevation').ceil().underline();
  const B = tishaEvening?.slice(1).join('\n') ?? `${tz60.text()}${SLASH}${tz72.text()}`;

  const C = shabbosMinchaMenu(shabbosDate, settings, week.specialParsha) + (tishaEvening ? '\n' + tishaEvening[0] : '');

  const shmaMGA = zman('סוף זמן קריאת שמע מ״א', Z.sofZmanShmaMGA72(shabbosDate, settings), 'the day measured from עלות 72 to צאת 72');
  const shmaGRA = zman('סוף זמן קריאת שמע גר״א', Z.sofZmanShmaGRA(shabbosDate, settings), 'the day measured from sunrise to שקיעה');
  const D = `${shmaMGA.text()}${SLASH}${shmaGRA.text()}`;
  const E = shacharisLine();

  const extraMaariv = inExtraMaarivWindow(friday, settings);
  const sefirah = 'the Sefirah stretch, after Pesach and before Shavuos';
  const sunsetFriday = Z.sunset(fridayDate, settings);
  const maarivFri = zman('שקיעה', sunsetFriday, 'on the Friday')
    .plus(extraMaariv ? 55 : 50, extraMaariv ? `55 rather than 50, this week falling in ${sefirah}` : undefined)
    .floor().underline();
  const F = maarivFri.text();

  const minchaFri = zman('שקיעה', sunsetFriday, 'on the Friday').minus(15).floor();
  const gBase = floorToMinute(sunsetFriday - 15 / 1440);
  const secondMaariv = zman('שקיעה', sunsetFriday, 'on the Friday').plus(30).floor()
    .onlyWhen(extraMaariv, `printed only inside ${sefirah}`);
  const G = formatTime(gBase) + (extraMaariv ? `\nמעריב\u00a0${secondMaariv.text()}` : '');

  const H = candleLightingCell(fridayDate, settings);

  const plagWindow = inPlagWindow(friday, settings);
  const [early72, early50, earlyGRA] = earlyMinchaPlag(fridayDate, settings);
  // Each column is one of those pairs as the chart writes it: the מנין on one line, "פלג" and
  // its own זמן under it. NBSP after the word so the pair can never wrap apart.
  const cell = (e) => `${e.underlined ? underlineTime(e.mincha) : formatTime(e.mincha)}\nפלג ${formatTime(e.plag)}`;
  const I = plagWindow ? cell(early72) : '';
  const J = plagWindow ? cell(early50) : '';
  const K = plagWindow ? cell(earlyGRA) : '';

  const L = fridayMainMinchaMenu(fridayDate, settings);

  /* Only the columns this file works out itself. C, E, H and L come from sheets/common.js
     and carry their traces once that file is converted; a column with no trace yet is drawn
     by the calculations page as "not written up", never silently blank. */
  const early = (e) => [e.trace.mincha, e.trace.plag];
  const traces = {
    B: tishaEvening ? null : [tz60, tz72],
    D: [shmaMGA, shmaGRA],
    F: [maarivFri],
    G: extraMaariv ? [minchaFri, secondMaariv] : [minchaFri],
    I: plagWindow ? early(early72) : null,
    J: plagWindow ? early(early50) : null,
    K: plagWindow ? early(earlyGRA) : null,
  };

  return { B, C, D, E, F, G, H, I, J, K, L, traces };
}

export const KAYITZ_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'D', header: 'ס"ז קר"ש\nגר״א / מ״א' },
  { key: 'E', header: 'שחרית' },
  { key: 'F', header: ' מעריב ' },
  { key: 'G', header: 'מנחה\nמעריב' },
  { key: 'H', header: 'הדלקת\nנרות' },
  // Both I and J are פלג מ"א; the difference is the tzais the day is measured to - 72
  // minutes here, 50 in J (see plagMA/plagMA2 above). The "72" says which is which, and
  // sits after פלג מ"א on its own line to match the printed board.
  { key: 'I', header: 'מנחה\n(בעזר"נ)\nפלג מ"א 72' },
  { key: 'J', header: 'מנחה\n(למטה)\nפלג מ"א' },
  { key: 'K', header: 'מנחה\nפלג גר"א' },
  { key: 'L', header: 'מנחה\nערב שבת' },
];

