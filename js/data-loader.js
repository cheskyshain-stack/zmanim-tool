// Loads the ported Hebrew-calendar lookup tables (data/*.json - exact copies of the
// workbook's PARSHA_TABLE_CHUTZ / PARSHA_TABLE_EY / PARSHA_NAMES_TABLE / SPECIAL_DAYS_TABLE).
let cached = null;

export async function loadTables() {
  if (cached) return cached;
  const [parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(
    ['/data/parsha_chutz.json', '/data/parsha_ey.json', '/data/parsha_names.json', '/data/special_days.json'].map((p) =>
      fetch(p).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${p}: ${r.status}`);
        return r.json();
      })
    )
  );
  cached = { parshaChutz, parshaEY, parshaNames, specialDays };
  return cached;
}
