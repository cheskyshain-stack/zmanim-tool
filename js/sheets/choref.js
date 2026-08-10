// שבת חורף (Winter Shabbos) column formulas, ported 1:1 from the workbook's
// WINTER_ZMANIM_1 table (columns B:J). `week.serial` is the Shabbos (Saturday)
// Excel-style serial date; Friday-anchored columns use `week.serial - 1`.
//
// Column layout: once a חורף week reaches the *spring* DST cutover (see
// inSpringDstWindow in common.js — deliberately not the Sukkos-time fall DST window),
// the extra Plag-Hamincha columns become relevant the same way they are on שבת קיץ, so
// from that point the season needs שבת קיץ's fuller column set. A printed table can't
// change column count row-to-row, so CHOREF_COLUMNS matches KAYITZ_COLUMNS exactly for
// the whole season — the three Plag columns (I/J/K) just render blank for the
// core-winter weeks before the cutover, matching קיץ's own "blank outside the Plag
// window" behavior for those same columns.
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { ceilToMinute, floorToMinute, formatTime, underlineTime } from '../format.js';
import { inPlagWindow, inSpringDstWindow, fridayMainMinchaMenu, shabbosMinchaMenu, shacharisLine, candleLightingCell } from './common.js';
import { textjoin, SLASH } from '../util.js';
import { KAYITZ_COLUMNS } from './kayitz.js';

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

  // I/J/K: blank until the season reaches the spring DST cutover, then computed
  // exactly like שבת קיץ's own I/J/K (same formulas as kayitz.js's buildKayitzRow).
  const useExtraPlagColumns = inSpringDstWindow(fridayDate, settings);
  const plagMA = Z.plagHaminchaCustom(Z.tzais72(fridayDate, settings), Z.alos16_1(fridayDate, settings));
  const I = useExtraPlagColumns ? `${formatTime(ceilToMinute(plagMA - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagMA))}` : '';

  const plagMA2 = Z.plagHaminchaCustom(Z.tzais50(fridayDate, settings), Z.alos16_1(fridayDate, settings));
  const J = useExtraPlagColumns ? `${underlineTime(ceilToMinute(plagMA2 - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagMA2))}` : '';

  const plagGRA = Z.plagHamincha(fridayDate, settings);
  const K = useExtraPlagColumns ? `${formatTime(ceilToMinute(plagGRA - 15 / 1440))}\nפלג ${formatTime(ceilToMinute(plagGRA))}` : '';

  const L = fridayMainMinchaMenu(fridayDate, settings); // was column I before the widening to קיץ's layout

  return { B, C, D, E, F, G, H, I, J, K, L };
}

export const CHOREF_COLUMNS = KAYITZ_COLUMNS;
