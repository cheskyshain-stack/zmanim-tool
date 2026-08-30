// Solar position core, ported 1:1 from the workbook's calc* LAMBDA functions
// (Lakewood Commons Zmanim tables.xlsx, FUNCTIONS sheet / defined names).
// All "day" values are fractional days (0 = midnight, 0.5 = noon) unless noted.
// Dates are represented as plain UTC-midnight JS Date objects (calendar day only,
// no time-of-day) - the fractional time-of-day for an event is returned separately
// as a number of days, exactly like an Excel serial's fractional part.

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // day 0 in Excel's serial system

/** Excel-style serial date number for a UTC-midnight calendar date (no 1900 leap bug
 *  correction - irrelevant for any date this app will ever be used for). */
export function excelSerial(date) {
  return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EXCEL_EPOCH_UTC) / 86400000;
}

/** Inverse of excelSerial: turns a serial day number back into a UTC-midnight Date.
 *  Uses Math.floor (not round): every whole-day serial in this app (shabbos/friday
 *  Excel-style day numbers) is already an integer, so floor vs. round makes no
 *  difference there - but the two DST-lookup call sites in this file and zmanim.js
 *  pass a *fractional* serial (a whole day plus a UTC-time-of-day fraction, e.g. an
 *  evening sunset's serial + eventUTC ≈ serial + 0.91). Excel's own calcDST_LOCAL/
 *  calcTIMEZONE formulas extract the calendar day from such a value via YEAR()/DATE()
 *  arithmetic, which truncates (floors) to the day the moment falls in - rounding
 *  instead pushes any evening event (fraction > 0.5) into the *next* calendar day for
 *  DST-lookup purposes. That's harmless almost all year (DST status rarely differs
 *  between adjacent days) but silently breaks the one week each fall where that
 *  rounded-up day crosses the real DST cutover a week early (e.g. an Oct 31 sunset
 *  got misread as Nov 1 - already standard time - undercounting by an hour). */
export function dateFromSerial(serial) {
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * 86400000);
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
// - NOT 90 - horizonDeg. (The workbook stores its SETTINGS horizon cell as -5/6 and its
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

/* Where the shul is, right now, in the frame every zman here is written in: which
   calendar day it is there and how far into it. It lives beside timezoneOffset, the
   only thing it needs, rather than in upcoming.js where it was: upcoming.js reaches
   into the week view, so anything importing it from there dragged the week view along
   and put nav-helpers in a cycle with it. */
/** Where the clock stands at the shul right now, as an Excel serial and minutes into that
 *  day, with the minutes carrying their fraction so the countdown can be scheduled to the
 *  second (see untilNextChange in luach.js).
 *
 *  Read in the shul's own timezone rather than the phone's. Almost everyone looking at this
 *  is in Lakewood and the two are the same, but the board is Lakewood's either way: a phone
 *  still on another zone should be told when מנחה is there, not have the countdown quietly
 *  shifted by however far it has travelled.
 *
 *  Off the platform's own timezone database, by name, and not off the workbook's DST rule
 *  the charts use. That rule answers whether a calendar day is on daylight saving, which is
 *  all a zman ever needs, since no זמן falls in the hour the clocks move. Turning an instant
 *  into a wall clock is a different question and the whole-day answer is wrong on the two
 *  days a year it changes: measured against the tz database, this read 02:30 for 01:30 EST
 *  on 8 March 2026 and 00:30 for 01:30 EDT on 1 November, an hour out from midnight until
 *  the switch at 2am each time.
 *
 *  The arithmetic below is kept as a fallback for a browser with no Intl timezone support
 *  or a settings entry with no name to look up, where being an hour out for two hours a
 *  year is better than not knowing the time at all. */
export function shulNow(now, settings) {
  const zone = settings.timezone?.id;
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(now);
      const at = {};
      for (const part of parts) at[part.type] = part.value;
      const serial = Math.round(
        (Date.UTC(Number(at.year), Number(at.month) - 1, Number(at.day)) - Date.UTC(1899, 11, 30)) / 86400000,
      );
      // hour12: false gives 24 for midnight on some engines, hence the modulo. The
      // milliseconds are added back off the instant itself, since the parts stop at seconds.
      const mins = (Number(at.hour) % 24) * 60 + Number(at.minute)
        + Number(at.second) / 60 + (now.getTime() % 1000) / 60000;
      if (Number.isFinite(serial) && Number.isFinite(mins)) return { serial, mins };
    } catch {
      // No Intl timezone support: fall through to the arithmetic.
    }
  }
  const utcMinutes = now.getTime() / 60000;
  // The offset is looked up for the day the moment falls on, which needs the day, which
  // needs the offset. Standard time first, then again on the day that lands on: an hour
  // either way can only change the answer within an hour of midnight, and the second pass
  // is on the right side of the DST change by then.
  let serial = Math.floor((utcMinutes + settings.timezone.utcOffset * 60) / 1440) + 25569;
  for (let pass = 0; pass < 2; pass++) {
    const { offsetHours } = timezoneOffset(dateFromSerial(serial), settings.timezone);
    const local = utcMinutes + offsetHours * 60;
    const next = Math.floor(local / 1440) + 25569;
    if (next === serial) return { serial, mins: local - Math.floor(local / 1440) * 1440 };
    serial = next;
  }
  const { offsetHours } = timezoneOffset(dateFromSerial(serial), settings.timezone);
  const local = utcMinutes + offsetHours * 60;
  return { serial, mins: local - Math.floor(local / 1440) * 1440 };
}
