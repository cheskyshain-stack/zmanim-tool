// Publishing a season for the congregation.
//
// Everything in this app lives in one browser's localStorage, so a visitor's browser has
// nothing to show. Publishing writes the season into a file that ships with the site, at
// data/published.json, which the luach (index.html?luach) reads instead of
// localStorage. That is the whole mechanism: no backend, no login, no database.
//
// A season is published once. The luach then advances by itself every week, because the
// week it shows is worked out from today's date against the weeks in the file.

/** What the luach needs, and nothing else.
 *
 *  The sheets are carried whole (weeks and overrides included) rather than as
 *  pre-rendered times, so the luach runs the same code the app does and a manual edit or
 *  a rule shows up there exactly as it does here. Rules travel too, for the same reason.
 *  Settings are trimmed to what the card actually prints: no location maths is redone on
 *  the luach, but the header, footer and שחרית schedules are all read from here. */
export function buildPublishedPayload(state, sheets) {
  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    settings: state.settings,
    rules: state.rules,
    sheets: sheets.map((s) => ({
      id: s.id,
      season: s.season,
      hebrewYear: s.hebrewYear,
      linkedSheetId: s.linkedSheetId,
      weeks: s.weeks,
      pageSizes: s.pageSizes,
      overrides: s.overrides || {},
    })),
  };
}

/** The Shabbos sheets worth publishing, newest first, each with its weekday companion. */
export function publishableGroups(state) {
  return state.sheets
    .filter((s) => s.season !== 'weekday')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((sheet) => ({
      sheet,
      weekday: state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null,
    }));
}

export function downloadPublished(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'published.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads what is currently published, or null when nothing is. A 404 is the normal state
 *  before the first publish, not an error worth shouting about. */
export async function loadPublished() {
  try {
    const res = await fetch('/data/published.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.sheets) && data.sheets.length ? data : null;
  } catch {
    return null;
  }
}
