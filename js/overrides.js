// Per-cell manual overrides, tied to one generated sheet instance (unlike rules,
// which are reusable across every future year). Stored as sheet.overrides[weekSerial][columnKey].
export function getOverride(sheet, weekSerial, columnKey) {
  return sheet.overrides?.[weekSerial]?.[columnKey];
}
export function setOverride(sheet, weekSerial, columnKey, value) {
  if (!sheet.overrides) sheet.overrides = {};
  if (!sheet.overrides[weekSerial]) sheet.overrides[weekSerial] = {};
  sheet.overrides[weekSerial][columnKey] = value;
}
export function clearOverride(sheet, weekSerial, columnKey) {
  if (sheet.overrides?.[weekSerial]) {
    delete sheet.overrides[weekSerial][columnKey];
    if (Object.keys(sheet.overrides[weekSerial]).length === 0) delete sheet.overrides[weekSerial];
  }
}

/** Merges computed values with any stored overrides, returning {row, overriddenKeys}. */
export function mergeRow(computedRow, sheet, weekSerial) {
  const overriddenKeys = new Set();
  const row = { ...computedRow };
  const weekOverrides = sheet.overrides?.[weekSerial];
  if (weekOverrides) {
    for (const [key, value] of Object.entries(weekOverrides)) {
      row[key] = value;
      overriddenKeys.add(key);
    }
  }
  return { row, overriddenKeys };
}
