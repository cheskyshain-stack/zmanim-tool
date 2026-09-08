// שבת קיץ (Summer Shabbos) column formulas, ported 1:1 from the workbook's
// SUMMER_ZMANIM_1 table (columns B:M). `week.serial` is the Shabbos (Saturday)
// Excel-style serial date; Friday-anchored columns use `week.serial - 1`.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { ceilToMinute, floorToMinute, formatTime, underlineTime } from '../format.js';
import { T, inPlagWindow, fridayMainMinchaMenu, shabbosMinchaMenu, shacharisLine, candleLightingCell } from './common.js';
import { SLASH } from '../util.js';

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
  return pairs.map((p) => ({ ...p, plag: ceilToMinute(p.plag), mincha: ceilToMinute(p.plag - 15 / 1440) }));
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

  const B = `${formatTime(ceilToMinute(Z.tzais60(shabbosDate, settings)))}${SLASH}${underlineTime(ceilToMinute(Z.tzais72(shabbosDate, settings)))}`;
  const C = shabbosMinchaMenu(shabbosDate, settings, week.specialParsha);
  const D = `${formatTime(Z.sofZmanShmaMGA72(shabbosDate, settings))}${SLASH}${formatTime(Z.sofZmanShmaGRA(shabbosDate, settings))}`;
  const E = shacharisLine();

  const extraMaariv = inExtraMaarivWindow(friday, settings);
  const sunsetFriday = Z.sunset(fridayDate, settings);
  const F = underlineTime(floorToMinute(sunsetFriday + (extraMaariv ? 55 : 50) / 1440));

  const gBase = floorToMinute(sunsetFriday - 15 / 1440);
  const G = formatTime(gBase) + (extraMaariv ? `\nמעריב ${formatTime(floorToMinute(sunsetFriday + 30 / 1440))}` : '');

  const H = candleLightingCell(fridayDate, settings);

  const plagWindow = inPlagWindow(friday, settings);
  const [early72, early50, earlyGRA] = earlyMinchaPlag(fridayDate, settings);
  // Each column is one of those pairs as the chart writes it: the מנין on one line, "פלג" and
  // its own זמן under it. NBSP after the word so the pair can never wrap apart.
  const cell = (e) => `${e.underlined ? underlineTime(e.mincha) : formatTime(e.mincha)}\nפלג\u00a0${formatTime(e.plag)}`;
  const I = plagWindow ? cell(early72) : '';
  const J = plagWindow ? cell(early50) : '';
  const K = plagWindow ? cell(earlyGRA) : '';

  const L = fridayMainMinchaMenu(fridayDate, settings);

  return { B, C, D, E, F, G, H, I, J, K, L };
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
