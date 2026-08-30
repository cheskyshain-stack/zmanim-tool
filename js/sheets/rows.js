// Building a week's printed row, and finding which sheet holds a given week.
//
// Its own module rather than part of the week view, because upcoming.js needs exactly
// these and nothing else the view has. Taking them from the view made upcoming.js depend
// on the UI, and through it on the chart view, which put anything importing upcoming.js
// into a cycle with the very views that wanted it.
import { inSpringDstWindow } from './common.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from './kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from './choref.js';
import { applyRules } from '../rules.js';
import { mergeRow } from '../overrides.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';

/** Every week worth showing, newest sheet first, so a week that appears in more than one
 *  saved sheet resolves to the most recently generated one.
 *
 *  Shabbos sheets first, then any week a Weekday chart has that they do not. A Yom Tov
 *  Shabbos has no parsha, so it is left out of the Shabbos chart, but the days before it
 *  are ordinary days that are davened and its Weekday chart carries them. Indexing only
 *  the Shabbos sheets left those weeks off the site altogether: שבועות, ראש השנה and
 *  סוכות each had a full set of weekday times published and no way to reach them. Such a
 *  week comes through with no Shabbos sheet, and renders as the חול card on its own. */
export function weekIndex(state) {
  const sheets = [...state.sheets].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const bySerial = new Map();
  // A saved week's date is an ISO string, not a Date: it went through localStorage. The
  // zmanim code calls Date methods on it, so revive it the way sheet-view does.
  const add = (week, sheet) => {
    if (!bySerial.has(week.serial)) bySerial.set(week.serial, { week: { ...week, date: new Date(week.date) }, sheet });
  };
  for (const sheet of sheets) {
    if (sheet.season === 'weekday') continue;
    for (const week of sheet.weeks) add(week, sheet);
  }
  for (const sheet of sheets) {
    if (sheet.season !== 'weekday') continue;
    for (const week of sheet.weeks) add(week, null); // null: no Shabbos chart covers it
  }
  return bySerial;
}

/** The Weekday chart holding a given week, whether it came in beside a Shabbos sheet or
 *  is the only chart that has the week at all. */
export function weekdayChartFor(sheet, serial, state) {
  if (sheet) return weekdayCompanionOf(sheet, state);
  return state.sheets.find((s) => s.season === 'weekday' && s.weeks.some((w) => w.serial === serial)) || null;
}

/** The weekday chart generated alongside a given Shabbos sheet, if there is one. */
export function weekdayCompanionOf(sheet, state) {
  return state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
}


/** The chart row for one week, with rules and manual overrides applied, exactly as the
 *  printed chart would show it. */
export function rowFor(week, sheet, state, settings) {
  const effectiveSeason = sheet.season === 'choref' && inSpringDstWindow(week.date, settings) ? 'kayitz' : sheet.season;
  const columns = effectiveSeason === 'kayitz' ? KAYITZ_COLUMNS : CHOREF_COLUMNS;
  const build = effectiveSeason === 'kayitz' ? buildKayitzRow : buildChorefRow;
  const hebrew = hebrewDateExtended(week.serial, settings.useGregorianBefore1582);
  const computed = build(week, settings);
  const ruled = applyRules(computed, { ...week, hebrew }, state.rules, effectiveSeason, new Set());
  const { row, overriddenKeys } = mergeRow(ruled, sheet, week.serial);
  return { row, columns, overriddenKeys };
}

