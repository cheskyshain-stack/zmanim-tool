// שבת חורף (Winter Shabbos) column formulas, ported 1:1 from the workbook's
// WINTER_ZMANIM_1 table (columns B:J). `week.serial` is the Shabbos (Saturday)
// Excel-style serial date; Friday-anchored columns use `week.serial - 1`.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { ceilToMinute, floorToMinute, formatTime, underlineTime } from '../format.js';
import { inPlagWindow, fridayMainMinchaMenu, shabbosMinchaMenu, shacharisLine, candleLightingCell } from './common.js';
import { textjoin, SLASH } from '../util.js';

export function buildChorefRow(week, settings) {
  const shabbos = week.serial;
  const friday = shabbos - 1;
  const shabbosDate = dateFromSerial(shabbos);
  const fridayDate = dateFromSerial(friday);

  const B = `${formatTime(ceilToMinute(Z.tzais60(shabbosDate, settings)))}${SLASH}${underlineTime(ceilToMinute(Z.tzais72(shabbosDate, settings)))}`;
  const C = shabbosMinchaMenu(shabbosDate, settings);
  const D = `${formatTime(Z.sofZmanShmaMGA72(shabbosDate, settings))}${SLASH}${formatTime(Z.sofZmanShmaGRA(shabbosDate, settings))}`;
  const E = shacharisLine();

  const sunsetFriday = Z.sunset(fridayDate, settings);
  const F = underlineTime(floorToMinute(sunsetFriday + 50 / 1440));

  const G = inPlagWindow(friday, settings)
    ? textjoin(SLASH, true, [
        formatTime(Z.plagHamincha(fridayDate, settings) - 15 / 1440),
        formatTime(Z.plagHaminchaCustom(Z.tzais50(fridayDate, settings), Z.alos16_1(fridayDate, settings)) - 15 / 1440),
        formatTime(Z.plagHaminchaCustom(Z.tzais72(fridayDate, settings), Z.alos16_1(fridayDate, settings)) - 15 / 1440),
        formatTime(floorToMinute(sunsetFriday - 15 / 1440)),
      ])
    : formatTime(floorToMinute(sunsetFriday - 15 / 1440));

  const H = candleLightingCell(fridayDate, settings);
  const I = fridayMainMinchaMenu(fridayDate, settings);

  return { B, C, D, E, F, G, H, I };
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
