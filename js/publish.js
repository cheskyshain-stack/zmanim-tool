import { loadTables } from './data-loader.js';
import { DEFAULT_SETTINGS, LEGACY_FOOTER_NOTE, resolveSettings } from './settings.js';
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
    if (!res.ok) throw new Error('Schedule download failed: ' + res.status);
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
    if (!data || !Array.isArray(data.sheets)) throw new Error('Invalid schedule data');
    const clean = withoutRetiredDrasha(data);
    return automatic ? buildAutomaticCharts(clean, await loadTables()) : clean;
  } catch (err) {
    if (err?.message === 'blocked') throw err;
    throw err;
  }
}

// Automatic charts do not need a repository credential in the browser.
// Delete legacy copies without ever reading or copying their contents.
export function clearLegacyPublishToken() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try { globalThis[name].removeItem('zmanim-publish-token'); } catch { /* Storage may be disabled. */ }
  }
}
clearLegacyPublishToken();

// Compatibility for older local screens. Publishing controls remain unavailable.
export function getPublishToken() {
  clearLegacyPublishToken();
  return '';
}

export async function fetchPublished() {
  const res = await fetch('/data/published.json', { cache: 'no-cache' });
  if (res.status === 404) return { data: null };
  if (!res.ok) throw new Error('The shared schedule settings could not be loaded.');
  return { data: await res.json() };
}

export async function publishToSite() {
  throw new Error('Charts update automatically. Shared website settings are managed through the site repository.');
}

export async function unpublishFromSite() {
  throw new Error('Automatic charts cannot be removed through browser publishing.');
}

/** Regenerate three Hebrew years before and after the current year from shared formulas.
 * Previously published sheets supply page splits only; times are always recalculated. */
export function buildAutomaticCharts(config, tables, now = new Date()) {
  const settings = { ...DEFAULT_SETTINGS, ...config.settings,
    sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, ...config.settings?.sheetStyle } };
  /* A published file is a snapshot of the day it was written, and the congregation's site reads
     it rather than localStorage, so a default that has since changed has to be carried forward
     here as well as in storage.js. It was not, once: the retired rules went on firing on the
     board for months because only the admin's door was watched. */
  if (LEGACY_FOOTER_NOTE.includes(settings.footerNote)) settings.footerNote = DEFAULT_SETTINGS.footerNote;
  const resolved = resolveSettings(settings);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezoneId || 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = type => Number(parts.find(p => p.type === type).value);
  const today = excelSerial(new Date(Date.UTC(part('year'), part('month') - 1, part('day'))));
  const year = hebrewDateExtended(today, settings.useGregorianBefore1582).year;
  const seasons = [];
  for (let y = year - 3; y <= year + 3; y++) for (const season of ['choref', 'kayitz']) {
    seasons.push({ season, year: y, ...computeSeasonWeeks(season, y, resolved, tables) });
  }
  seasons.sort((a, b) => a.startSerial - b.startSerial);
  const sheets = [];
  for (const s of seasons) {
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


