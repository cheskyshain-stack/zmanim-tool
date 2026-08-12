// localStorage persistence + JSON export/import. Everything (settings, saved sheet
// instances with their per-cell overrides, and rules) lives in one namespaced key —
// this is the single-browser "local app" model the user chose over a hosted backend.
import { DEFAULT_SETTINGS, DEFAULT_WEEKDAY_SHACHARIS, LEGACY_WEEKDAY_SHACHARIS } from './settings.js';

const KEY = 'zmanim-app-state-v1';

// No seed rules by default — add your own from the Rules tab (e.g. Shabbos Teshuva /
// Shabbos HaGadol having a different Mincha because of the drasha) whenever you're
// ready to fill in the real wording/times.
const SEED_RULES = [];

/** ט' באב used to be hardcoded into the sheet builders. It's an ordinary rule now, so
 *  it can be seen, edited, disabled or deleted like any other — matching on the Hebrew
 *  date (Av 9), which recurs every year, unlike a fixed Gregorian date.
 *
 *  Installed once per browser and recorded in state.seeded, so deleting it sticks
 *  instead of having it reappear on the next load. */
const TISHA_BAV_RULE = {
  id: 'rule-tisha-bav',
  name: 'ט באב — מוצאי שבת',
  enabled: true,
  condition: { hebrewDate: ['5-9'] },
  columnKeys: ['kayitz:B', 'kayitz:C', 'choref:B', 'choref:C'],
  mode: 'append',
  value: 'ט באב',
};

function applySeeds(state) {
  const seeded = state.seeded || {};
  if (!seeded.tishaBav) {
    if (!state.rules.some((r) => r.id === TISHA_BAV_RULE.id)) state.rules.push({ ...TISHA_BAV_RULE });
    seeded.tishaBav = true;
  }
  state.seeded = seeded;
  return state;
}

// Merges saved settings over the defaults, cloning nested objects (sheetStyle) so
// nothing ever ends up sharing a reference with the DEFAULT_SETTINGS constant —
// mutating state.settings.sheetStyle in place would otherwise silently corrupt the
// app's built-in defaults for the rest of the session.
function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...raw, sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, ...(raw?.sheetStyle || {}) } };
  // See LEGACY_WEEKDAY_SHACHARIS: carry a never-edited old default forward to the
  // current one, so an existing install doesn't stay stuck on an outdated schedule.
  if (LEGACY_WEEKDAY_SHACHARIS.includes(merged.weekdayShacharis)) merged.weekdayShacharis = DEFAULT_WEEKDAY_SHACHARIS;
  return merged;
}

function defaultState() {
  return applySeeds({ settings: normalizeSettings({}), sheets: [], rules: SEED_RULES.map((r) => ({ ...r })), seeded: {} });
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return applySeeds({
      settings: normalizeSettings(parsed.settings),
      sheets: parsed.sheets || [],
      rules: parsed.rules && parsed.rules.length ? parsed.rules : SEED_RULES.map((r) => ({ ...r })),
      seeded: parsed.seeded || {},
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

export function importStateFromText(text) {
  const parsed = JSON.parse(text);
  // `seeded` comes across too: without it, restoring a backup made after deliberately
  // deleting a seeded rule would hand it straight back on the next load.
  return applySeeds({
    settings: normalizeSettings(parsed.settings),
    sheets: parsed.sheets || [],
    rules: parsed.rules || SEED_RULES.map((r) => ({ ...r })),
    seeded: parsed.seeded || {},
  });
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
