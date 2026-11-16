const SITE_HOST = 'baismedrashoflakewoodcommons.org';
const SETTINGS_URL = 'https://' + SITE_HOST + '/data/published.json';
const REFRESH_MS = 60_000;
let publishedSchedule;
let refreshAfter = 0;

export function validPublishedSchedule(value) {
  return value !== null && typeof value === 'object' &&
    Number.isFinite(Date.parse(value.publishedAt)) &&
    value.settings !== null && typeof value.settings === 'object' &&
    Array.isArray(value.sheets) && Array.isArray(value.rules);
}

export async function loadCongregationSchedule(request) {
  if (new URL(request.url).hostname !== SITE_HOST) return undefined;
  const now = Date.now();
  if (now < refreshAfter) return publishedSchedule;
  try {
    const response = await fetch(SETTINGS_URL, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error('Congregation schedule returned ' + response.status);
    const nextSchedule = await response.json();
    if (!validPublishedSchedule(nextSchedule)) throw new Error('Invalid congregation schedule');
    publishedSchedule = nextSchedule;
    refreshAfter = now + REFRESH_MS;
  } catch {
    // Keep the last successful public settings on weak connections.
    refreshAfter = now + 15_000;
  }
  return publishedSchedule;
}
