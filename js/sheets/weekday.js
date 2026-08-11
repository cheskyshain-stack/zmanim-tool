// Weekday Zmanim chart — unlike שבת קיץ/חורף, nothing here is computed from
// sunrise/sunset: מנחה and מעריב are plain editable text per week (pre-filled from a
// shul-wide default set in Settings, then adjusted per week the same way any Shabbos
// sheet cell is — click to edit, which stores a per-cell override on top of this
// "computed" default), and שחרית is one fixed schedule that's identical every week.
export function buildWeekdayRow(week, settings) {
  return {
    // A blank cell here (before any default is set in Settings) used to look
    // indistinguishable from "nothing generated" — a placeholder makes clear the chart
    // did generate and just needs its defaults filled in.
    B: settings.weekdayDefaultMaariv || '(set default מעריב in Settings)',
    C: settings.weekdayDefaultMincha || '(set default מנחה in Settings)',
    E: settings.weekdayShacharis || '(set שחרית schedule in Settings)',
  };
}

export const WEEKDAY_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'E', header: 'שחרית' },
];
