// Weekday Zmanim chart — unlike שבת קיץ/חורף, nothing here is computed from
// sunrise/sunset: מנחה and מעריב are chosen per week from a shul-wide list of options
// set in Settings (rendered as a dropdown on the sheet, with a free-text "Other" escape
// hatch), and שחרית is one fixed schedule that's identical every week, sourced directly
// from Settings at render time (see sheet-view.js) rather than through this row builder.

/** Settings.weekdayDefaultMincha/weekdayDefaultMaariv are one dropdown option per line
 *  — blank lines ignored. The first option is the default a fresh (unedited) week's
 *  cell starts on. */
export function weekdayMinchaOptions(settings) {
  return String(settings.weekdayDefaultMincha || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
export function weekdayMaarivOptions(settings) {
  return String(settings.weekdayDefaultMaariv || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildWeekdayRow(week, settings) {
  const minchaOptions = weekdayMinchaOptions(settings);
  const maarivOptions = weekdayMaarivOptions(settings);
  return {
    // A blank cell here (before any option is set in Settings) used to look
    // indistinguishable from "nothing generated" — a placeholder makes clear the chart
    // did generate and just needs its options filled in.
    B: maarivOptions[0] || '(set default מעריב in Settings)',
    C: minchaOptions[0] || '(set default מנחה in Settings)',
  };
}

export const WEEKDAY_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'E', header: 'שחרית' },
];
