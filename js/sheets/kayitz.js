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

export function buildKayitzRow(week, settings) {
  const shabbos = week.serial;
  const friday = shabbos - 1;
  const shabbosDate = dateFromSerial(shabbos);
  const fridayDate = dateFromSerial(friday);

  const B = `${formatTime(ceilToMinute(Z.tzais60(shabbosDate, settings)))}${SLASH}${underlineTime(ceilToMinute(Z.tzais72(shabbosDate, settings)))}`;
  const C = shabbosMinchaMenu(shabbosDate, settings);
  const D = `${formatTime(Z.sofZmanShmaMGA72(shabbosDate, settings))}${SLASH}${formatTime(Z.sofZmanShmaGRA(shabbosDate, settings))}`;
  const E = shacharisLine();

  const extraMaariv = inExtraMaarivWindow(friday, settings);
  const sunsetFriday = Z.sunset(fridayDate, settings);
  const F = underlineTime(floorToMinute(sunsetFriday + (extraMaariv ? 55 : 50) / 1440));

  const gBase = floorToMinute(sunsetFriday - 15 / 1440);
  const G = formatTime(gBase) + (extraMaariv ? `\nמעריב ${formatTime(floorToMinute(sunsetFriday + 30 / 1440))}` : '');

  const H = candleLightingCell(fridayDate, settings);

  const plagWindow = inPlagWindow(friday, settings);
  const plagMA = Z.plagHaminchaCustom(Z.tzais72(fridayDate, settings), Z.alos16_1(fridayDate, settings));
  const I = plagWindow ? `${formatTime(ceilToMinute(plagMA - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagMA))}` : '';

  const plagMA2 = Z.plagHaminchaCustom(Z.tzais50(fridayDate, settings), Z.alos16_1(fridayDate, settings));
  const J = plagWindow ? `${underlineTime(ceilToMinute(plagMA2 - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagMA2))}` : '';

  const plagGRA = Z.plagHamincha(fridayDate, settings);
  const K = plagWindow ? `${formatTime(ceilToMinute(plagGRA - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagGRA))}` : '';

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
  { key: 'I', header: 'מנחה\nפלג מ"א' },
  { key: 'J', header: 'מנחה\n(למטה)\nפלג מ"א' },
  { key: 'K', header: 'מנחה\nפלג גר"א' },
  { key: 'L', header: 'מנחה\nערב שבת' },
];
