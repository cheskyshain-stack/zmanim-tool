import { dateFromSerial, calcJD, calcJDToJCent, sunDeclination } from './zmanim/solar.js';
import { sunsetElev } from './zmanim/zmanim.js';
import { candleLightingParts } from './sheets/common.js';

const candleZipLocations = new Map();

/** Only the location is read from Hebcal. Times use this site's shared calculation. */
export async function candleZipLocation(zip, signal) {
  if (!/^\d{5}$/.test(zip)) throw new Error('Enter a five-digit U.S. ZIP code.');
  if (candleZipLocations.has(zip)) return candleZipLocations.get(zip);
  const response = await fetch(`https://www.hebcal.com/zmanim?cfg=json&zip=${zip}`, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (response.status === 400 || response.status === 404) throw new Error('That ZIP code was not found. Check it and try again.');
  if (!response.ok) throw new Error('ZIP lookup is unavailable right now. Please try again.');
  let found;
  try { ({ location: found } = await response.json()); }
  catch (error) { if (signal?.aborted) throw error; throw new Error('ZIP lookup is unavailable right now. Please try again.'); }
  if (!found || found.zip !== zip || found.geo !== 'zip'
      || typeof found.title !== 'string' || found.title.length > 160
      || !Number.isFinite(found.latitude) || Math.abs(found.latitude) > 90
      || !Number.isFinite(found.longitude) || Math.abs(found.longitude) > 180
      || typeof found.tzid !== 'string') throw new Error('This ZIP code could not be located. Please try another.');
  // Validate the returned IANA zone rather than falling back to the shul's zone.
  try { new Intl.DateTimeFormat('en-US', { timeZone: found.tzid }).format(); }
  catch { throw new Error('The time zone for this ZIP code could not be found.'); }
  const location = { zip, title: found.title, latitude: found.latitude, longitude: found.longitude, timeZone: found.tzid };
  if (candleZipLocations.size >= 50) candleZipLocations.delete(candleZipLocations.keys().next().value);
  candleZipLocations.set(zip, location);
  return location;
}

export function candleTimeAtLocation(serial, location, settings) {
  const date = dateFromSerial(serial);
  if (!Number.isInteger(serial) || !Number.isFinite(date.getTime())) throw new Error('The candle-lighting date is unavailable.');
  const minutesBefore = Number(settings.candleLightingMinutes ?? 18);
  if (!Number.isFinite(minutesBefore) || minutesBefore < 0 || minutesBefore > 120) throw new Error('The candle-lighting setting is unavailable.');
  // A ZIP identifies an area, not an elevation or the shul's configured coordinates.
  const localSettings = { ...settings, latitude: location.latitude, longitude: location.longitude,
    elevation: 0, useElevation: false, candleLightingMinutes: minutesBefore,
    timezone: { id: location.timeZone, utcOffset: 0, dstOffset: 0, rule: 'none' } };
  const sunsetUTC = sunsetElev(date, localSettings);
  if (!Number.isFinite(sunsetUTC)) throw new Error('No sunset time is available for this ZIP code on this date.');
  // The workbook clamps the hour angle at polar extremes. Such a boundary is not
  // a sunset and must not become a candle-lighting result for a northern ZIP.
  const radians = Math.PI / 180, latitude = location.latitude * radians;
  const declination = sunDeclination(calcJDToJCent(calcJD(serial) + sunsetUTC)) * radians;
  const hourAngleCosine = Math.cos((90 + settings.horizon) * radians) / (Math.cos(latitude) * Math.cos(declination)) - Math.tan(latitude) * Math.tan(declination);
  if (Math.abs(hourAngleCosine) > 1) throw new Error('No sunset time is available for this ZIP code on this date.');
  const sunsetInstant = new Date(date.getTime() + Math.round(sunsetUTC * 86400) * 1000);
  // Resolve the offset at the actual sunset instant, including Arizona, Alaska,
  // territories and DST dates, without changing the workbook's chart timezone rules.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: location.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(sunsetInstant).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  localSettings.timezone.utcOffset = (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - sunsetInstant.getTime()) / 3600000;
  const mins = Math.round(candleLightingParts(date, localSettings).times[0].value * 1440);
  if (!Number.isFinite(mins)) throw new Error('The candle-lighting time could not be calculated.');
  const timeZoneName = new Intl.DateTimeFormat('en-US', { timeZone: location.timeZone, timeZoneName: 'long' })
    .formatToParts(sunsetInstant).find(part => part.type === 'timeZoneName').value;
  const instant = date.getTime() + Math.round((mins - localSettings.timezone.utcOffset * 60) * 60000);
  return { mins, minutesBefore, timeZoneName, dayOffset: Math.floor(mins / 1440), instant };
}
