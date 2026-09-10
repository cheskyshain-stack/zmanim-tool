// localStorage persistence + JSON export/import. Everything (settings, saved sheet
// instances with their per-cell overrides, and rules) lives in one namespaced key -
// this is the single-browser "local app" model the user chose over a hosted backend.
import {
  DEFAULT_SETTINGS,
  DEFAULT_WEEKDAY_SHACHARIS,
  LEGACY_WEEKDAY_SHACHARIS,
  LEGACY_WEEKDAY_SHACHARIS_SPECIAL,
  LEGACY_WEEKDAY_FOOTER,
  LEGACY_FOOTER_ADDRESS,
  DEFAULT_ACCENT_COLOR,
  LEGACY_ACCENT_COLORS,
  splitCombinedShacharis,
} from './settings.js';
import { dateFromSerial } from './zmanim/solar.js';

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

/** The דרשה rules, both of which have now been retired.
 *
 *  There were two, שבת שובה and שבת הגדול, and each appended the bare word "דרשה" and nothing
 *  else. That said a דרשה was happening and left its time to be typed into the cell by hand
 *  every year. Both afternoons are now worked out in the sheet itself: the דרשה an hour before
 *  the מנחה that is 45 minutes before שקיעה, its מנחה למטה half an hour before that, and the
 *  standing 5:30, 6:00 and 6:30 left off, since the מנחה למטה is what happens instead of them.
 *  See DRASHA_NAMES and shabbosMinchaMenu in sheets/common.js.
 *
 *  שובה went first and הגדול followed once the שובה cell had been printing for a season. So
 *  nothing is seeded here any more, and what is left is taking the old ones back off the
 *  browsers that were given them: left in place, either would sit a second, wordless "דרשה"
 *  underneath the computed one.
 *
 *  Matched on what the rule does rather than on the id it was seeded with. Both of these were
 *  hand-made before they were ever seeded, so on the browser they were made in they carry their
 *  own ids, and matching by id would have left exactly those browsers with the duplicate. What
 *  is matched is an append of nothing but the word itself, which is the rule that is now
 *  redundant. Anything with other words in it, or a replace, is somebody's own and is left
 *  alone: quietly deleting that is worse than a duplicate they can see and remove. */
const RETIRED_DRASHA_NAMES = ['שובה', 'Shuva', 'הגדול', 'Hagadol'];
function isRetiredDrashaRule(rule) {
  return rule?.mode === 'append'
    && String(rule.value || '').trim() === 'דרשה'
    && (rule.condition?.specialParsha || []).some((p) => RETIRED_DRASHA_NAMES.includes(p));
}

/** The 8:40 put back on the end of the ר"ח / בה"ב / תענית שחרית, once.
 *
 *  It came off for a day: the list looked like an everyday one with an extra מנין on it, and
 *  the shul asked for it off and then asked for it back. Taking it off could not be a LEGACY_
 *  list, which is how a changed default normally reaches an install that never edited it (see
 *  settings.js), because the shul's own board writes its times with spaces where the default
 *  writes commas; so it was a seed, and putting it back is the same seed in reverse.
 *
 *  An exact table rather than a rule, because this has to undo one specific change and nothing
 *  else. Two values could have been left by it: the shipped default of that day, and the one
 *  the shul's own browser held. Each goes back to what it was, separators and all. A schedule
 *  that still has its 8:40, or that has been edited since, matches neither and is left alone.
 */
const RESTORE_840 = new Map([
  ['6:40, 7:00*, <u>7:15</u>, 7:35**\n8:00, 8:20*',
    '6:40, 7:00*, <u>7:15</u>, 7:35**\n8:00, 8:20*, <u>8:40</u>'],
  ['6:40 7:00* <u>7:15</u> 7:35**\n8:00 8:20*',
    '6:40 7:00* <u>7:15</u> 7:35**\n8:00 8:20* <u>8:40</u>'],
]);

function applySeeds(state) {
  const seeded = state.seeded || {};
  /* The 8:40 back on the ר"ח / בה"ב / תענית שחרית, on a browser that took the version which
     removed it. Once, and recorded, the same as every other seed on this list, so a shul that
     takes it off itself keeps it off. See RESTORE_840. */
  if (!seeded.special840Back) {
    const saved = state.settings?.weekdayShacharisSpecial;
    if (RESTORE_840.has(saved)) state.settings.weekdayShacharisSpecial = RESTORE_840.get(saved);
    seeded.special840Back = true;
  }
  /* Both bare-word דרשה rules off, on any browser still holding one. Not guarded by a flag
     that can be satisfied once: the שובה pass ran under seeded.shuvaComputed and matched on
     the seeded id, so a browser carrying a hand-made שובה rule was marked done and kept its
     duplicate. This runs every load and is cheap, and a rule it removes cannot come back,
     because nothing seeds one any more. See isRetiredDrashaRule for what it will not touch. */
  state.rules = state.rules.filter((r) => !isRetiredDrashaRule(r));
  seeded.drashos = true;
  seeded.shuvaComputed = true;
  seeded.hagadolComputed = true;
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
  if (LEGACY_WEEKDAY_SHACHARIS_SPECIAL.includes(merged.weekdayShacharisSpecial)) {
    merged.weekdayShacharisSpecial = DEFAULT_SETTINGS.weekdayShacharisSpecial;
  }
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
