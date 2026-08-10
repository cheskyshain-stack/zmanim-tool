// Named zman functions, ported 1:1 from the workbook's defined names.
// Every function returns a fractional day (0-1) representing local time-of-day,
// exactly like the Excel formulas do (add to a date's serial to get a date+time).
import { excelSerial, dateFromSerial, calcJD, calcJDToJCent, equationOfTime, sunEvent, timezoneOffset } from './solar.js';

const MIN = 1 / 1440; // one minute, as a fraction of a day

// SUNRISE / SUNSET: horizon adjustable, elevation always applied (matches the workbook
// note: "elevation used in this function will adjust even if the 'use elevation for
// zmanim' setting is set to false").
export function sunrise(date, settings, horizonDeg = settings.horizon) {
  return sunEvent(true, date, horizonDeg, settings, true);
}
export function sunset(date, settings, horizonDeg = settings.horizon) {
  return sunEvent(false, date, horizonDeg, settings, true);
}
// SUNRISE_elev / SUNSET_elev: fixed horizon from settings, elevation only if the
// "use elevation for zmanim" toggle is on.
export function sunriseElev(date, settings) {
  return sunEvent(true, date, settings.horizon, settings, settings.useElevation);
}
export function sunsetElev(date, settings) {
  return sunEvent(false, date, settings.horizon, settings, settings.useElevation);
}

// SOLAR_NOON (true solar noon / astronomical chatzos)
export function solarNoon(date, settings) {
  const lon = settings.longitude / 360;
  const serial = excelSerial(date);
  const jDay = calcJD(serial);
  const tNoon = calcJDToJCent(jDay - lon);
  const eot1 = equationOfTime(tNoon);
  const tNew = calcJDToJCent(jDay - lon - eot1);
  const eot2 = equationOfTime(tNew);
  const noonUTC = 0.5 - lon - eot2;
  const { offsetHours } = timezoneOffset(dateFromSerial(serial + noonUTC), settings.timezone);
  return noonUTC + offsetHours / 24;
}

/** calcDST_LOCAL: whether DST is in effect for the given calendar date under the
 *  current settings' timezone. Exposed for the sheet formulas (they branch on it
 *  directly, e.g. the Friday Mincha/Maariv column). */
export function dstLocal(date, settings) {
  return timezoneOffset(date, settings.timezone).isDst;
}

// Alos / Misheyakir (degree-based, off plain SUNRISE)
export const alos16_1 = (date, settings) => sunrise(date, settings, 16.1);
export const misheyakir10_2 = (date, settings) => sunrise(date, settings, 10.2);

// Tzais (minute/degree-based, off SUNSET/SUNSET_elev)
export const tzais50 = (date, settings) => sunsetElev(date, settings) + 50 * MIN;
export const tzais60 = (date, settings) => sunsetElev(date, settings) + 60 * MIN;
export const tzais72 = (date, settings) => sunsetElev(date, settings) + 72 * MIN;
export const tzaisGeonim8_5 = (date, settings) => sunset(date, settings, 8.5);

// ALOS_72 (used by SOF_ZMAN_SHMA_MGA_72)
export const alos72 = (date, settings) => sunriseElev(date, settings) - 72 * MIN;

/** Shared "proportional day" pattern behind MINCHA_GEDOLA/KETANA, PLAG_HAMINCHA,
 *  SAMUCH_LEMINCHA_KETANA (subtractive, counted back from end of day):
 *  __X(end_of_day, midday, start_of_day) in the workbook. */
function fromEndOfDay(endOfDay, midday, startOfDay, fullDayFraction, halfDayFraction, useAstronomicalChatzos) {
  return endOfDay - (useAstronomicalChatzos ? (endOfDay - midday) * halfDayFraction : (endOfDay - startOfDay) * fullDayFraction);
}
/** Same pattern for SOF_ZMAN_SHMA/TFILA (additive, counted forward from start of day). */
function fromStartOfDay(startOfDay, midday, endOfDay, fullDayFraction, halfDayFraction, useAstronomicalChatzos) {
  return startOfDay + (useAstronomicalChatzos ? (midday - startOfDay) * halfDayFraction : (endOfDay - startOfDay) * fullDayFraction);
}

export function minchaGedola(date, settings) {
  return fromEndOfDay(sunsetElev(date, settings), solarNoon(date, settings), sunriseElev(date, settings), 5.5 / 12, 5.5 / 6, settings.useAstronomicalChatzos);
}
export function minchaGedola30MinAfterChatzos(date, settings) {
  return solarNoon(date, settings) + 30 * MIN;
}
/** MINCHA_GEDOLA_LECHUMRA: __ZMAN_LECHUMRA(latest=TRUE, ...) i.e. the later of the two. */
export function minchaGedolaLechumra(date, settings) {
  return Math.max(minchaGedola(date, settings), minchaGedola30MinAfterChatzos(date, settings));
}
export function minchaKetana(date, settings) {
  return fromEndOfDay(sunsetElev(date, settings), solarNoon(date, settings), sunriseElev(date, settings), 2.5 / 12, 2.5 / 6, settings.useAstronomicalChatzos);
}
export function samuchLeminchaKetana(date, settings) {
  return fromEndOfDay(sunsetElev(date, settings), solarNoon(date, settings), sunriseElev(date, settings), 1 / 4, 1 / 2, settings.useAstronomicalChatzos);
}
export function plagHamincha(date, settings) {
  return fromEndOfDay(sunsetElev(date, settings), solarNoon(date, settings), sunriseElev(date, settings), 1.25 / 12, 1.25 / 6, settings.useAstronomicalChatzos);
}
/** __PLAG_HAMINCHA(end_of_day, <midday omitted>, start_of_day): used directly in the
 *  sheets as __PLAG_HAMINCHA(TZAIS_72(date), , ALOS_16.1(date)) etc. When midday is
 *  omitted the astronomical-chatzos toggle is irrelevant (workbook falls straight
 *  through to the "full day" branch). */
export function plagHaminchaCustom(endOfDay, startOfDay) {
  return endOfDay - (endOfDay - startOfDay) * (1.25 / 12);
}

export function sofZmanShmaGRA(date, settings) {
  return fromStartOfDay(sunriseElev(date, settings), solarNoon(date, settings), sunsetElev(date, settings), 1 / 4, 1 / 2, settings.useAstronomicalChatzos);
}
export function sofZmanShmaMGA72(date, settings) {
  return fromStartOfDay(alos72(date, settings), solarNoon(date, settings), tzais72(date, settings), 1 / 4, 1 / 2, settings.useAstronomicalChatzos);
}
export function sofZmanTfilaGRA(date, settings) {
  return fromStartOfDay(sunriseElev(date, settings), solarNoon(date, settings), sunsetElev(date, settings), 1 / 3, 1 / 1.5, settings.useAstronomicalChatzos);
}
