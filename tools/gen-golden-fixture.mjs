// Golden fixture generator: dumps every computed value the calculation engine
// produces, for a long run of Hebrew years, so a port of that engine can be checked
// against it character for character.
//
// This exists because the engine is a 1:1 port of a workbook that is not in this repo
// (see CLAUDE.md). The workbook is the source of truth, this code is the only surviving
// executable copy of it, and so this fixture is what any second implementation has to
// agree with. A difference is a bug in the new implementation until proven otherwise.
//
// Run:  node tools/gen-golden-fixture.mjs [--years 5784-5795] [--out fixtures/golden.json]
//
// The output holds the raw strings, sentinels and all: underline markers travel through
// the formula code as U+E000/U+E001 (see js/format.js) and the separator inside a time
// pair is a non-breaking space (U+00A0). Those characters are part of what has to match,
// so they are written through literally rather than being tidied away.

import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

import { DEFAULT_SETTINGS, resolveSettings } from '../js/settings.js';
import { excelSerial, dateFromSerial } from '../js/zmanim/solar.js';
import * as Z from '../js/zmanim/zmanim.js';
import {
  hebrewDateExtended, dateFromHebrew, excelWeekday, roshHashana,
  hasParsha, hasSpecialParsha, hasYomTov, hasRoshChodesh, hasBehab, hasTaanis,
  isAssurMelacha, isYomTovOrCholHamoed, jewishDateString, weekOfLabel, isYomTovWeekLabel,
} from '../js/hebrew-calendar.js';
import { computeSeasonWeeks, computeWeekdayWeeks, splitChorefAtSpringCutover } from '../js/sheets/weeks.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../js/sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../js/sheets/choref.js';
import { buildWeekdayRow, WEEKDAY_COLUMNS } from '../js/sheets/weekday.js';
import { inPlagWindow, inSpringDstWindow } from '../js/sheets/common.js';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const [yearFrom, yearTo] = argOf('--years', '5784-5795').split('-').map(Number);
const outPath = argOf('--out', 'fixtures/golden.json');

const json = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const tables = {
  parshaChutz: json('data/parsha_chutz.json'),
  parshaEY: json('data/parsha_ey.json'),
  parshaNames: json('data/parsha_names.json'),
  specialDays: json('data/special_days.json'),
};

const settings = resolveSettings(DEFAULT_SETTINGS);

const iso = (serial) => dateFromSerial(serial).toISOString().slice(0, 10);

/** Every named zman for one day, as an exact day-fraction and as the string the sheets
 *  would print. The fractions are the layer to check first when a printed cell differs:
 *  a mismatch there is a solar/calendar bug, a mismatch only in the string is a
 *  rounding or formatting bug. Written to 12 decimal places, which is finer than the
 *  1e-7 epsilon the minute-rounding helpers use, so it can never hide a real difference
 *  while still not recording float noise past what is meaningful. */
function zmanimFor(serial) {
  const date = dateFromSerial(serial);
  const named = {
    sunrise: Z.sunrise(date, settings),
    sunset: Z.sunset(date, settings),
    sunriseElev: Z.sunriseElev(date, settings),
    sunsetElev: Z.sunsetElev(date, settings),
    solarNoon: Z.solarNoon(date, settings),
    alos16_1: Z.alos16_1(date, settings),
    alos72: Z.alos72(date, settings),
    misheyakir10_2: Z.misheyakir10_2(date, settings),
    tzais50: Z.tzais50(date, settings),
    tzais60: Z.tzais60(date, settings),
    tzais72: Z.tzais72(date, settings),
    tzaisGeonim8_5: Z.tzaisGeonim8_5(date, settings),
    minchaGedola: Z.minchaGedola(date, settings),
    minchaGedola30MinAfterChatzos: Z.minchaGedola30MinAfterChatzos(date, settings),
    minchaGedolaLechumra: Z.minchaGedolaLechumra(date, settings),
    minchaKetana: Z.minchaKetana(date, settings),
    samuchLeminchaKetana: Z.samuchLeminchaKetana(date, settings),
    plagHamincha: Z.plagHamincha(date, settings),
    sofZmanShmaGRA: Z.sofZmanShmaGRA(date, settings),
    sofZmanShmaMGA72: Z.sofZmanShmaMGA72(date, settings),
    sofZmanTfilaGRA: Z.sofZmanTfilaGRA(date, settings),
  };
  const out = {};
  for (const [k, v] of Object.entries(named)) out[k] = Number(v.toFixed(12));
  return out;
}

/** The Hebrew-calendar facts for one day. Everything a row's formulas branch on lives
 *  here, so a port that gets a cell wrong can be narrowed to the calendar or the zmanim
 *  without re-deriving either. */
