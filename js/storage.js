// localStorage persistence + JSON export/import. Everything (settings, saved sheet
// instances with their per-cell overrides, and rules) lives in one namespaced key -
// this is the single-browser "local app" model the user chose over a hosted backend.
import {
  DEFAULT_SETTINGS,
  DEFAULT_WEEKDAY_SHACHARIS,
  LEGACY_WEEKDAY_SHACHARIS,
  LEGACY_WEEKDAY_FOOTER,
  LEGACY_FOOTER_ADDRESS,
  DEFAULT_ACCENT_COLOR,
  LEGACY_ACCENT_COLORS,
  splitCombinedShacharis,
} from './settings.js';

const KEY = 'zmanim-app-state-v1';
const SHEET_FILE_TYPE = 'zmanim-sheet';

// No seed rules by default - add your own from the Rules tab (e.g. Shabbos Teshuva /
// Shabbos HaGadol having a different Mincha because of the drasha) whenever you're
// ready to fill in the real wording/times.
const SEED_RULES = [];

/** ט' באב used to be hardcoded into the sheet builders. It's an ordinary rule now, so
 *  it can be seen, edited, disabled or deleted like any other - matching on the Hebrew
 *  date, which recurs every year, unlike a fixed Gregorian date.
 *
 *  It fires on the two Shabbosim where the fast begins מוצאי שבת. Weeks are anchored on
 *  their Shabbos, so that's the Shabbos of 8 Av (the fast is the next day, 9 Av on a
 *  Sunday) and the Shabbos of 9 Av (9 Av itself is Shabbos, so the fast is נדחה to
 *  Sunday, 10 Av). Checked against real years: 5805 is the 8 Av case, 5789/5792/5796/
 *  5799 the 9 Av one.
 *
 *  Installed once per browser and recorded in state.seeded, so deleting it sticks
 *  instead of having it reappear on the next load. */
const TISHA_BAV_RULE = {
  id: 'rule-tisha-bav',
  name: 'ט באב: מוצאי שבת',
  enabled: true,
  condition: { hebrewDate: ['5-8', '5-9'] },
  columnKeys: ['kayitz:B', 'kayitz:C', 'choref:B', 'choref:C'],
  mode: 'append',
  value: 'ט באב',
};

/** The two דרשה rules, seeded for the same reason the Lakewood settings are built in:
 *  they're the shul's standing schedule, not one person's preference, so a new browser
 *  (a phone, say) should have them without anyone re-entering them. Same seeded-flag
 *  treatment as ט באב - installed once, and deleting one stays deleted. */
const DRASHA_RULES = [
  {
    id: 'rule-shabbos-hagadol',
    name: 'שבת הגדול: דרשה',
    enabled: true,
    condition: { specialParsha: ['הגדול', 'Hagadol'] },
    columnKeys: ['kayitz:C', 'choref:C'],
    mode: 'append',
    value: 'דרשה',
  },
];

/** The שבת שובה rule that used to sit beside שבת הגדול above.
 *
 *  It appended the bare word "דרשה" and nothing else, so the time had to be typed into the
 *  cell by hand every year. The דרשה is now worked out in the sheet itself, an hour before
 *  the מנחה that is 45 minutes before שקיעה, with its מנחה למטה half an hour before that
 *  (see shabbosMinchaMenu in sheets/common.js). Leaving the rule in place would append a
 *  second, wordless "דרשה" underneath the computed one.
 *
 *  Removed only where it is still exactly as it was seeded. Somebody who edited theirs
 *  meant something by it, and this quietly deleting that is worse than a duplicate they
 *  can see and remove. */
const RETIRED_SHUVA_RULE = {
  id: 'rule-shabbos-shuva',
  mode: 'append',
  value: 'דרשה',
};

/** True if some rule already covers the same special Shabbos. These two were hand-made
 *  before they were seeded, so on the browser they were made in they exist under their
 *  own ids - seeding by id alone would sit a second "דרשה" on top of the first. */
function alreadyCovered(rules, rule) {
  const wanted = rule.condition.specialParsha;
  return rules.some((r) => r.id === rule.id || (r.condition?.specialParsha || []).some((p) => wanted.includes(p)));
}

function applySeeds(state) {
  const seeded = state.seeded || {};
  if (!seeded.drashos) {
    for (const rule of DRASHA_RULES) {
      if (!alreadyCovered(state.rules, rule)) state.rules.push({ ...rule });
    }
    seeded.drashos = true;
  }
  if (!seeded.shuvaComputed) {
    state.rules = state.rules.filter(
      (r) => !(r.id === RETIRED_SHUVA_RULE.id && r.mode === RETIRED_SHUVA_RULE.mode && r.value === RETIRED_SHUVA_RULE.value)
    );
    seeded.shuvaComputed = true;
  }
  if (!seeded.tishaBav) {
    if (!state.rules.some((r) => r.id === TISHA_BAV_RULE.id)) state.rules.push({ ...TISHA_BAV_RULE });
    seeded.tishaBav = true;
  }
  // The first version of this rule only matched 9 Av, missing the years where 9 Av lands
  // on a Sunday (the Shabbos before it is 8 Av). Widen a copy that still carries exactly
  // the old condition - an untouched seed - and leave any hand-edited one alone.
  const existing = state.rules.find((r) => r.id === TISHA_BAV_RULE.id);
  if (existing && JSON.stringify(existing.condition) === JSON.stringify({ hebrewDate: ['5-9'] })) {
    existing.condition = { hebrewDate: ['5-8', '5-9'] };
  }
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
  // See LEGACY_WEEKDAY_SHACHARIS: carry a never-edited old default forward to the
  // current one, so an existing install doesn't stay stuck on an outdated schedule.
  if (LEGACY_WEEKDAY_SHACHARIS.includes(merged.weekdayShacharis)) merged.weekdayShacharis = DEFAULT_WEEKDAY_SHACHARIS;
  if (LEGACY_WEEKDAY_FOOTER.includes(merged.weekdayFooterNote)) merged.weekdayFooterNote = DEFAULT_SETTINGS.weekdayFooterNote;
  if (LEGACY_FOOTER_ADDRESS.includes(merged.footerAddress)) merged.footerAddress = DEFAULT_SETTINGS.footerAddress;
  if (isLegacyAccent(merged.sheetStyle.accentColor)) merged.sheetStyle.accentColor = DEFAULT_ACCENT_COLOR;
  // שחרית used to be one field holding both schedules. Anything saved back then is cut
  // in two here, at its own ר"ח heading, so nobody has to retype a schedule they had
  // already set. Only when the saved value still carries that heading: a value already
  // split has none, and is left alone.
  if (raw?.weekdayShacharisSpecial === undefined) {
    const parts = splitCombinedShacharis(merged.weekdayShacharis);
    if (parts) {
      merged.weekdayShacharis = parts.regular;
      merged.weekdayShacharisSpecial = parts.special;
    }
  }
  return merged;
}

const isLegacyAccent = (color) => LEGACY_ACCENT_COLORS.includes(String(color || '').toLowerCase());

/** The same carry-forward, for sheets already saved. A sheet keeps its own copy of the
 *  style, so changing the default alone would leave every existing chart on the old dark
 *  header while new ones came out light. Only the exact old default is moved; a colour
 *  picked by hand is left alone, as everywhere else. */
function normalizeSheets(sheets) {
  for (const sheet of sheets) {
    if (sheet?.style && isLegacyAccent(sheet.style.accentColor)) sheet.style.accentColor = DEFAULT_ACCENT_COLOR;
  }
  return sheets;
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
      sheets: normalizeSheets(parsed.sheets || []),
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
