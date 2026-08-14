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

// --- Publishing straight to the site ------------------------------------------------
//
// The site is static files in a GitHub repository, so "publish" means committing
// data/published.json to that repository. A browser can do that through GitHub's own
// API, which needs a token to prove it is allowed to.
//
// The token is kept under its own localStorage key rather than inside the app state, so
// it can never ride along in an exported backup. A backup gets shared; a write token
// must not.

const REPO_OWNER = 'cheskyshain-stack';
const REPO_NAME = 'zmanim-tool';
const REPO_BRANCH = 'main';
const PUBLISH_PATH = 'data/published.json';
const TOKEN_KEY = 'zmanim-publish-token';

export function getPublishToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setPublishToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

/** UTF-8 safe base64, which is what the API wants the file contents as. btoa alone
 *  throws on any Hebrew character, and this file is full of them. */
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // In chunks: apply() on a 100KB array overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

async function api(path, token, options = {}) {
  return fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}

/** Whatever is published right now, straight from the repository rather than from the
 *  deployed site, so it is accurate the moment after a publish instead of a minute
 *  later. Returns { data, sha } with data null when nothing is published yet. */
export async function fetchPublished(token) {
  const res = await api(`contents/${PUBLISH_PATH}?ref=${REPO_BRANCH}`, token);
  if (res.status === 404) return { data: null, sha: undefined };
  if (res.status === 401) throw new Error('That token was refused. It may be wrong, expired, or revoked.');
  if (res.status === 403) throw new Error('That token is not allowed to read this repository.');
  if (!res.ok) throw new Error(`GitHub replied ${res.status} when reading what is published.`);
  const body = await res.json();
  // The API returns base64 wrapped across lines, which atob will not accept as-is.
  const text = new TextDecoder().decode(Uint8Array.from(atob(body.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  return { data: JSON.parse(text), sha: body.sha };
}

async function commit(json, sha, message, token) {
  const res = await api(`contents/${PUBLISH_PATH}`, token, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(json), branch: REPO_BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('That token is not allowed to write to this repository.');
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {
      /* the body is not always JSON */
    }
    throw new Error(`GitHub refused the change (${res.status})${detail ? ': ' + detail : ''}.`);
  }
}

/** Two sheets are the same season in the same year, and so replace each other. */
const sameSeason = (a, b) => a.season === b.season && a.hebrewYear === b.hebrewYear;

/** Publishes a season, keeping every other season already published.
 *
 *  A year needs both קיץ and חורף, so publishing one must not remove the other: this
 *  replaces only the entry for the same season and year, which is what makes a corrected
 *  chart supersede the one before it. Settings and rules come from this publish, since
 *  they are shul-wide rather than per season. */
export async function publishToSite(payload, token) {
  if (!token) throw new Error('No publishing token set. Add one in Settings, under Publishing.');
  const { data, sha } = await fetchPublished(token);
  const existing = data?.sheets || [];

  // Only Shabbos sheets identify a season. Every weekday chart carries season 'weekday',
  // so comparing those by season and year matched קיץ's weekday against חורף's and
  // quietly deleted one: a weekday chart belongs to whichever Shabbos sheet it was
  // generated with, and is replaced only when that sheet is.
  const incomingSeasons = payload.sheets.filter((s) => s.season !== 'weekday');
  const replacedIds = new Set(
    existing.filter((s) => s.season !== 'weekday' && incomingSeasons.some((i) => sameSeason(i, s))).map((s) => s.id)
  );
  const keep = existing.filter((s) =>
    s.season === 'weekday' ? !replacedIds.has(s.linkedSheetId) : !incomingSeasons.some((i) => sameSeason(i, s))
  );

  const merged = { ...payload, sheets: [...keep, ...payload.sheets] };
  const label = incomingSeasons[0];
  await commit(JSON.stringify(merged, null, 2), sha, `Publish ${label?.season || 'season'} ${label?.hebrewYear || ''}`, token);
  return data ? 'updated' : 'created';
}

/** Takes one season back off the congregation's page, leaving the others published. */
export async function unpublishFromSite(sheet, token) {
  if (!token) throw new Error('No publishing token set. Add one in Settings, under Publishing.');
  const { data, sha } = await fetchPublished(token);
  if (!data) throw new Error('Nothing is published.');
  const remaining = data.sheets.filter((s) => !sameSeason(s, sheet) && !(s.season === 'weekday' && s.linkedSheetId === sheet.id));
  await commit(JSON.stringify({ ...data, sheets: remaining }, null, 2), sha, `Unpublish ${sheet.season} ${sheet.hebrewYear}`, token);
  return remaining.length;
}