function calendarFor(serial) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  return {
    dayOfMonth: j.dayOfMonth,
    month: j.month,
    year: j.year,
    dayOfYear: j.dayOfYear,
    leap: j.leap,
    yearType: j.yearType,
    roshHashana: j.roshHashana,
    yearLength: j.yearLength,
    weekday: excelWeekday(serial),
    dateString: jewishDateString(serial, false, settings.useGregorianBefore1582),
    parsha: hasParsha(serial, settings, tables),
    specialParsha: hasSpecialParsha(serial, settings),
    yomTov: hasYomTov(serial, settings, tables.specialDays),
    roshChodesh: hasRoshChodesh(serial, settings),
    behab: hasBehab(serial, settings),
    taanis: hasTaanis(serial, settings),
    assurMelacha: isAssurMelacha(serial, settings),
    yomTovOrCholHamoed: isYomTovOrCholHamoed(serial, settings, tables.specialDays),
    dstLocal: Z.dstLocal(dateFromSerial(serial), settings),
    inSpringDstWindow: inSpringDstWindow(dateFromSerial(serial), settings),
    inPlagWindow: inPlagWindow(serial, settings),
  };
}

function weekEntry(week, season) {
  const row = season === 'kayitz' ? buildKayitzRow(week, settings)
    : season === 'choref' ? buildChorefRow(week, settings)
    : buildWeekdayRow(week, settings);
  return {
    serial: week.serial,
    date: iso(week.serial),
    parsha: week.parsha,
    // How the label is actually printed: a Shabbos that is Yom Tov has no parsha, so the
    // week carries the Yom Tov's name and must read "שבוע של סוכות", not "סוכות".
    printedLabel: weekOfLabel(week.parsha, settings.english),
    isYomTovWeek: isYomTovWeekLabel(week.parsha),
    specialParsha: week.specialParsha,
    hebrew: calendarFor(week.serial),
    cells: row,
  };
}

const seasons = [];
for (let y = yearFrom; y <= yearTo; y++) {
  for (const season of ['kayitz', 'choref']) {
    const { startSerial, endSerial, weeks } = computeSeasonWeeks(season, y, settings, tables);
    const weekday = computeWeekdayWeeks(season, y, settings, tables);
    seasons.push({
      season,
      hebrewYear: y,
      startSerial,
      endSerial,
      startDate: iso(startSerial),
      endDate: iso(endSerial),
      // Which week a חורף season first needs a real קיץ chart from (weeks.length when it
      // never does). The page holding that week prints as a full twelve-column קיץ chart.
      springCutoverIndex: season === 'choref' ? splitChorefAtSpringCutover(weeks, settings) : null,
      weeks: weeks.map((w) => weekEntry(w, season)),
      weekdayWeeks: weekday.weeks.map((w) => weekEntry(w, 'weekday')),
    });
  }
}

// ---------------------------------------------------------------------------
// Probes: the specific dates that broke something before, or that sit exactly on a
// branch boundary. A port can pass the bulk dump above by being right about ordinary
// weeks and still be wrong about all of these, which is why they are named and pinned
// rather than left to be found somewhere in the run of years.
// ---------------------------------------------------------------------------

const probes = {};
const addProbe = (group, label, serial) => {
  (probes[group] ??= []).push({ label, serial, date: iso(serial), calendar: calendarFor(serial), zmanim: zmanimFor(serial) });
};

// DST cutovers, both directions, with the day either side. dateFromSerial floors rather
// than rounds precisely so an evening event does not get looked up against the next
// calendar day, which used to break the week of the autumn cutover by an hour.
const nthSunday = (y, month, nth) => {
  const first = new Date(Date.UTC(y, month, 1));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return excelSerial(new Date(Date.UTC(y, month, firstSunday + (nth - 1) * 7)));
};
for (let gy = 2024; gy <= 2035; gy++) {
  const spring = nthSunday(gy, 2, 2);
  const autumn = nthSunday(gy, 10, 1);
  for (const d of [-1, 0, 1]) {
    addProbe('dstSpring', `${gy} spring ${d >= 0 ? '+' : ''}${d}`, spring + d);
    addProbe('dstAutumn', `${gy} autumn ${d >= 0 ? '+' : ''}${d}`, autumn + d);
  }
}

// The window boundaries the קיץ columns branch on, pinned by Hebrew day-of-year rather
// than by date so they land on the exact boundary in every year type.
for (let y = yearFrom; y <= yearTo; y++) {
  const rh = roshHashana(y - 3761);
  const doyOf = (serial) => hebrewDateExtended(serial, settings.useGregorianBefore1582).dayOfYear;
  // Day-of-year is not a fixed offset from Rosh Hashana (yearType 3 and 5 shift it), so
  // the wanted day is searched for rather than computed.
  for (const target of [16, 17, 64, 65, 66, 191, 192, 193]) {
    for (let s = rh - 20; s < rh + 400; s++) {
      if (doyOf(s) === target) { addProbe('dayOfYearBoundaries', `${y} doy ${target}`, s); break; }
    }
  }
}

