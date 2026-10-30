import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { candleZipLocation, candleTimeAtLocation } from '../js/candle-lighting-lookup.js';
import { DEFAULT_SETTINGS, resolveSettings, TIMEZONES } from '../js/settings.js';
import { excelSerial } from '../js/zmanim/solar.js';
import { candleLightingParts } from '../js/sheets/common.js';

const locations = JSON.parse(fs.readFileSync(new URL('./fixtures/candle-zip-locations.json', import.meta.url)));
const settings = resolveSettings(DEFAULT_SETTINGS);
const serial = date => excelSerial(new Date(date + 'T00:00:00Z'));
const place = zip => { const l = locations[zip]; return { ...l, timeZone: l.tzid }; };

test('ZIP results retain the established formula across a year and all supported U.S. chart zones', () => {
  const original = JSON.stringify(settings);
  for (const zip of ['08701', '90210', '60601', '99501', '96813']) {
    const location = place(zip), timezone = TIMEZONES.find(zone => zone.id === location.timeZone);
    for (let day = serial('2026-01-01'); day < serial('2027-01-01'); day += 7) {
      const local = { ...settings, ...location, elevation: 0, useElevation: false, timezone };
      const expected = Math.round(candleLightingParts(new Date(Date.UTC(1899, 11, 30) + day * 86400000), local).times[0].value * 1440);
      assert.equal(candleTimeAtLocation(day, location, settings).mins, expected, zip + ': ' + day);
    }
  }
  assert.equal(JSON.stringify(settings), original, 'The shul settings are never changed');
  assert.equal(candleTimeAtLocation(serial('2026-10-30'), place('08701'), settings).mins, 17 * 60 + 38, 'Matches the posted Lakewood time');
});

test('DST changes, Arizona, Hawaii and Puerto Rico use the location date and zone', () => {
  for (const date of ['2026-03-07', '2026-03-08', '2026-10-30', '2026-11-01', '2026-11-06']) {
    for (const zip of ['08701', '85001', '96813', '00901']) {
      const location = place(zip), at = candleTimeAtLocation(serial(date), location, settings);
      const fixed = { ...settings, ...location, elevation: 0, useElevation: false,
        timezone: { id: location.timeZone, utcOffset: zip === '00901' ? -4 : zip === '96813' ? -10 : zip === '85001' ? -7 : date >= '2026-03-08' && date < '2026-11-01' ? -4 : -5, dstOffset: 0, rule: 'none' } };
      const expected = Math.round(candleLightingParts(new Date(date + 'T00:00:00Z'), fixed).times[0].value * 1440);
      assert.equal(at.mins, expected, zip + ': ' + date);
    }
  }
  assert.match(candleTimeAtLocation(serial('2026-10-30'), place('08701'), settings).timeZoneName, /Daylight/);
  assert.match(candleTimeAtLocation(serial('2026-11-06'), place('08701'), settings).timeZoneName, /Standard/);
  assert.match(candleTimeAtLocation(serial('2026-10-30'), place('85001'), settings).timeZoneName, /Standard/);
  const eighteen = candleTimeAtLocation(serial('2026-10-30'), place('08701'), settings);
  assert.equal(candleTimeAtLocation(serial('2026-10-30'), place('08701'), { ...settings, candleLightingMinutes: 30 }).mins, eighteen.mins - 12);
  assert.throws(() => candleTimeAtLocation(serial('2026-06-19'), place('99723'), settings), /No sunset/);
  assert.equal(candleTimeAtLocation(serial('2026-05-01'), place('99723'), settings).dayOffset, 1, 'After-midnight sunset results retain their actual local date');
  assert.throws(() => candleTimeAtLocation(NaN, place('08701'), settings), /date is unavailable/);
});

test('location requests validate ZIPs, omit credentials, cache locations and ignore remote times', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ location: locations['08701'], times: { sunset: '1900-01-01T00:00:00Z' } });
  });
  for (const invalid of ['', '8701', '08701-1234', 'abcde', '123456', '1234/']) await assert.rejects(candleZipLocation(invalid), /five-digit/);
  assert.equal(calls.length, 0);
  const location = await candleZipLocation('08701');
  assert.equal(location.zip, '08701');
  assert.equal(location.timeZone, 'America/New_York');
  assert(!('times' in location));
  assert.equal(await candleZipLocation('08701'), location);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(new URL(calls[0].url).searchParams.get('zip'), '08701');
});

test('unknown ZIPs, service errors and malformed location responses do not return a time', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  response = new Response('', { status: 404 });
  await assert.rejects(candleZipLocation('00000'), /not found/);
  response = new Response('', { status: 429 });
  await assert.rejects(candleZipLocation('00000'), /unavailable/);
  response = new Response('invalid JSON');
  await assert.rejects(candleZipLocation('00000'), /unavailable/);
  for (const changed of [{ zip: '90210' }, { latitude: 100 }, { longitude: '74' }, { geo: 'unknown' }, { title: null }]) {
    response = Response.json({ location: { ...locations['10001'], ...changed } });
    await assert.rejects(candleZipLocation('10001'), /could not be located/);
  }
  response = Response.json({ location: { ...locations['10001'], tzid: 'Invalid/Zone' } });
  await assert.rejects(candleZipLocation('10001'), /time zone/);
});
