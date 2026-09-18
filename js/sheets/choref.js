// שבת חורף (Winter Shabbos) column formulas, ported 1:1 from the workbook's
// WINTER_ZMANIM_1 table (columns B:J). `week.serial` is the Shabbos (Saturday)
// Excel-style serial date; Friday-anchored columns use `week.serial - 1`.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { ceilToMinute, floorToMinute, formatTime, underlineTime } from '../format.js';
import { inPlagWindow, fridayMainMinchaMenu, tishaBavMaariv, shabbosMinchaMenu, shacharisLine, candleLightingCell } from './common.js';
import { textjoin, SLASH } from '../util.js';
import { zman } from '../zmanim/trace.js';

export function buildChorefRow(week, settings) {
  const shabbos = week.serial;
  const friday = shabbos - 1;
  const shabbosDate = dateFromSerial(shabbos);
  const fridayDate = dateFromSerial(friday);

  /* Each time is built through a traced value (zmanim/trace.js), which does the arithmetic
     and writes down what it did in the same call. The printed string is unchanged: .text()
     composes exactly what formatTime and underlineTime composed here before, and a whole
     season of cells is diffed against the old output to prove it. What is new is `traces`,
     which the calculations page reads so it can say what a time is instead of a paragraph
     of prose saying it a second time and being free to drift. */
  const tishaEvening = tishaBavMaariv(shabbos, settings)?.split('\n');

  const tz60 = zman('צאת 60', Z.tzais60(shabbosDate, settings), '60 minutes after שקיעה, taken at the shul\'s elevation').ceil();
  const tz72 = zman('צאת 72', Z.tzais72(shabbosDate, settings), '72 minutes after שקיעה, taken at the shul\'s elevation').ceil().underline();
  const B = tishaEvening?.slice(1).join('\n') ?? `${tz60.text()}${SLASH}${tz72.text()}`;

  const C = shabbosMinchaMenu(shabbosDate, settings, week.specialParsha) + (tishaEvening ? '\n' + tishaEvening[0] : '');

  const shmaMGA = zman('סוף זמן קריאת שמע מ״א', Z.sofZmanShmaMGA72(shabbosDate, settings), 'the day measured from עלות 72 to צאת 72');
  const shmaGRA = zman('סוף זמן קריאת שמע גר״א', Z.sofZmanShmaGRA(shabbosDate, settings), 'the day measured from sunrise to שקיעה');
  const D = `${shmaMGA.text()}${SLASH}${shmaGRA.text()}`;
  const E = shacharisLine();

  const sunsetFriday = Z.sunset(fridayDate, settings);
  const maarivFri = zman('שקיעה', sunsetFriday, 'on the Friday').plus(50).floor().underline();
  const F = maarivFri.text();

  /* The three פלג values are deliberately not rounded before the 15 is taken off them, which
     is why there is no .floor() on those three and there is one on the שקיעה line. */
  const plagGRA = zman('פלג המנחה גר״א', Z.plagHamincha(fridayDate, settings), 'the day measured from sunrise to שקיעה').minus(15);
  const plag50 = zman('פלג המנחה מ״א', Z.plagHaminchaCustom(Z.tzais50(fridayDate, settings), Z.alos16_1(fridayDate, settings)), 'the day measured from עלות 16.1 degrees to צאת 50').minus(15);
  const plag72 = zman('פלג המנחה מ״א 72', Z.plagHaminchaCustom(Z.tzais72(fridayDate, settings), Z.alos16_1(fridayDate, settings)), 'the day measured from עלות 16.1 degrees to צאת 72').minus(15);
  const minchaFri = zman('שקיעה', sunsetFriday, 'on the Friday').minus(15).floor();
  const plagWindow = inPlagWindow(friday, settings);

  const G = plagWindow
    ? textjoin(SLASH, true, [plagGRA.text(), plag50.text(), plag72.text(), minchaFri.text()])
    : minchaFri.text();

  const H = candleLightingCell(fridayDate, settings);
  const I = fridayMainMinchaMenu(fridayDate, settings);

  /* Only the columns this file works out itself. C, E, H and I come from sheets/common.js
     and carry their traces once that file is converted too; a column with no trace yet is
     drawn by the calculations page as "not written up", never silently blank. */
  const traces = {
    B: tishaEvening ? null : [tz60, tz72],
    D: [shmaMGA, shmaGRA],
    F: [maarivFri],
    G: plagWindow ? [plagGRA, plag50, plag72, minchaFri] : [minchaFri],
  };

  return { B, C, D, E, F, G, H, I, traces };
}

export const CHOREF_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'D', header: 'ס"ז קר"ש\nגר״א / מ״א' },
  { key: 'E', header: 'שחרית' },
  { key: 'F', header: 'מעריב' },
  { key: 'G', header: 'מנחה\nמעריב' },
  { key: 'H', header: 'הדלקת\nנרות' },
  { key: 'I', header: 'מנחה\nערב שבת' },
];

