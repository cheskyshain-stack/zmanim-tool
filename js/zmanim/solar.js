// Solar position core, ported 1:1 from the workbook's calc* LAMBDA functions
// (Lakewood Commons Zmanim tables.xlsx, FUNCTIONS sheet / defined names).
// All "day" values are fractional days (0 = midnight, 0.5 = noon) unless noted.
// Dates are represented as plain UTC-midnight JS Date objects (calendar day only,
// no time-of-day) — the fractional time-of-day for an event is returned separately
// as a number of days, exactly like an Excel serial's fractional part.

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // day 0 in Excel's serial system

/** Excel-style serial date number for a UTC-midnight calendar date (no 1900 leap bug
 *  correction — irrelevant for any date this app will ever be used for). */
export function excelSerial(date) {
  return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EXCEL_EPOCH_UTC) / 86400000;
}

/** Inverse of excelSerial: turns a serial day number back into a UTC-midnight Date. */
export function dateFromSerial(serial) {
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86400000);
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sind = (deg) => Math.sin(deg * D2R);
const cosd = (deg) => Math.cos(deg * D2R);
const tand = (deg) => Math.tan(deg * D2R);
const asind = (x) => Math.asin(x) * R2D;
const acosd = (x) => Math.acos(x) * R2D;

// calcJD
export function calcJD(serial) {
  return serial + 2415018.5;
}
// calcJDToJCent
export function calcJDToJCent(jd) {
  return (jd - 2451545) / 36525;
}
// calcGeomMeanLongSun
function geomMeanLongSun(t) {
  return ((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360 + 360) % 360;
}
// calcGeomMeanAnomalySun
function geomMeanAnomalySun(t) {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}
// calcEccentricityEarthOrbit
function eccentricityEarthOrbit(t) {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}
// calcSunEqOfCenter
function sunEqOfCenter(t) {
  const m = geomMeanAnomalySun(t);
  return sind(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sind(2 * m) * (0.019993 - 0.000101 * t) + sind(3 * m) * 0.000289;
}
// calcSunTrueLong
function sunTrueLong(t) {
  return geomMeanLongSun(t) + sunEqOfCenter(t);
}
// calcSunApparentLong
function sunApparentLong(t) {
  const omega = 125.04 - 1934.136 * t;
  return sunTrueLong(t) - 0.00569 - 0.00478 * sind(omega);
}
// calcMeanObliquityOfEcliptic
function meanObliquityOfEcliptic(t) {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  return 23 + (26 + seconds / 60) / 60;
}
// calcObliquityCorrection
function obliquityCorrection(t) {
  const omega = 125.04 - 1934.136 * t;
  return meanObliquityOfEcliptic(t) + 0.00256 * cosd(omega);
}
// calcSunDeclination
export function sunDeclination(t) {
  const e = obliquityCorrection(t);
  const lambda = sunApparentLong(t);
  return asind(sind(e) * sind(lambda));
}
// calcEquationOfTime (returned in fractional days, matching the workbook's /360)
export function equationOfTime(t) {
  const epsilon = obliquityCorrection(t);
  const long = geomMeanLongSun(t);
  const e = eccentricityEarthOrbit(t);
  const m = geomMeanAnomalySun(t);
  const y = Math.pow(tand(epsilon / 2), 2);
  const sin2long = sind(long * 2);
  const sinm = sind(m);
  const cos2long = cosd(2 * long);
  const sin4long = sind(long * 4);
  const sin2m = sind(m * 2);
  const deg = (y * sin2long - 2 * e * sinm + 4 * e * y * sinm * cos2long - 0.5 * y * y * sin4long - 1.25 * e * e * sin2m) * R2D;
  return deg / 360;
}
// calcHourAngleSunrise (degrees)
function hourAngleSunrise(lat, solarDec, zenith) {
  const cosH = cosd(zenith) / (cosd(lat) * cosd(solarDec)) - tand(lat) * tand(solarDec);
  return acosd(Math.max(-1, Math.min(1, cosH)));
}
// calcRefraction (degrees)
function refraction(altitude) {
  const ta = tand(altitude);
  let arcMin;
  if (altitude > 85) arcMin = 0;
  else if (altitude > 5) arcMin = 58.1 / ta - 0.07 / Math.pow(ta, 3) + 0.000086 / Math.pow(ta, 5);
  else if (altitude > -0.575) arcMin = 1735 + altitude * (-518.2 + altitude * (103.4 + altitude * (-12.79 + altitude * 0.711)));
  else arcMin = -20.774 / ta;
  return arcMin / 3600;
}
// calcElevAdjust
export function elevAdjust(elevationMeters) {
  return acosd(6356.9 / (6356.9 + elevationMeters / 1000));
}
// calcZENITH: horizonDeg is "degrees below the geometric horizon" (workbook default
// 5/6°, i.e. solar radius + average refraction), so the zenith angle is 90 + horizonDeg
// — NOT 90 - horizonDeg. (The workbook stores its SETTINGS horizon cell as -5/6 and its
// calcZENITH negates it back to +5/6 before adding 90; this function takes the
// already-positive, human-readable value directly.)
export function zenith(horizonDeg) {
  return 90 + horizonDeg;
}

// calcSunriseSetUTC: returns fractional day (UTC) for the given Julian day
function sunriseSetUTC(rise, jDay, latitude, longitude, zenithDeg) {
  const t = calcJDToJCent(jDay);
  const eot = equationOfTime(t);
  const solarDec = sunDeclination(t);
  let hourAngle = hourAngleSunrise(latitude, solarDec, zenithDeg); // already in degrees (acosd)
  if (!rise) hourAngle = -hourAngle;
  const delta = longitude + hourAngle;
  return 0.5 - delta / 360 - eot;
}

// calcSunriseSet: two-pass refinement, returns fractional UTC day
function sunriseSet(rise, jDay, latitude, longitude, zenithDeg) {
  const passOne = sunriseSetUTC(rise, jDay + (rise ? -0.25 : 0.25), latitude, longitude, zenithDeg);
  return sunriseSetUTC(rise, jDay + passOne, latitude, longitude, zenithDeg);
}

/** US-style DST rule used throughout the workbook: 2nd Sunday in March (2am) through
 *  1st Sunday in November (2am), local time. Returns true if `date` (UTC-midnight,
 *  representing a local calendar day) falls within DST for that rule. */
function usDstActive(date) {
  const year = date.getUTCFullYear();
  const nthSunday = (y, month, nth) => {
    const first = new Date(Date.UTC(y, month, 1));
    const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
    return new Date(Date.UTC(y, month, firstSunday + (nth - 1) * 7));
  };
  const start = nthSunday(year, 2, 2); // March, 2nd Sunday
  const end = nthSunday(year, 10, 1); // November, 1st Sunday
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

/** calcTIMEZONE / calcDST_LOCAL, simplified to the two DST rule types the workbook
 *  itself implements: 'us' (2nd Sun Mar - 1st Sun Nov) and 'none'.
 *  Returns { offsetHours, isDst } for the given calendar date and a timezone def
 *  { utcOffset, dstOffset, rule } as found in settings.TIMEZONES. */
export function timezoneOffset(date, tz) {
  const isDst = tz.rule === 'us' && usDstActive(date);
  return { offsetHours: tz.utcOffset + (isDst ? tz.dstOffset : 0), isDst };
}

/** calcLATITUDE: clamps to +-89.8 like the workbook (avoids poles blowing up the math). */
export function clampLatitude(lat) {
  return Math.max(-89.8, Math.min(89.8, lat));
}

/**
 * SUNRISE/SUNSET core used by every zman in zmanim.js.
 * @param {boolean} rise true for sunrise, false for sunset
 * @param {Date} date UTC-midnight calendar date
 * @param {number} horizonDeg horizon adjustment in degrees (workbook default 5/6)
 * @param {object} settings {latitude, longitude, elevation, timezone}
 * @param {boolean} useElevation whether to fold elevation into the horizon (SUNRISE_elev/SUNSET_elev pass true only if settings.useElevation)
 * @returns {number} fractional day offset from `date`'s local midnight (e.g. 0.25 = 6:00am)
 */
export function sunEvent(rise, date, horizonDeg, settings, useElevation) {
  const lat = clampLatitude(settings.latitude);
  const lon = settings.longitude;
  const elevM = useElevation ? settings.elevation : 0;
  const z = zenith(horizonDeg) + elevAdjust(elevM);
  const serial = excelSerial(date);
  const eventUTC = sunriseSet(rise, calcJD(serial), lat, lon, z);
  const { offsetHours } = timezoneOffset(dateFromSerial(serial + eventUTC), settings.timezone);
  return eventUTC + offsetHours / 24;
}
