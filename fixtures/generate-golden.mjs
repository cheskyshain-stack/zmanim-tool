// Regenerates fixtures/golden.json, the reference output every port of this app's
// calculation engine has to reproduce.
//
// The modules are ES modules that fetch data/*.json, so they are run in a real browser
// context against a locally served copy of this folder rather than under bare Node. That
// also means the fixture is produced by exactly the code the site runs, with no shims.
//
//   python3 -m http.server 9611
//   node fixtures/generate-golden.mjs > fixtures/golden.json
//
// PORT is honoured if the server is somewhere else. Playwright and a Chromium binary are
// the only things needed beyond the repository itself; see fixtures/README.md.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || '9611';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/admin/`, { waitUntil: 'domcontentloaded' });

const fixture = await page.evaluate(async (base) => {
  const [solar, Z, cal, fmt, util, weeks, pag, kayitz, choref, weekday, common, settingsMod, rules, loader] = await Promise.all(
    [
      'zmanim/solar', 'zmanim/zmanim', 'hebrew-calendar', 'format', 'util', 'sheets/weeks',
      'pagination', 'sheets/kayitz', 'sheets/choref', 'sheets/weekday', 'sheets/common',
      'settings', 'rules', 'data-loader',
    ].map((m) => import(`${base}/js/${m}.js`))
  );
  const tables = await loader.loadTables();

  // Defaults exactly as shipped: Lakewood, Hebrew, America/New_York. A port that changes
  // any of these will not reproduce the numbers below.
  const settings = settingsMod.resolveSettings({ ...settingsMod.DEFAULT_SETTINGS });

  // The invisible characters are written out, so the fixture is readable, diffable, and
  // survives a copy through an editor that would otherwise eat them.
  const esc = (s) =>
    String(s ?? '')
      .split('').join('{U}')
      .split('').join('{/U}')
      .split(' ').join('{NB}')
      .split('\n').join('{LF}');

  const iso = (serial) => solar.dateFromSerial(serial).toISOString().slice(0, 10);
  const serialOf = (isoDate) => solar.excelSerial(new Date(isoDate + 'T00:00:00Z'));

  // --- 1. Named zmanim, daily -------------------------------------------------------
  // A full Gregorian year, so both DST cutovers and both solstices are in it. Values are
  // fractional local days exactly as the workbook produces them; the formatted string is
  // what actually reaches the page.
  const ZMANIM = [
    'sunrise', 'sunset', 'sunriseElev', 'sunsetElev', 'solarNoon', 'alos16_1', 'misheyakir10_2',
    'tzais50', 'tzais60', 'tzais72', 'tzaisGeonim8_5', 'alos72', 'minchaGedola',
    'minchaGedola30MinAfterChatzos', 'minchaGedolaLechumra', 'minchaKetana',
    'samuchLeminchaKetana', 'plagHamincha', 'sofZmanShmaGRA', 'sofZmanShmaMGA72', 'sofZmanTfilaGRA',
  ];
  const zmanim = [];
  for (let s = serialOf('2026-01-01'); s <= serialOf('2026-12-31'); s++) {
    const date = solar.dateFromSerial(s);
    const row = { date: iso(s), serial: s, dst: Z.dstLocal(date, settings) };
    for (const name of ZMANIM) {
      const v = Z[name](date, settings);
      row[name] = { day: v, time: fmt.formatTime(v) };
    }
    zmanim.push(row);
  }

  // --- 2. The calendar core, across two centuries -----------------------------------
  // Small, and it pins roshHashana and the year-length arithmetic far harder than any
  // window of daily dates could.
  const years = [];
  for (let y = 5700; y <= 5900; y++) {
    const rh = cal.roshHashana(y - 3761);
    const next = cal.roshHashana(y - 3760);
    const j = cal.hebrewDateExtended(rh);
    years.push({
      year: y, roshHashanaSerial: rh, roshHashanaDate: iso(rh), roshHashanaWeekday: cal.excelWeekday(rh),
      yearLength: next - rh, yearType: j.yearType, leap: j.leap,
    });
  }

  // --- 3. The calendar, day by day --------------------------------------------------
  const calendar = [];
  for (let s = serialOf('2025-09-01'); s <= serialOf('2029-09-01'); s++) {
    const j = cal.hebrewDateExtended(s, settings.useGregorianBefore1582);
    const entry = {
      date: iso(s), serial: s, weekday: cal.excelWeekday(s),
      h: [j.dayOfMonth, j.month, j.year], dayOfYear: j.dayOfYear, yearType: j.yearType, leap: j.leap,
      he: cal.jewishDateString(s, false), en: cal.jewishDateString(s, true),
    };
    // Only what is actually set, so a day with nothing special stays one short line.
    const parsha = cal.hasParsha(s, settings, tables);
    const special = cal.hasSpecialParsha(s, settings);
    const yomTov = cal.hasYomTov(s, settings, tables.specialDays);
    const rc = cal.hasRoshChodesh(s, settings);
    const behab = cal.hasBehab(s, settings);
    const taanis = cal.hasTaanis(s, settings);
    if (parsha) entry.parsha = parsha;
    if (special) entry.specialParsha = special;
    if (yomTov) entry.yomTov = yomTov;
    if (rc) entry.roshChodesh = rc;
    if (behab) entry.behab = behab;
    if (taanis) entry.taanis = taanis;
    if (cal.isAssurMelacha(s, settings)) entry.assurMelacha = true;
    calendar.push(entry);
  }

  // --- 4. dateFromHebrew round trip -------------------------------------------------
  // Every month of every year in the daily window, both directions.
  const hebrewRoundTrip = [];
  for (let y = 5786; y <= 5790; y++) {
    const leap = cal.hebrewDateExtended(cal.roshHashana(y - 3761)).leap;
    for (const m of leap ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const d of [1, 15, 29]) {
        const s = cal.dateFromHebrew(d, m, y);
        const back = cal.hebrewDateExtended(s);
        hebrewRoundTrip.push({ in: [d, m, y], serial: s, date: iso(s), out: [back.dayOfMonth, back.month, back.year] });
      }
    }
  }

  // --- 5. Week lists, built rows, page splits ---------------------------------------
  const seasons = [];
  const seededFirings = [];
  // The three rules seeded into a new install (see js/storage.js). Carried here so a port
  // can prove its rule engine fires on the same weeks with the same result.
  const SEEDED = [
    { id: 'rule-shabbos-hagadol', enabled: true, condition: { specialParsha: ['הגדול', 'Hagadol'] }, columnKeys: ['kayitz:C', 'choref:C'], mode: 'append', value: 'דרשה' },
    { id: 'rule-shabbos-shuva', enabled: true, condition: { specialParsha: ['שובה', 'Shuva'] }, columnKeys: ['kayitz:C', 'choref:C'], mode: 'append', value: 'דרשה' },
    { id: 'rule-tisha-bav', enabled: true, condition: { hebrewDate: ['5-8', '5-9'] }, columnKeys: ['kayitz:B', 'kayitz:C', 'choref:B', 'choref:C'], mode: 'append', value: 'ט באב' },
  ];

  for (const season of ['kayitz', 'choref']) {
    // 5781 through 5793 rather than a rounder range: it is the shortest run that
    // exercises all six year-type/leap combinations the parsha table is keyed on
    // (3P 5781, 4M 5782, 5P 5783, 3M 5784, 4P 5786, 5M 5787). See edgeCases.yearTypes,
    // which is there to prove that stays true if anyone changes this.
    for (let year = 5781; year <= 5793; year++) {
      const built = weeks.computeSeasonWeeks(season, year, settings, tables);
      const wd = weeks.computeWeekdayWeeks(season, year, settings, tables);
      const builderFor = (s) => (s === 'kayitz' ? kayitz.buildKayitzRow : choref.buildChorefRow);
      const columnsFor = (s) => (s === 'kayitz' ? kayitz.KAYITZ_COLUMNS : choref.CHOREF_COLUMNS);

      // Three pages, split the way the Generate form pre-fills them, with the weekday
      // chart's breaks aligned onto the same dates.
      const pageSizes = pag.defaultPageSizes(built.weeks.length, 3);
      const weekdayPageSizes = pag.alignPageSizesTo(built.weeks, pageSizes, wd.weeks);
      // Which season each page really prints as: a חורף page holding a week past the
      // spring cutover comes out as a full קיץ chart, for the whole page. Same test as
      // pageEffectiveSeason in js/ui/sheet-view.js.
      const split = pag.splitWeeksIntoPages(built.weeks, pageSizes);
      const effectiveSeasons = split.map((pw) =>
        season !== 'choref' ? season : pw.some((w) => common.inSpringDstWindow(w.date, settings)) ? 'kayitz' : 'choref'
      );
      const pages = split.map((pw, i) => ({
        weeks: pw.length,
        from: pw.length ? iso(pw[0].serial) : null,
        to: pw.length ? iso(pw[pw.length - 1].serial) : null,
        effectiveSeason: effectiveSeasons[i],
      }));

      // A row is built with its *page's* effective season, not the sheet's nominal one.
      // Building every row with the nominal builder was wrong and the cross-check caught
      // it: on a חורף season's last page the app renders קיץ's twelve columns, so a
      // fixture built the other way disagrees with the chart on screen from the spring
      // cutover onwards.
      const rows = [];
      split.forEach((pageWeeks, pageIndex) => {
        const effectiveSeason = effectiveSeasons[pageIndex];
        const buildRow = builderFor(effectiveSeason);
        const columns = columnsFor(effectiveSeason);
        for (const w of pageWeeks) {
          const week = { ...w, date: solar.dateFromSerial(w.serial) };
          const computed = buildRow(week, settings);
          const out = { date: iso(w.serial), serial: w.serial, page: pageIndex, builtAs: effectiveSeason, parsha: w.parsha };
          if (w.specialParsha) out.specialParsha = w.specialParsha;
          for (const c of columns) out[c.key] = esc(computed[c.key]);
          // What the rules would do to it, kept separate so the raw engine output above
          // stays the primary comparison. Matched against the effective season too, for
          // the same reason: a קיץ-printing page matches "kayitz:" rules.
          const withHebrew = { ...week, hebrew: cal.hebrewDateExtended(w.serial, settings.useGregorianBefore1582) };
          const applied = new Set();
          const ruled = rules.applyRules(computed, withHebrew, SEEDED, effectiveSeason, applied);
          if (applied.size) {
            seededFirings.push({
              season, year, date: iso(w.serial), builtAs: effectiveSeason, parsha: w.parsha, specialParsha: w.specialParsha || '',
              columns: [...applied].sort(), after: Object.fromEntries([...applied].sort().map((k) => [k, esc(ruled[k])])),
            });
          }
          rows.push(out);
        }
      });

      const weekdayRows = wd.weeks.map((w) => {
        const week = { ...w, date: solar.dateFromSerial(w.serial) };
        const computed = weekday.buildWeekdayRow(week, settings);
        return { date: iso(w.serial), serial: w.serial, label: w.parsha, B: esc(computed.B), C: esc(computed.C) };
      });

      seasons.push({
        season, hebrewYear: year,
        range: { start: iso(built.startSerial), end: iso(built.endSerial) },
        pageSizes, weekdayPageSizes, pages,
        weekCount: built.weeks.length, weekdayWeekCount: wd.weeks.length,
        rows, weekdayRows,
      });
    }
  }

  // --- 6. Formatting helpers --------------------------------------------------------
  const formatting = {
    formatTime: [0, 1 / 1440, 0.5, 0.5 - 1 / 1440, 12.5 / 24, 13 / 24, 23.5 / 24, 1 - 1 / 1440, 0.9999999]
      .map((v) => ({ day: v, out: fmt.formatTime(v) })),
    rounding: [0.5, 0.500001, 0.5000001, 0.5006944444444444, 0.5006944444444443]
      .map((v) => ({ day: v, ceil: fmt.ceilToMinute(v), floor: fmt.floorToMinute(v), round: fmt.roundToMinute(v) })),
    underlineTime: [{ in: 0.5, out: esc(fmt.underlineTime(0.5)) }, { in: '7:30', out: esc(fmt.underlineTime('7:30')) }],
    normalizeTimeList: ['1220 130', '8', '730 815', '7:15 735', '12:20/1:30', 'פלג 645']
      .map((s) => ({ in: s, out: fmt.normalizeTimeList(s) })),
    splitLinesInHalf: [1, 2, 3, 4, 5, 6, 7]
      .map((n) => ({ n, out: esc(util.splitLinesInHalf(Array.from({ length: n }, (_, i) => `${i + 1}:00`))) })),
    constants: { NBSP: 'U+00A0', SLASH: 'U+00A0 / U+00A0', UL_START: 'U+E000', UL_END: 'U+E001' },
  };

  // --- 7. The named edge cases ------------------------------------------------------
  // Each one is a pointer: a port that fails here has a specific bug, not a vague drift.
  const dstDays = [];
  for (let s = serialOf('2026-03-05'); s <= serialOf('2026-03-12'); s++) dstDays.push(s);
  for (let s = serialOf('2026-10-29'); s <= serialOf('2026-11-05'); s++) dstDays.push(s);
  const edgeCases = {
    dstCutovers: dstDays.map((s) => ({
      date: iso(s), dst: Z.dstLocal(solar.dateFromSerial(s), settings),
      springWindow: common.inSpringDstWindow(solar.dateFromSerial(s), settings),
      sunset: fmt.formatTime(Z.sunset(solar.dateFromSerial(s), settings)),
    })),
    // The autumn cutover is nominally "DST active" too and must NOT flip a חורף page.
    springWindowIsSpringOnly: [serialOf('2026-03-14'), serialOf('2026-05-30'), serialOf('2026-06-06'), serialOf('2026-10-17')].map((s) => ({
      date: iso(s), springWindow: common.inSpringDstWindow(solar.dateFromSerial(s), settings),
    })),
    plagWindow: [4, 16, 17, 64, 65, 191, 192, 193].map((doy) => ({ hebrewDayOfYear: doy })),
    // 9 Av on Shabbos (fast deferred to Sunday) and 9 Av on Sunday (Shabbos before is 8 Av).
    tishaBav: [],
    yomTovShabbosos: [],
    yearTypes: {},
  };
  for (let y = 5784; y <= 5800; y++) {
    const s = cal.dateFromHebrew(9, 5, y);
    edgeCases.tishaBav.push({ hebrewYear: y, date: iso(s), weekday: cal.excelWeekday(s), taanis: cal.hasTaanis(s, settings), deferred: cal.excelWeekday(s) === 7 });
  }
  for (let s = serialOf('2025-09-01'); s <= serialOf('2029-09-01'); s++) {
    if (cal.excelWeekday(s) !== 7) continue;
    if (cal.hasParsha(s, settings, tables)) continue;
    const name = cal.hasYomTov(s, settings, tables.specialDays);
    edgeCases.yomTovShabbosos.push({ date: iso(s), yomTov: name, isYomTovLabel: cal.isYomTovWeekLabel(name), printedAs: cal.weekOfLabel(name, false) });
  }
  // Which year types the season range above actually exercises. Both special branches in
  // hebrewDateExtended (yearType 3 and 5) have to appear here or the coverage is thin.
  for (const y of years.filter((r) => r.year >= 5781 && r.year <= 5793)) {
    const key = `${y.yearType}${y.leap ? 'M' : 'P'}`;
    edgeCases.yearTypes[key] = (edgeCases.yearTypes[key] || []).concat(y.year);
  }

  return {
    meta: {
      what: 'Golden reference output for the zmanim engine. Any port must reproduce this exactly.',
      source: 'https://github.com/cheskyshain-stack/zmanim-tool',
      generator: 'fixtures/generate-golden.mjs',
      escapes: { '{U}': 'U+E000 underline start', '{/U}': 'U+E001 underline end', '{NB}': 'U+00A0 no-break space', '{LF}': 'newline' },
      renderNote:
        'These are raw engine strings, before any rendering. underlineTime writes a U+00A0 straight after the ' +
        'underline sentinel, so every underlined value here reads {U}{NB}. The renderer strips whitespace ' +
        'immediately after the sentinel (nl2br in js/ui/sheet-view.js and weekNl2br in js/ui/week-view.js), ' +
        'so what reaches the page has one separator space, not two. Compare engine output against this file, ' +
        'and compare rendered output against this file with that strip applied.',
      settings: {
        locationName: settings.locationName, latitude: settings.latitude, longitude: settings.longitude,
        elevation: settings.elevation, timezone: settings.timezone, language: settings.language,
        horizon: settings.horizon, candleLightingMinutes: settings.candleLightingMinutes,
        useAstronomicalChatzos: settings.useAstronomicalChatzos, useElevation: settings.useElevation,
        inIsrael: settings.inIsrael, useGregorianBefore1582: settings.useGregorianBefore1582,
      },
    },
    formatting,
    years,
    hebrewRoundTrip,
    calendar,
    zmanim,
    seasons,
    seededFirings,
    edgeCases,
  };
}, BASE);

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
process.stdout.write(JSON.stringify(fixture, null, 1) + '\n');
