// localStorage persistence + JSON export/import. Everything (settings, saved sheet
// instances with their per-cell overrides, and rules) lives in one namespaced key —
// this is the single-browser "local app" model the user chose over a hosted backend.
import { DEFAULT_SETTINGS } from './settings.js';

const KEY = 'zmanim-app-state-v1';

// No seed rules by default — add your own from the Rules tab (e.g. Shabbos Teshuva /
// Shabbos HaGadol having a different Mincha because of the drasha) whenever you're
// ready to fill in the real wording/times.
const SEED_RULES = [];

// Merges saved settings over the defaults, cloning nested objects (sheetStyle) so
// nothing ever ends up sharing a reference with the DEFAULT_SETTINGS constant —
// mutating state.settings.sheetStyle in place would otherwise silently corrupt the
// app's built-in defaults for the rest of the session.
function normalizeSettings(raw) {
  return { ...DEFAULT_SETTINGS, ...raw, sheetStyle: { ...DEFAULT_SETTINGS.sheetStyle, ...(raw?.sheetStyle || {}) } };
}

function defaultState() {
  return { settings: normalizeSettings({}), sheets: [], rules: SEED_RULES.map((r) => ({ ...r })) };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      settings: normalizeSettings(parsed.settings),
      sheets: parsed.sheets || [],
      rules: parsed.rules && parsed.rules.length ? parsed.rules : SEED_RULES.map((r) => ({ ...r })),
    };
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
  return {
    settings: normalizeSettings(parsed.settings),
    sheets: parsed.sheets || [],
    rules: parsed.rules || SEED_RULES.map((r) => ({ ...r })),
  };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
