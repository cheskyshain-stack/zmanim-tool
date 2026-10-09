import { dateFromHebrew, hasBehab } from '../hebrew-calendar.js';
import { buildAsaraBTevesPoster, ASARA_TEXT } from './asarabteves.js';
import { specialShacharisLines } from './special-shacharis.js';

export const BEHAB_SHACHARIS_TEXT = {
  afterSukkos: 'בה"ב אחר סוכות',
  afterPesach: 'בה"ב אחר פסח',
};

/** Resolve the chart's marks into words for a poster that needs no location key. */
function shacharisRoomRows(cells) {
  return cells.map(cell => ({
    ...cell,
    room: cell.mark === '**' ? 'באולם השמחות' : cell.mark === '*' ? 'בעזרת נשים'
      : cell.underlined ? 'בית מדרש למטה' : 'בית מדרש',
  }));
}

export function buildAsaraShacharisPoster(year, settings) {
  const full = buildAsaraBTevesPoster(year, settings);
  if (!full) return null;
  return {
    hebrewYear: year, title: ASARA_TEXT.title, subtitle: ASARA_TEXT.shacharis,
    span: full.span,
    rows: shacharisRoomRows(full.sets.find(set => set.calc === 'shacharis').lines.flat()),
  };
}

/** Use the same calendar rule as the chart and weekly schedule for both BHB rounds. */
export function behabShacharisDates(year, month, settings) {
  if (!year || ![2, 8].includes(month)) return [];
  const first = dateFromHebrew(1, month, year);
  return Array.from({ length: 17 }, (_, i) => first + i).filter(serial => hasBehab(serial, settings));
}

export function buildBehabShacharisPoster(year, month, settings) {
  const days = behabShacharisDates(year, month, settings);
  if (!days.length) return null;
  return {
    hebrewYear: year, title: month === 8 ? BEHAB_SHACHARIS_TEXT.afterSukkos : BEHAB_SHACHARIS_TEXT.afterPesach,
    subtitle: 'שחרית',
    span: { from: days[0], to: days.at(-1) }, days,
    rows: shacharisRoomRows(specialShacharisLines().flat()),
  };
}
