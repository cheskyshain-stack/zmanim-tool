"""The rule engine (js/rules.js): reusable, condition based overrides applied to every
generated sheet, before any one-off manual per-cell override.

That is the whole distinction. A rule recurs every year; an override belongs to one
generated sheet.

A rule's column keys are season qualified, "kayitz:L" and "choref:I", because the same
bare letter means a different cell on each chart: קיץ column I is a Plag Mincha variant
while חורף column I is the main Erev Shabbos Mincha. Qualifying lets one rule cover both
charts' equivalent cell at once without ever touching the wrong column on the other.

A condition can combine any of:
    specialParsha: [names]       matches the week's special Shabbos, Hebrew or English
    parsha:        [names]       matches the week's parsha
    dateISO:       [YYYY-MM-DD]  matches an explicit Gregorian date
    hebrewDate:    ["month-day"] matches a Hebrew date, "5-9" being ט' באב, month 5 = Av.
                                 Recurs every year, unlike dateISO.
    always:        true          matches every week
"""


def condition_matches(condition: dict, week, hebrew=None) -> bool:
    """hebrew is the week's Hebrew date, passed in rather than stored on a saved sheet, so
    hebrewDate conditions work for sheets generated before they existed."""
    if condition.get("always"):
        return True
    if condition.get("specialParsha") and week.special_parsha in condition["specialParsha"]:
        return True
    if condition.get("parsha") and week.parsha in condition["parsha"]:
        return True
    if condition.get("dateISO") and week.date.isoformat() in condition["dateISO"]:
        return True
    if condition.get("hebrewDate") and hebrew and f"{hebrew.month}-{hebrew.day_of_month}" in condition["hebrewDate"]:
        return True
    return False


def target_columns_for_season(rule: dict, season: str):
    """A rule's target columns for this season, as bare keys.

    Accepts the current qualified format, and for data saved before it existed, bare keys
    (which apply on any sheet) and the older singular columnKey field.
    """
    raw = rule.get("columnKeys") if isinstance(rule.get("columnKeys"), list) else ([rule["columnKey"]] if rule.get("columnKey") else [])
    out = []
    for entry in raw:
        if ":" not in entry:
            out.append(entry)  # a legacy bare key applies on any sheet
            continue
        entry_season, key = entry.split(":", 1)
        if entry_season == season:
            out.append(key)
    return out


def apply_rules(row: dict, week, rules, season: str, hebrew=None, applied_columns: set | None = None) -> dict:
    """Every enabled rule applied to a row of computed cell text.

    mode 'replace' (the default) swaps the cell's whole computed value; 'append' adds the
    value as an extra line under whatever the cell already computed to, which is how the
    word דרשה is added without losing the actual Mincha times.

    applied_columns collects which keys a rule touched, so the interface can flag them.
    """
    out = row
    for rule in rules:
        if not rule.get("enabled"):
            continue
        if not condition_matches(rule.get("condition") or {}, week, hebrew):
            continue
        for col in target_columns_for_season(rule, season):
            if col not in out:
                continue
            if out is row:
                out = dict(row)
            value = rule.get("value", "")
            out[col] = "\n".join([x for x in (out[col], value) if x]) if rule.get("mode") == "append" else value
            if applied_columns is not None:
                applied_columns.add(col)
    return out
