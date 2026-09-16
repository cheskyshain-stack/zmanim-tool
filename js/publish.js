import { loadTables } from './data-loader.js';
import { DEFAULT_SETTINGS, resolveSettings } from './settings.js';
import { computeSeasonWeeks, computeWeekdayWeeks } from './sheets/weeks.js';
import { defaultPageSizes, alignPageSizesTo } from './pagination.js';
import { hebrewDateExtended } from './hebrew-calendar.js';
import { excelSerial } from './zmanim/solar.js';
// Publishing a season for the congregation.
//
// Everything in this app lives in one browser's localStorage, so a visitor's browser has
// nothing to show. Publishing writes the season into a file that ships with the site, at
// data/published.json, which the luach (index.html?luach) reads instead of
// localStorage. That is the whole mechanism: no backend, no login, no database.
//
// A season is published once. The luach then advances by itself every week, because the
// week it shows is worked out from today's date against the weeks in the file.

import { isRetiredTishaBavRule, isRetiredDrashaRule, dropDuplicateDrasha } from './rules.js';

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
      // Carried across because the luach sorts on it: where two published sheets both
      // cover a week, the most recently generated one wins. Left out, every sheet sorted
      // as undefined and the winner came down to the order they happened to be published
      // in, which is not a rule anyone could predict.
      createdAt: s.createdAt,
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

/** The retired דרשה rules taken off a payload on its way in.
 *
 *  **A published file is a snapshot, and it goes on saying what it said the day it was written.**
 *  The rules travel with it, so the two bare-word דרשה rules kept firing on the congregation's own
 *  chart months after they were retired everywhere else: the admin's copy of them is taken off as
 *  that browser loads (see applySeeds in storage.js), and nothing was taking them off this one. The
 *  shul saw the second, wordless דרשה under the computed one on שבת הגדול, on the public board,
 *  while the admin they had just been fixed in printed it correctly.
 *
 *  So the same retirement runs here, off the same definition, and a published file written before
 *  it cannot put a retired rule back. Republishing writes the file without them in any case; this
 *  is what makes the one already on the site right without anybody having to.
 *
 *  The overrides are cleaned the same way, for the cells the rule had already been typed into. */
function withoutRetiredDrasha(data) {
  if (!data) return data;
  const rules = (data.rules || []).filter((r) => !isRetiredDrashaRule(r) && !isRetiredTishaBavRule(r));
  const sheets = (data.sheets || []).map((sheet) => {
    const overrides = {};
    for (const [serial, week] of Object.entries(sheet.overrides || {})) {
      overrides[serial] = Object.fromEntries(
        Object.entries(week || {}).map(([key, value]) => [key, dropDuplicateDrasha(value)])
      );
    }
    return { ...sheet, overrides };
  });
  return { ...data, rules, sheets };
}

/** Reads what is currently published, or null when nothing is. A 404 is the normal state
 *  before the first publish, not an error worth shouting about. */
export async function loadPublished({ automatic = false } = {}) {
  try {
    const res = await fetch('/data/published.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      /* **Not nothing published. Something answered instead of the site.**
         This returned null here, and null is what the page prints "Nothing has been published
         yet" for, so a filtered phone was told the shul had not put its zmanim up. It had. A
         GenTech block page came back in place of this file and the site repeated it as though
         it were the answer, which is the worst shape a failure can take: it names an innocent
         cause, it blames the shul, and the person who sees it complains to a gabbai instead of
         to whoever runs the filter. See data-loader.js, which had the same fault the same week.
         Thrown rather than returned, so the caller has to decide what to say. */
      const blocked = new Error('blocked');
      blocked.blockedUrl = new URL('/data/published.json', location.origin).href;
      throw blocked;
    }
    if (!data || !Array.isArray(data.sheets)) return null;
    const clean = withoutRetiredDrasha(data);
    return automatic ? buildAutomaticCharts(clean, await loadTables()) : clean;
  } catch (err) {
    if (err?.message === 'blocked') throw err;
    // A network that would not carry the request at all. Same answer as no file: nothing to show.
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
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    // A browser that refuses storage has no token to give. The admin app is the only
    // thing that asks, and it will say the token is missing rather than fall over.
    return '';
  }
}

export function setPublishToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do: publishing this session still works, the token just will not be
    // remembered for the next one.
  }
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

  const merged = { ...data, ...payload, sheets: [...keep, ...payload.sheets] };
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

/** Regenerate previous, current and upcoming seasons from shared formulas.
 * Previously published sheets supply page splits only; times are always recalculated. */
export function buildAutomaticCharts(config, tables, now = new Date()) {
  const settings = { ...DEFAULT_SETTINGS, ...config.settings,
    sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, ...config.settings?.sheetStyle } };
  const resolved = resolveSettings(settings);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezoneId || 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = type => Number(parts.find(p => p.type === type).value);
  const today = excelSerial(new Date(Date.UTC(part('year'), part('month') - 1, part('day'))));
  const year = hebrewDateExtended(today, settings.useGregorianBefore1582).year;
  const seasons = [];
  for (let y = year - 1; y <= year + 1; y++) for (const season of ['choref', 'kayitz']) {
    seasons.push({ season, year: y, ...computeSeasonWeeks(season, y, resolved, tables) });
  }
  seasons.sort((a, b) => a.startSerial - b.startSerial);
  let at = seasons.findIndex(s => s.startSerial <= today && today < s.endSerial);
  if (at < 0) at = seasons.findIndex(s => s.endSerial > today);
  const selected = seasons.slice(Math.max(0, at - 1), at + 2);
  const sheets = [];
  for (const s of selected) {
    const old = (config.sheets || []).filter(x => x.season === s.season && x.hebrewYear === s.year)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    const key = s.season + '-' + s.year;
    const custom = config.chartLayouts?.[key];
    const valid = sizes => Array.isArray(sizes) && sizes.length > 0 && sizes.length <= 8 &&
      sizes.every(n => Number.isInteger(n) && n > 0) && sizes.reduce((a, b) => a + b, 0) === s.weeks.length;
    const sizes = valid(custom) ? custom : valid(old?.pageSizes) ? old.pageSizes : defaultPageSizes(s.weeks.length, 3);
    const weekdayWeeks = computeWeekdayWeeks(s.season, s.year, resolved, tables).weeks;
    const id = 'auto-' + key;
    const base = { hebrewYear: s.year, createdAt: old?.createdAt || '2000-01-01T00:00:00.000Z',
      style: { ...settings.sheetStyle }, automatic: true };
    sheets.push({ ...base, id, season: s.season, weeks: s.weeks, pageSizes: sizes,
      overrides: {} });
    sheets.push({ ...base, id: id + '-weekday', season: 'weekday', linkedSeason: s.season,
      linkedSheetId: id, weeks: weekdayWeeks, pageSizes: alignPageSizesTo(s.weeks, sizes, weekdayWeeks),
      overrides: {} });
  }
  return { ...config, settings, sheets, automaticCharts: true };
}


