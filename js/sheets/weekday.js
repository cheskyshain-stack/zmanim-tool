// Weekday Zmanim chart — unlike שבת קיץ/חורף, nothing here is computed from
// sunrise/sunset: מנחה and מעריב are plain editable text per week (pre-filled from a
// shul-wide default set in Settings, then adjusted per week the same way any Shabbos
// sheet cell is — click to edit, which stores a per-cell override on top of this
// "computed" default), and שחרית is one fixed schedule that's identical every week.
export function buildWeekdayRow(week, settings) {
  return {
    B: settings.weekdayDefaultMaariv || '',
    C: settings.weekdayDefaultMincha || '',
    E: settings.weekdayShacharis || '',
  };
}

export const WEEKDAY_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'E', header: 'שחרית' },
];
