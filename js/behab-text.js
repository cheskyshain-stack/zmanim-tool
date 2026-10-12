import { erevWhereMark } from './erev-text.js';
import { hebrewDateExtended } from './hebrew-calendar.js';
import { buildBehabShacharisPoster } from './posters/shacharis.js';

/** The first four chart minyanim say Behab; the remaining three do not, as in the
 *  shul's supplied message. Read every time and room mark from the BHB handout. */
export function behabText(poster, day, today = null) {
  if (!poster?.days?.includes(day) || !poster.rows?.length) return '';
  const list = (rows, notes = false) => rows.map(row => row.text + erevWhereMark(row)
    + (notes && row.timeNote && poster.selichosDays?.includes(day) ? ' (Selichos before Shacharis)' : '')).join(', ');
  const early = list(poster.rows.slice(0, 4), true);
  const later = list(poster.rows.slice(4));
  return [`${today === day ? 'Today' : 'Tomorrow'} Behab`, early,
    ...(later ? [later] : [])].join('\n');
}

/** Both annual rounds use the handout's own calendar dates. A single card covers
 *  one morning, so mixed Selichos notes remain specific to that date. */
export function behabMessagesBetween(from, to, settings, tables) {
  const messages = [];
  const firstYear = hebrewDateExtended(from, settings.useGregorianBefore1582).year;
  const lastYear = hebrewDateExtended(to, settings.useGregorianBefore1582).year;
  for (let year = firstYear; year <= lastYear; year++) for (const month of [8, 2]) {
    const poster = buildBehabShacharisPoster(year, month, settings, tables);
    if (!poster) continue;
    for (const day of poster.days) {
      if (day < from || day > to) continue;
      const text = behabText(poster, day, from);
      if (text) messages.push({ day, year, round: month === 8 ? 'After Sukkos' : 'After Pesach', text });
    }
  }
  return messages.sort((a, b) => a.day - b.day);
}
