// Rule engine: reusable, condition-based overrides (e.g. "Shabbos Teshuva and Shabbos
// HaGadol have a different Mincha time because of the drasha"). Applied to every
// generated sheet automatically, before any one-off manual per-cell overrides — that's
// the intended distinction between rules (recurring, reapplies every year) and
// overrides (tied to one generated sheet instance).
//
// A rule's columnKeys are sheet-qualified ("kayitz:L", "choref:I") because the same
// bare letter means a *different* cell on each sheet (e.g. קיץ column I is a Plag
// Mincha variant, but חורף column I is the main Erev Shabbos Mincha) — qualifying by
// sheet lets one rule safely cover both charts' "equivalent" cell at once without ever
// touching the wrong column on the other sheet.
//
// A condition can combine any of:
//   specialParsha: [names]      - matches week.specialParsha (Hebrew or English)
//   parsha:        [names]      - matches week.parsha
//   dateISO:       [YYYY-MM-DD] - matches an explicit Gregorian date
//   always:        true         - matches every week (for a blanket override)
function conditionMatches(condition, week) {
  if (condition.always) return true;
  if (condition.specialParsha && condition.specialParsha.includes(week.specialParsha)) return true;
  if (condition.parsha && condition.parsha.includes(week.parsha)) return true;
  if (condition.dateISO && condition.dateISO.includes(week.date.toISOString().slice(0, 10))) return true;
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
      if (!entry.includes(':')) return entry; // legacy bare key — applies on any sheet
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
