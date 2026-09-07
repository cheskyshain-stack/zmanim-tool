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
    if (!rule.enabled) continue;
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