// 9 Av both ways: on Shabbos the fast is deferred to Sunday, and the Shabbos before a
// Sunday 9 Av is itself 8 Av. The seeded rule targets both dates for exactly this reason.
for (let y = yearFrom; y <= yearTo + 1; y++) {
  const nine = dateFromHebrew(9, 5, y);
  addProbe('tishaBav', `${y} 9 Av (weekday ${excelWeekday(nine)})`, nine);
  addProbe('tishaBav', `${y} 8 Av`, dateFromHebrew(8, 5, y));
}

// Every special Shabbos, including the three a seeded rule fires on.
for (let y = yearFrom; y <= yearTo; y++) {
  const rh = roshHashana(y - 3761);
  const seen = new Set();
  for (let s = rh; s < rh + 390; s++) {
    if (excelWeekday(s) !== 7) continue;
    const sp = hasSpecialParsha(s, settings);
    if (sp && !seen.has(sp)) { seen.add(sp); addProbe('specialParsha', `${y} ${sp}`, s); }
  }
}

// A Shabbos that is Yom Tov, so there is no parsha and the week is labelled for the
// Yom Tov instead.
for (let y = yearFrom; y <= yearTo; y++) {
  const rh = roshHashana(y - 3761);
  for (let s = rh; s < rh + 390; s++) {
    if (excelWeekday(s) !== 7) continue;
    if (hasParsha(s, settings, tables)) continue;
    addProbe('parshalessShabbos', `${y} ${hasYomTov(s, settings, tables.specialDays)}`, s);
  }
}

// Each end of each BMG זמן, which decides whether a Weekday row prints its 4:15 מנחה and
// its 11:30/12:00 מעריב.
const BMG = [
  { name: 'elul-yomkippur', start: [1, 6], end: [10, 7], endYearOffset: 1 },
  { name: 'cheshvan-nissan', start: [1, 8], end: [7, 1], endYearOffset: 0 },
  { name: 'iyar-av', start: [1, 2], end: [9, 5], endYearOffset: 0 },
];
for (let y = yearFrom; y <= yearTo; y++) {
  for (const r of BMG) {
    const from = dateFromHebrew(r.start[0], r.start[1], y);
    const to = dateFromHebrew(r.end[0], r.end[1], y + r.endYearOffset);
    for (const [label, s] of [[`${r.name} start-1`, from - 1], [`${r.name} start`, from], [`${r.name} end`, to], [`${r.name} end+1`, to + 1]]) {
      addProbe('bmgBoundaries', `${y} ${label}`, s);
    }
  }
}

// Every year type and both leap/non-leap, so the yearType 3 and 5 branches in
// hebrewDateExtended are exercised by name rather than by luck.
const yearTypesSeen = {};
for (let y = yearFrom - 6; y <= yearTo + 6; y++) {
  const rh = roshHashana(y - 3761);
  const j = hebrewDateExtended(rh, settings.useGregorianBefore1582);
  const key = `${j.yearType}${j.leap ? 'M' : 'P'}`;
  (yearTypesSeen[key] ??= []).push(y);
}

const fixture = {
  meta: {
    generatedFrom: 'js/ (the ported workbook engine) via tools/gen-golden-fixture.mjs',
    hebrewYears: [yearFrom, yearTo],
    // Anything reading this file has to preserve these exactly. They are not decoration:
    // the underline sentinels are how "this time is an alternate" survives from the
    // formula code to the renderer, and the non-breaking space is what stops a time pair
    // wrapping across two lines in a narrow column.
    sentinels: { underlineStart: 'U+E000', underlineEnd: 'U+E001', nbsp: 'U+00A0' },
    columns: {
      kayitz: KAYITZ_COLUMNS.map((c) => c.key),
      choref: CHOREF_COLUMNS.map((c) => c.key),
      weekday: WEEKDAY_COLUMNS.map((c) => c.key),
    },
    columnHeaders: { kayitz: KAYITZ_COLUMNS, choref: CHOREF_COLUMNS, weekday: WEEKDAY_COLUMNS },
    yearTypesCovered: yearTypesSeen,
  },
  settings: DEFAULT_SETTINGS,
  seasons,
  probes,
};

writeFileSync(new URL('../' + outPath, import.meta.url), JSON.stringify(fixture, null, 1) + '\n');

const weekCount = seasons.reduce((n, s) => n + s.weeks.length, 0);
const weekdayCount = seasons.reduce((n, s) => n + s.weekdayWeeks.length, 0);
const probeCount = Object.values(probes).reduce((n, p) => n + p.length, 0);
console.log(`${outPath}: ${seasons.length} seasons, ${weekCount} שבת weeks, ${weekdayCount} weekday weeks, ${probeCount} probes`);
