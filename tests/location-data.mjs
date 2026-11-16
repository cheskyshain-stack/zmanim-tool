import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { localCandleZip, candleCoordinateZone, candleDeviceLocation, CANDLE_LOCATION_ROOT } from '../js/location-data.js';

const root = new URL('../assets/location-data/v1/', import.meta.url);
vm.runInThisContext(fs.readFileSync(new URL('../vendor/location-decode-v1.js', import.meta.url), 'utf8'));
function localFetch(t) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert(url.startsWith(CANDLE_LOCATION_ROOT + '/'), 'Location data stays on this site');
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    requests.push(url);
    return new Response(fs.readFileSync(new URL('../' + url.slice(1), import.meta.url)));
  });
  return requests;
}

test('the complete ZIP snapshot and binary boundary chunks retain their manifest checksums', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
  let count = 0;
  const zones = new Set();
  for (let n = 0; n < 100; n++) {
    const data = JSON.parse(fs.readFileSync(new URL('zips/' + String(n).padStart(2, '0') + '.json', root)));
    for (const [zip, row] of Object.entries(data.locations)) {
      assert(/^\d{5}$/.test(zip)); assert.equal(row.length, 5);
      assert(Number.isFinite(row[2]) && Math.abs(row[2]) <= 90);
      assert(Number.isFinite(row[3]) && Math.abs(row[3]) <= 180);
      zones.add(row[4]); count++;
    }
  }
  assert.equal(count, manifest.zipCount); assert(count > 41000);
  for (const timeZone of zones) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone }).format());
  const hash = crypto.createHash('sha256');
  for (const chunk of manifest.chunks) {
    const bytes = fs.readFileSync(new URL('timezone-chunks/' + chunk.file, root));
    assert.equal(bytes.length, chunk.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), chunk.sha256);
    hash.update(bytes);
  }
  assert.equal(hash.digest('hex'), manifest.boundariesSha256);
});

test('local ZIP data covers Brooklyn, leading zeros and U.S. territories', async t => {
  localFetch(t);
  for (const [zip, city, zone] of [
    ['11214', 'Brooklyn', 'America/New_York'], ['08701', 'Lakewood', 'America/New_York'],
    ['00901', 'San Juan', 'America/Puerto_Rico'], ['96910', 'Hagatna', 'Pacific/Guam'],
    ['96799', 'Pago Pago', 'Pacific/Pago_Pago'],
  ]) { const place = await localCandleZip(zip); assert(place.title.includes(city)); assert.equal(place.timeZone, zone); }
});

test('GPS coordinates resolve exact local boundaries across U.S. border cases and international zones', async t => {
  localFetch(t);
  for (const [latitude, longitude, expected] of [
    [40.068, -74.205, 'America/New_York'], [34.103131, -118.416253, 'America/Los_Angeles'],
    [33.4484, -112.074, 'America/Phoenix'], [36.135, -111.239, 'America/Denver'],
    [35.8367, -110.381, 'America/Phoenix'], [29.8119, -85.303, 'America/New_York'],
    [30.1588, -85.6602, 'America/Chicago'], [31.778, 35.235, 'Asia/Jerusalem'],
    [27.7172, 85.324, 'Asia/Kathmandu'], [51.5, -0.12, 'Europe/London'],
    [-36.85, 174.76, 'Pacific/Auckland'], [13.45, 144.75, 'Pacific/Guam'],
  ]) assert.equal(await candleCoordinateZone(latitude, longitude), expected, latitude + ',' + longitude);
  await assert.rejects(candleCoordinateZone(NaN, 0), /could not be read/);
  await assert.rejects(candleCoordinateZone(0, 181), /could not be read/);
});

test('geolocation is explicit, abortable and handles denied permission without saving settings', async t => {
  localFetch(t);
  let calls = 0, fail = false, pending = false;
  t.mock.getter(globalThis, 'navigator', () => ({ geolocation: { getCurrentPosition(success, error, options) {
    calls++; assert.equal(options.enableHighAccuracy, true);
    if (pending) return;
    if (fail) error({ code: 1 });
    else success({ coords: { latitude: 40.068, longitude: -74.205 } });
  } } }));
  assert.equal(calls, 0);
  const place = await candleDeviceLocation();
  assert.equal(place.title, 'Current location'); assert.equal(place.latitude, 40.068);
  assert.equal(place.timeZone, 'America/New_York'); assert.equal(calls, 1);
  fail = true; await assert.rejects(candleDeviceLocation(), /denied/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(candleDeviceLocation(controller.signal), { name: 'AbortError' });
  assert.equal(calls, 2, 'An aborted request does not ask the browser for location');
  pending = true;
  const next = new AbortController(), request = candleDeviceLocation(next.signal);
  next.abort(); await assert.rejects(request, { name: 'AbortError' });
});
