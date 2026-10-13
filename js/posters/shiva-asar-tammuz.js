import { dateFromHebrew, excelWeekday } from '../hebrew-calendar.js';
import { ASARA_TEXT, buildFastDayPoster } from './asarabteves.js';

export const TAMMUZ_TEXT = { ...ASARA_TEXT, title: 'שבעה עשר בתמוז', fridayTitle: 'שבעה עשר בתמוז · ערב שבת' };

/** A fast on Shabbos is observed on Sunday, the eighteenth. */
export function shivaAsarTammuzSerial(year) {
  const date = dateFromHebrew(17, 4, year);
  return excelWeekday(date) === 7 ? date + 1 : date;
}

export function buildShivaAsarTammuzPoster(year, settings) {
  if (!year) return null;
  return buildFastDayPoster(year, settings, shivaAsarTammuzSerial(year), TAMMUZ_TEXT);
}
