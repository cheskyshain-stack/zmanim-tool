// localStorage persistence + JSON export/import. Everything (settings, saved sheet
// instances with their per-cell overrides, and rules) lives in one namespaced key -
// this is the single-browser "local app" model the user chose over a hosted backend.
import {
  DEFAULT_SETTINGS,
  LEGACY_FOOTER_ADDRESS,
  DEFAULT_ACCENT_COLOR,
  LEGACY_ACCENT_COLORS,
} from './settings.js';
import { dateFromSerial } from './zmanim/solar.js';
/* The retired דרשה rules live with the rule engine rather than here, because this is not the only
   door they come in through: the congregation's site reads data/published.json, which carries a
   copy of the rules, and it has to retire the same ones. See isRetiredDrashaRule in rules.js. */
import { isRetiredTishaBavRule, isRetiredDrashaRule, dropDuplicateDrasha } from './rules.js';

const KEY = 'zmanim-app-state-v1';
const SHEET_FILE_TYPE = 'zmanim-sheet';

// No seed rules by default - add your own from the Rules tab (e.g. Shabbos Teshuva /
// Shabbos HaGadol having a different Mincha because of the drasha) whenever you're
// ready to fill in the real wording/times.
const SEED_RULES = [];

/* The seed that put the 8:40 back on the end of the ר"ח / בה"ב / תענית שחרית is gone with the
   setting it edited. That schedule is WEEKDAY_SHACHARIS_SPECIAL in settings.js now and no browser
   holds a copy of it to be corrected. */

function applySeeds(state) {
  const seeded = state.seeded || {};
  /* Both bare-word דרשה rules off, on any browser still holding one. Not guarded by a flag
     that can be satisfied once: the שובה pass ran under seeded.shuvaComputed and matched on
     the seeded id, so a browser carrying a hand-made שובה rule was marked done and kept its
     duplicate. This runs every load and is cheap, and a rule it removes cannot come back,
     because nothing seeds one any more. See isRetiredDrashaRule for what it will not touch. */
  state.rules = state.rules.filter((r) => !isRetiredDrashaRule(r) && !isRetiredTishaBavRule(r));
  /* And the same word where the rule had already been baked into a typed-over cell, which
     deleting the rule does not reach. See dropDuplicateDrasha for what it will not touch. */
  for (const sheet of Array.isArray(state.sheets) ? state.sheets : []) {
    for (const week of Object.values(sheet?.overrides || {})) {
      for (const [key, value] of Object.entries(week || {})) {
        const fixed = dropDuplicateDrasha(value);
        if (fixed !== value) week[key] = fixed;
      }
    }
  }
  seeded.drashos = true;
  seeded.shuvaComputed = true;
  seeded.hagadolComputed = true;
  seeded.tishaBav = true; // The schedule is computed by the sheet builders now.
  // Rule names written with an em dash, back when the seeds used one. Rewritten to a
  // colon so no dash of that kind is left anywhere in the app, including names already
  // saved in a browser.
  for (const rule of state.rules) {
    if (rule.name?.includes('—')) rule.name = rule.name.replace(/\s*—\s*/g, ': ');
  }
  state.seeded = seeded;
  return state;
}

// Merges saved settings over the defaults, cloning nested objects (sheetStyle) so
// nothing ever ends up sharing a reference with the DEFAULT_SETTINGS constant -
// mutating state.settings.sheetStyle in place would otherwise silently corrupt the
// app's built-in defaults for the rest of the session.
function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...raw, sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, ...(raw?.sheetStyle || {}) } };
  if (LEGACY_FOOTER_ADDRESS.includes(merged.footerAddress)) merged.footerAddress = DEFAULT_SETTINGS.footerAddress;
  if (isLegacyAccent(merged.sheetStyle.accentColor)) merged.sheetStyle.accentColor = DEFAULT_ACCENT_COLOR;
  for (const key of RETIRED_SETTINGS) delete merged[key];
  return merged;
}

/** Settings that are the program's now and not the shul's, dropped as they load.
 *
 *  The two Weekday שחרית schedules and the chart's footer note were three fields in Settings;
 *  they are WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL and WEEKDAY_FOOTER_NOTE in settings.js
 *  now, and everything that prints them reads them from there. The old keys are taken out rather
 *  than left sitting in localStorage: nothing reads them, so a copy left behind would be a stale
 *  schedule travelling in every backup and every published file, looking authoritative and being
 *  read by nothing. The מנחה and מעריב keys were always blank and go with them. */
