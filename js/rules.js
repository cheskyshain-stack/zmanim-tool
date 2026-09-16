// Rule engine: reusable, condition-based overrides (e.g. "Shabbos Teshuva and Shabbos
// HaGadol have a different Mincha time because of the drasha"). Applied to every
// generated sheet automatically, before any one-off manual per-cell overrides - that's
// the intended distinction between rules (recurring, reapplies every year) and
// overrides (tied to one generated sheet instance).
//
// A rule's columnKeys are sheet-qualified ("kayitz:L", "choref:I") because the same
// bare letter means a *different* cell on each sheet (e.g. קיץ column I is a Plag
// Mincha variant, but חורף column I is the main Erev Shabbos Mincha) - qualifying by
// sheet lets one rule safely cover both charts' "equivalent" cell at once without ever
// touching the wrong column on the other sheet.
//
// A condition can combine any of:
//   specialParsha: [names]      - matches week.specialParsha (Hebrew or English)
//   parsha:        [names]      - matches week.parsha
//   dateISO:       [YYYY-MM-DD] - matches an explicit Gregorian date
//   hebrewDate:    ["month-day"]- matches a Hebrew calendar date, e.g. "5-9" for ט' באב
//                                 (month 5 = Av). Recurs every year, unlike dateISO.
//   always:        true         - matches every week (for a blanket override)
//
// week.hebrew ({month, dayOfMonth}) is attached by the caller - see sheet-view.js. It
// isn't stored on saved sheets, so it's computed at render time and works for sheets
// generated before hebrewDate conditions existed.
function conditionMatches(condition, week) {
  // A rule with no condition at all matches nothing. Saved rules always carry one, but an
  // import need not: an older export, or a file edited by hand, and reading .always off
  // undefined threw and took down every screen that draws a sheet.
  if (!condition) return false;
  if (condition.always) return true;
  if (condition.specialParsha && condition.specialParsha.includes(week.specialParsha)) return true;
  if (condition.parsha && condition.parsha.includes(week.parsha)) return true;
  // The date is guarded for the same reason: a week whose date will not parse would throw
  // here rather than simply not matching. storage.js repairs those on the way in, so this
  // is the second line rather than the first.
  const iso = week.date instanceof Date && !Number.isNaN(week.date.getTime())
    ? week.date.toISOString().slice(0, 10) : null;
  if (condition.dateISO && iso && condition.dateISO.includes(iso)) return true;
  if (condition.hebrewDate && week.hebrew && condition.hebrewDate.includes(`${week.hebrew.month}-${week.hebrew.dayOfMonth}`)) return true;
  return false;
}

/** A rule's target columns for the given sheet season, as bare column keys (e.g. "L").
 *  Accepts the current sheet-qualified format ("kayitz:L") and, for backward
 *  compatibility with data saved before that format existed, bare keys ("L") and the
 *  older singular columnKey field (applied to any sheet). */
function targetColumnsForSeason(rule, season) {
  const raw = Array.isArray(rule.columnKeys) ? rule.columnKeys : rule.columnKey ? [rule.columnKey] : [];
  return raw
    .map((entry) => {
      if (!entry.includes(':')) return entry; // legacy bare key - applies on any sheet
      const [entrySeason, key] = entry.split(':');
      return entrySeason === season ? key : null;
    })
    .filter(Boolean);
}

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
 *  alone: quietly deleting that is worse than a duplicate they can see and remove.
 *
 *  **The condition is not looked at.** It was: the rule had to name שובה or הגדול as a
 *  special-Shabbos. The shul's own board still printed the second, wordless דרשה under the
 *  computed one on שבת הגדול, so a rule was firing that this did not recognise, and a condition
 *  can say the same Shabbos in more ways than a list can hold (the parsha name instead of the
 *  special one, "שבת הגדול" rather than "הגדול", a stray space). What makes the rule redundant
 *  is what it writes, not which week it writes it on: the word on its own says a דרשה is
 *  happening and leaves its time to be typed in, and every one of those times is now computed.
 *
 *  The word is compared with the markup and the invisible characters taken off. A rule's text
 *  is typed into a box and can arrive carrying an <u> from the editor, the isolate characters
 *  a cell wraps Hebrew in (see util.js), a bidi mark from a keyboard, or an nbsp. None of them
 *  change what the line says. */
