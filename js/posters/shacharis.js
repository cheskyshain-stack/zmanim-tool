import { dateFromHebrew, hasBehab, roshHashana, excelWeekday, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';
import { buildAsaraBTevesPoster, ASARA_TEXT } from './asarabteves.js';
import { specialShacharisLines } from './special-shacharis.js';
import { nextRoshChodesh } from '../rosh-chodesh-text.js';
import { buildChanukahPoster } from './chanukah.js';

export const BEHAB_SHACHARIS_TEXT = {
  afterSukkos: 'בה"ב אחר סוכות',
  afterPesach: 'בה"ב אחר פסח',
};

export const ROSH_CHODESH_SHACHARIS_MONTHS = [8, 9, 10, 11, 12, 13, 14, 1, 2, 3, 4, 5, 6];
export const roshChodeshShacharisTitle = month => `ראש חודש ${JEWISH_MONTHS_HE[month - 1]}`;

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

/** Read the same one- or two-day occasions as the Rosh Chodesh messages. Walking
 *  the calendar also handles both Adars without inverse month arithmetic. */
export function buildRoshChodeshShacharisPoster(year, month, settings) {
  if (!year || !ROSH_CHODESH_SHACHARIS_MONTHS.includes(month)) return null;
  const end = roshHashana(year - 3760);
  let from = roshHashana(year - 3761);
  while (from < end) {
    const rc = nextRoshChodesh(from, settings.useGregorianBefore1582);
    if (!rc || rc.year !== year) return null;
    from = rc.last + 1;
    if (rc.month !== month) continue;
    // The seven-room morning schedule is for Sunday through Friday.
    const days = Array.from({ length: rc.last - rc.first + 1 }, (_, i) => rc.first + i)
      .filter(serial => excelWeekday(serial) !== 7);
    if (!days.length) return null;
    const chanukah = month === 10
      ? buildChanukahPoster(year, settings)?.shacharisRows.find(row => row.isRoshChodesh) : null;
    const cells = chanukah
      ? chanukah.cells.map((cell, i) => i === 0
        ? { ...cell, text: chanukah.vasikin.time, trace: chanukah.vasikin.trace, traces: undefined } : cell)
      : specialShacharisLines().flat();
    return {
      hebrewYear: year, month,
      title: roshChodeshShacharisTitle(month) + (chanukah ? ' · חנוכה' : ''),
      subtitle: 'שחרית',
      dayLabel: `יום ${days.map(serial => `${['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו'][excelWeekday(serial)]}'`).join(' ')}`,
      span: { from: days[0], to: days.at(-1) }, days,
      rows: shacharisRoomRows(cells),
    };
  }
  return null;
}
