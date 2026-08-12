// Weekday Zmanim chart - unlike שבת קיץ/חורף, nothing here is computed from
// sunrise/sunset: מנחה and מעריב start blank and are typed in per week (they differ
// every week, so there's no sensible default to seed them with), and שחרית is one fixed
// schedule that's identical every week, sourced directly from Settings at render time
// (see sheet-view.js) rather than through this row builder.
//
// Typing into those cells still takes the time shorthand every other cell does -
// "1220 130" becomes "12:20/1:30" on blur (see ui/rich-text.js).
export function buildWeekdayRow() {
  return { B: '', C: '' };
}

export const WEEKDAY_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'E', header: 'שחרית' },
];