export const DRASHA_WORD = 'דרשה';
/** The isolates, the bidi marks and the nbsp: invisible, and never what a line says. */
const INVISIBLE = /[\u200e\u200f\u2066-\u2069\u00a0]/g;
const plainText = (value) => String(value ?? '').replace(/<[^>]*>/g, '').replace(INVISIBLE, ' ');
export function isRetiredTishaBavRule(rule) {
  return rule?.id === 'rule-tisha-bav' ||
    (rule?.mode === 'append' && plainText(rule.value).replace(/['"׳״\\s]/g, '') === 'טבאב' &&
      rule.condition?.hebrewDate?.some(date => date === '5-8' || date === '5-9'));
}

export function isRetiredDrashaRule(rule) {
  return rule?.mode === 'append' && plainText(rule.value).trim() === DRASHA_WORD;
}

/** The same bare word, left behind in a cell somebody typed over rather than in a rule.
 *
 *  A per-cell override keeps the whole cell, so one made while the rule was still firing kept
 *  a copy of what the rule had added, and deleting the rule does not reach it. Dropped only
 *  where the same cell already prints a דרשה with a time on it, which is the computed line:
 *  the word twice in one cell, once saying when and once saying nothing, is the thing the shul
 *  asked to have off. A cell that carries the bare word and no computed line is left alone,
 *  since there the word is all the cell says about the דרשה.
 *
 *  Only a trailing one, which is where an append puts it. The line break may be a newline or
 *  markup: a typed cell is rich text and the browser's own editor writes a <div> or a <br>
 *  rather than a newline (see lineBoxOf in ui/week-view.js). */
/** What a line can carry either side of the word without saying anything else: whitespace, the
 *  invisible marks, an opening or closing tag, and the <br> a browser's own editor writes at the
 *  end of a box it made. A line of nothing but those and the word is a line that says the word. */
const OPENERS = '(?:[\\s\\u00a0\\u200e\\u200f\\u2066-\\u2069]|<[a-z][^>]*>)';
const CLOSERS = '(?:[\\s\\u00a0\\u200e\\u200f\\u2066-\\u2069]|<br\\s*/?>|</[a-z][^>]*>)';
const TRAILING_BARE_DRASHA = new RegExp(
  `(?:\\n|<br\\s*/?>|<div[^>]*>|<p[^>]*>)${OPENERS}*${DRASHA_WORD}${CLOSERS}*$`,
  'i'
);
const DRASHA_WITH_TIME = new RegExp(`${DRASHA_WORD}\\s*\\d{1,2}:\\d{2}`);
export function dropDuplicateDrasha(value) {
  const text = String(value ?? '');
  if (!DRASHA_WITH_TIME.test(plainText(text))) return text;
  return text.replace(TRAILING_BARE_DRASHA, '');
}

/** Applies every enabled rule to a row of computed cell text, returning a new object
 *  with matching columns replaced or appended to. `appliedColumns` (a Set) collects
 *  which *column keys* were touched by a rule, so the UI can flag those specific cells.
 *
 *  rule.mode: 'replace' (default) swaps the cell's whole computed value for rule.value;
 *  'append' adds rule.value as an extra line onto whatever the cell already computed
 *  to (e.g. adding the word "דרשה" without losing the actual Mincha times). */
export function applyRules(row, week, rules, season, appliedColumns) {
  let out = row;
  for (const rule of rules) {
    if (!rule.enabled || isRetiredTishaBavRule(rule)) continue;
    if (!conditionMatches(rule.condition, week)) continue;
    for (const col of targetColumnsForSeason(rule, season)) {
      if (!(col in out)) continue;
      if (out === row) out = { ...row };
      out[col] = rule.mode === 'append' ? [out[col], rule.value].filter(Boolean).join('\n') : rule.value;
      if (appliedColumns) appliedColumns.add(col);
    }
  }
  return out;
}

