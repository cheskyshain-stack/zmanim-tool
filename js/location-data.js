// Local GeoNames postal data and exact geo-tz boundary data. See the bundled
// license notices in assets/location-data/v1/NOTICE.txt.
export const CANDLE_LOCATION_ROOT = '/assets/location-data/v1';
const candleJsonCache = new Map(), candleBoundaryCache = new Map();
let candleDecoderPromise = null;
const candleDataError = () => new Error('Location data could not be loaded. Check your connection and try again.');

function candleAbortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function candleLocalJSON(file, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (candleJsonCache.has(file)) return candleJsonCache.get(file);
  const response = await fetch(`${CANDLE_LOCATION_ROOT}/${file}`, { signal, credentials: 'omit' });
  if (!response.ok) throw candleDataError();
  let data;
  try { data = await response.json(); } catch (error) { if (signal?.aborted) throw error; throw candleDataError(); }
  const valid = file.startsWith('zips/')
    ? data?.version === 1 && data.locations && typeof data.locations === 'object' && !Array.isArray(data.locations)
    : Array.isArray(data?.timezones) && data.lookup && Number.isInteger(data.chunkSize) && data.chunkSize > 0 && Number.isInteger(data.byteLength);
  if (!valid) throw candleDataError();
  candleJsonCache.set(file, data);
  return data;
}

function validateCandleCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180)
    throw new Error('Your location could not be read. Try again or enter a ZIP code.');
}

function validateCandleZone(zone) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error('The time zone for this location is unavailable on this device.'); }
}

export async function localCandleZip(zip, signal) {
  if (!/^\d{5}$/.test(zip)) throw new Error('Enter a five-digit U.S. ZIP code.');
  const data = await candleLocalJSON(`zips/${zip.slice(0, 2)}.json`, signal);
  if (data.version !== 1 || !data.locations || typeof data.locations !== 'object') throw candleDataError();
  const row = data.locations[zip];
  if (!row) throw new Error('That ZIP code was not found. Check it and try again.');
  if (!Array.isArray(row) || row.length !== 5 || typeof row[0] !== 'string' || typeof row[1] !== 'string' || typeof row[4] !== 'string') throw candleDataError();
  const [city, state, latitude, longitude, timeZone] = row;
  validateCandleCoordinates(latitude, longitude); validateCandleZone(timeZone);
  return { zip, title: `${city}, ${state} ${zip}`, latitude, longitude, timeZone };
}

async function candleBoundaryBytes(index, position, length, signal) {
  const first = Math.floor(position / index.chunkSize), last = Math.floor((position + length - 1) / index.chunkSize);
  const chunks = await Promise.all(Array.from({ length: last - first + 1 }, async (_, offset) => {
    const number = first + offset;
    if (candleBoundaryCache.has(number)) return candleBoundaryCache.get(number);
    const response = await fetch(`${CANDLE_LOCATION_ROOT}/timezone-chunks/${String(number).padStart(3, '0')}.bin`, { signal, credentials: 'omit' });
    if (!response.ok) throw candleDataError();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== Math.min(index.chunkSize, index.byteLength - number * index.chunkSize)) throw candleDataError();
    if (candleBoundaryCache.size >= 12) candleBoundaryCache.delete(candleBoundaryCache.keys().next().value);
    candleBoundaryCache.set(number, bytes);
    return bytes;
  }));
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const bytes of chunks) { merged.set(bytes, offset); offset += bytes.length; }
  return merged.subarray(position - first * index.chunkSize, position - first * index.chunkSize + length);
}

async function candleBoundaryDecoder(signal) {
  if (globalThis.CandleGeoDecode) return globalThis.CandleGeoDecode;
  if (!candleDecoderPromise) candleDecoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/location-decode-v1.js';
    script.onload = () => { if (globalThis.CandleGeoDecode) resolve(globalThis.CandleGeoDecode); else { candleDecoderPromise = null; reject(candleDataError()); } };
    script.onerror = () => { script.remove(); candleDecoderPromise = null; reject(candleDataError()); };
    document.head.appendChild(script);
  });
  return candleAbortable(candleDecoderPromise, signal);
}

function candleOceanZones(longitude) {
  if (longitude === 180 || longitude === -180) return ['Etc/GMT+12', 'Etc/GMT-12'];
  const zones = [];
  for (let hours = 12; hours >= -12; hours--) if (longitude >= hours * 15 - 7.5 && longitude <= hours * 15 + 7.5)
    zones.push(hours === 0 ? 'Etc/GMT' : `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`);
  return zones;
}

export async function candleCoordinateZone(latitude, longitude, signal) {
  validateCandleCoordinates(latitude, longitude);
  const originalLongitude = longitude;
  latitude = Math.max(-89.9999, Math.min(89.9999, latitude));
  longitude = Math.max(-179.9999, Math.min(179.9999, longitude));
  const index = await candleLocalJSON('timezone-index.json', signal);
  if (!Array.isArray(index.timezones) || !index.lookup || !Number.isInteger(index.chunkSize) || index.chunkSize <= 0 || !Number.isInteger(index.byteLength)) throw candleDataError();
  let node = index.lookup, top = 89.9999, bottom = -89.9999, left = -179.9999, right = 179.9999, zones;
  for (let depth = 0; depth < 64; depth++) {
    const midLatitude = (top + bottom) / 2, midLongitude = (left + right) / 2;
    const north = latitude >= midLatitude, east = longitude >= midLongitude;
    node = node[north ? (east ? 'a' : 'b') : (east ? 'd' : 'c')];
    if (north) bottom = midLatitude; else top = midLatitude;
    if (east) left = midLongitude; else right = midLongitude;
    if (!node) { zones = candleOceanZones(originalLongitude); break; }
    if (Array.isArray(node)) { zones = node.map(number => index.timezones[number]); break; }
    if (Number.isInteger(node.pos) && Number.isInteger(node.len) && node.pos >= 0 && node.len > 0 && node.pos + node.len <= index.byteLength) {
      const [decoder, bytes] = await Promise.all([candleBoundaryDecoder(signal), candleBoundaryBytes(index, node.pos, node.len, signal)]);
      zones = decoder.zonesInFeatures(bytes, latitude, longitude);
      if (!zones.length) zones = candleOceanZones(originalLongitude);
      break;
    }
    if (typeof node !== 'object') throw candleDataError();
  }
  if (!zones?.length || zones.some(zone => typeof zone !== 'string')) throw candleDataError();
  const canonical = new Set(zones.map(validateCandleZone));
  if (canonical.size !== 1) throw new Error('This location is on a time-zone boundary. Please enter a nearby ZIP code.');
  return zones[0];
}

export async function candleDeviceLocation(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!globalThis.navigator?.geolocation) throw new Error('Location access is unavailable. Please enter a ZIP code.');
  const position = await candleAbortable(new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(error.code === 1
      ? 'Location access was denied. You can enter a ZIP code instead.'
      : error.code === 3 ? 'Finding your location took too long. Try again or enter a ZIP code.'
        : 'Your location could not be found. Try again or enter a ZIP code.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  }), signal);
  const { latitude, longitude } = position.coords;
  return { title: 'Current location', latitude, longitude, timeZone: await candleCoordinateZone(latitude, longitude, signal) };
}
