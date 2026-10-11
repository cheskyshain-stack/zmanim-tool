import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import * as Z from '../js/zmanim/zmanim.js';
import { excelSerial, timezoneOffsetUTC, timezoneOffset, shulNow } from '../js/zmanim/solar.js';
import { workbookCalculator, omitted } from './helpers/workbook-lambda.mjs';
import { buildWeekdayRow } from '../js/sheets/weekday.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/workbook-zmanim.json', import.meta.url)));
const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url)));
const original = Object.fromEntries(Object.entries(fixture.settings).map(([key, value]) => [key, value.value]));
const workbookSettings = resolveSettings({ ...original, horizon: -original.horizon, language: 'he' });
const liveSettings = resolveSettings(published.settings);
const named = {
  SUNRISE: Z.sunrise, SUNSET: Z.sunset, SUNRISE_elev: Z.sunriseElev, SUNSET_elev: Z.sunsetElev,
  SOLAR_NOON: Z.solarNoon, ALOS_16_1: Z.alos16_1, MISHEYAKIR_10_2: Z.misheyakir10_2,
  ALOS_72: Z.alos72, TZAIS_16_1: Z.tzais16_1, TZAIS_GEONIM_8_5: Z.tzaisGeonim8_5,
  TZAIS_50: Z.tzais50, TZAIS_60: Z.tzais60, TZAIS_72: Z.tzais72,
  MINCHA_GEDOLA: Z.minchaGedola, MINCHA_GEDOLA_LECHUMRA: Z.minchaGedolaLechumra,
  MINCHA_GEDOLA_16_1: Z.minchaGedolaMGA16_1, MINCHA_GEDOLA_30_MINUTES_AFTER_CHATZOS: Z.minchaGedola30MinAfterChatzos,
  MINCHA_KETANA: Z.minchaKetana, SAMUCH_LEMINCHA_KETANA: Z.samuchLeminchaKetana,
  PLAG_HAMINCHA: Z.plagHamincha, SOF_ZMAN_SHMA_GRA: Z.sofZmanShmaGRA,
  SOF_ZMAN_SHMA_MGA_72: Z.sofZmanShmaMGA72, SOF_ZMAN_TFILA_GRA: Z.sofZmanTfilaGRA,
};
const excelName = name => name.replace(/16_1|10_2|8_5/, match => match.replace('_', '.'));
const close = (actual, expected, label) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9,
  `${label}: site ${actual}, workbook ${expected}, difference ${(actual - expected) * 86400} seconds`);
const checkDate = (date, settings, excel) => {
  const serial = excelSerial(date);
  for (const [name, fn] of Object.entries(named)) close(fn(date, settings), excel(excelName(name), serial), name + ' ' + date.toISOString().slice(0, 10));
  const end = excel('TZAIS_72', serial), start = excel('ALOS_16.1', serial);
  close(Z.plagHaminchaCustom(end, start), excel('__PLAG_HAMINCHA', end, omitted, start), 'Custom plag with omitted midday');
  close(Number(Z.dstLocal(date, settings)) / 24, excel('calcDST_LOCAL', serial), 'DST at local midnight');
};

test('Shared zmanim match the original workbook definitions every day of 2026', () => {
  for (const settings of [workbookSettings, liveSettings]) {
    const excel = workbookCalculator(fixture, settings);
    for (let day = 0; day < 365; day++) checkDate(new Date(Date.UTC(2026, 0, 1 + day)), settings, excel);
  }
});

test('Workbook elevation and astronomical chatzos rules match at nonzero elevations', () => {
  for (const elevation of [30, 400]) for (const useElevation of [false, true]) for (const useAstronomicalChatzos of [false, true]) {
    const settings = { ...liveSettings, elevation, useElevation, useAstronomicalChatzos };
    const excel = workbookCalculator(fixture, settings);
    for (const iso of ['2026-01-01', '2026-03-07', '2026-03-08', '2026-06-21', '2026-10-31', '2026-11-01', '2026-12-21']) {
      checkDate(new Date(iso + 'T00:00:00Z'), settings, excel);
    }
  }
});

test('The source formulas explicitly ignore elevation for degree-based zmanim', () => {
  for (const name of ['ALOS_16.1', 'MISHEYAKIR_10.2', 'TZAIS_GEONIM_8.5', 'TZAIS_16.1']) {
    assert.match(fixture.definedNames[name], /,0,_xlpm.timezone\)\)$/);
  }
  assert.equal(fixture.sha256, '64d2c2289a8b359cf1438a79dcaaf1a9798d6f46791e97db3b540e5293185c2f');
  assert(!Object.values(fixture.definedNames).some(formula => /שבת קיץ|שבת חורף/.test(formula)));
});

test('Workbook UTC and local-wall DST boundaries retain the time of day', () => {
  const excel = workbookCalculator(fixture, liveSettings);
  const serial = instant => (instant.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  // Compare both sides of the cutover. Excel's fractional-day arithmetic can differ
  // by a fraction of a microsecond at the exact boundary itself.
  for (const day of ['2026-03-08', '2026-11-01']) for (const hour of [0, 1, 2, 6, 7, 8]) for (const second of [-1, 1]) {
    const instant = new Date(Date.parse(day + 'T00:00:00Z') + hour * 3600000 + second * 1000);
    close(timezoneOffsetUTC(instant, liveSettings.timezone).offsetHours / 24, excel('calcTIMEZONE', serial(instant)), 'UTC DST ' + instant.toISOString());
    close(Number(timezoneOffset(instant, liveSettings.timezone).isDst) / 24, excel('calcDST_LOCAL', serial(instant)), 'Wall-time DST ' + instant.toISOString());
  }
  // The homepage's actual clock continues to use IANA rules, including the repeated fall hour.
  const autumn = shulNow(new Date('2026-11-01T06:30:00Z'), liveSettings);
  assert.equal(autumn.mins, 90);
});

test('Afternoon menus use the clock after the transition Sunday, not at midnight', () => {
  const row = iso => {
    const date = new Date(iso + 'T00:00:00Z');
    return buildWeekdayRow({ date, serial: excelSerial(date), parsha: '' }, liveSettings);
  };
  const autumn = row('2026-11-07'), spring = row('2026-03-14');
  const autumnTimes = autumn.traces.C.filter(time => time.text()).map(time => time.text());
  assert(autumnTimes.some(time => /\b1:00\b/.test(time)), 'The first standard-time week retains the 1:00 Mincha');
  assert(!autumnTimes.some(time => /\b[678]:\d{2}\b/.test(time)), 'Winter has no evening Mincha');
  assert(spring.traces.C.some(time => /\b6:35\b/.test(time.text())), 'Spring evening Mincha returns immediately');
});