const RETIRED_SETTINGS = [
  'weekdayShacharis',
  'weekdayShacharisSpecial',
  'weekdayFooterNote',
  'weekdayDefaultMincha',
  'weekdayDefaultMaariv',
];

const isLegacyAccent = (color) => LEGACY_ACCENT_COLORS.includes(String(color || '').toLowerCase());

/** The same carry-forward, for sheets already saved. A sheet keeps its own copy of the
 *  style, so changing the default alone would leave every existing chart on the old dark
 *  header while new ones came out light. Only the exact old default is moved; a colour
 *  picked by hand is left alone, as everywhere else. */
function normalizeSheets(sheets) {
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    if (sheet?.style && isLegacyAccent(sheet.style.accentColor)) sheet.style.accentColor = DEFAULT_ACCENT_COLOR;
    /* A week whose date will not parse gets it back off its own serial.
     *
     * The serial is the week's key and everything is computed from it; the date beside it is
     * the same day written the other way, for the screens that print it. An import carrying a
     * date this browser cannot read (a truncated file, an export edited by hand) left every
     * screen that prints one throwing: measured, This week came up empty with "Invalid time
     * value" and no way back except clearing the browser. Repaired rather than dropped, since
     * the week itself is perfectly good and the serial says which day it is. */
    for (const week of Array.isArray(sheet?.weeks) ? sheet.weeks : []) {
      if (!Number.isFinite(week?.serial)) continue;
      if (Number.isNaN(new Date(week.date).getTime())) week.date = dateFromSerial(week.serial).toISOString();
    }
  }
  return Array.isArray(sheets) ? sheets : [];
}

/** The sheets the shul has written itself (see posters/own.js), which live here with
 *  everything else and so travel with an export like everything else.
 *
 *  Anything without an id is dropped: a sheet is found by its id from the Posters tab's own
 *  address, and one without it could be picked but never come back to. */
function normalizeOwn(own) {
  return (Array.isArray(own) ? own : []).filter((s) => s && s.id).map((s) => ({
    ...s,
    blocks: (Array.isArray(s.blocks) ? s.blocks : []).map((b) => ({
      ...b, rows: Array.isArray(b.rows) ? b.rows : [],
    })),
  }));
}

function defaultState() {
  return applySeeds({ settings: normalizeSettings({}), sheets: [], rules: SEED_RULES.map((r) => ({ ...r })), seeded: {}, own: [] });
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return applySeeds({
      settings: normalizeSettings(parsed.settings),
      sheets: normalizeSheets(parsed.sheets || []),
      rules: parsed.rules && parsed.rules.length ? parsed.rules : SEED_RULES.map((r) => ({ ...r })),
      seeded: parsed.seeded || {},
      own: normalizeOwn(parsed.own),
    });
  } catch (e) {
    console.error('Failed to load saved state, starting fresh.', e);
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function exportStateToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zmanim-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** True for a single-sheet file rather than a whole-app backup.
 *
 *  Nothing writes these any more - Saved sheets used to have a "Save a copy" button that
 *  downloaded one, and folders inside the app replaced it. Import still recognises them
 *  so a file saved back then still opens. */
export function isSheetFile(text) {
  try {
    return JSON.parse(text)?.type === SHEET_FILE_TYPE;
  } catch {
    return false;
  }
}

/** The sheet inside such a file, given a fresh id so importing the same copy twice (or
 *  onto the machine it came from) adds a second sheet instead of colliding with the
 *  original. Never locked on arrival - the lock belongs to the copy it came from. */
export function importSheetFromText(text) {
  const { sheet } = JSON.parse(text);
  if (!sheet || !Array.isArray(sheet.weeks)) throw new Error('That file does not contain a sheet.');
  return { ...sheet, id: newId('sheet'), locked: false, linkedSheetId: undefined };
}

export function importStateFromText(text) {
  const parsed = JSON.parse(text);
  // `seeded` comes across too: without it, restoring a backup made after deliberately
  // deleting a seeded rule would hand it straight back on the next load.
  return applySeeds({
    settings: normalizeSettings(parsed.settings),
    sheets: normalizeSheets(parsed.sheets || []),
    rules: parsed.rules || SEED_RULES.map((r) => ({ ...r })),
    seeded: parsed.seeded || {},
  });
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

