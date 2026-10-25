import test from 'node:test';
import assert from 'node:assert/strict';
import { enableWebsitePreview, isWebsitePreview, websiteNow, websiteLocalFields, websitePreviewInstant, websitePreviewURL } from '../js/website-clock.js';

test('ordinary time and Date remain real while a document preview uses an isolated fixed instant', () => {
  const originalDate = Date, before = Date.now();
  assert(!enableWebsitePreview(''));
  assert(Math.abs(websiteNow().getTime() - Date.now()) < 1000);
  try {
    assert(enableWebsitePreview('?website-preview=2026-12-10T11%3A42%3A00.000Z'));
    assert(isWebsitePreview()); assert.equal(websiteNow().toISOString(), '2026-12-10T11:42:00.000Z');
    const copy = websiteNow(); copy.setUTCFullYear(2000);
    assert.equal(websiteNow().getUTCFullYear(), 2026);
    assert.equal(Date, originalDate); assert(Date.now() >= before);
  } finally { enableWebsitePreview(''); }
  assert(!isWebsitePreview());
});

test('date inputs use the shul timezone across winter, summer and midnight', () => {
  for (const [date, time, expected] of [
    ['2026-12-10', '06:42', '2026-12-10T11:42:00.000Z'],
    ['2026-07-01', '00:00', '2026-07-01T04:00:00.000Z'],
    ['2026-12-31', '23:59', '2027-01-01T04:59:00.000Z'],
  ]) {
    const result = websitePreviewInstant(date, time, 'America/New_York');
    assert.equal(result.instant.toISOString(), expected);
    assert.deepEqual(websiteLocalFields(result.instant, 'America/New_York'), { date, time, second: '00' });
  }
});

test('spring gaps are rejected and a repeated fall time uses its first occurrence', () => {
  assert.throws(() => websitePreviewInstant('2027-03-14', '02:30', 'America/New_York'), /does not occur/);
  const repeated = websitePreviewInstant('2027-11-07', '01:30', 'America/New_York');
  assert.equal(repeated.instant.toISOString(), '2027-11-07T05:30:00.000Z'); assert(repeated.repeated);
});

test('invalid calendar values and preview parameters cannot silently roll to another date', () => {
  for (const [date, time] of [['2026-02-30','12:00'],['2026-13-01','12:00'],['2026-02-01','24:00'],['','12:00']])
    assert.throws(() => websitePreviewInstant(date, time, 'America/New_York'));
  for (const value of ['bad','2026-02-30T12:00:00Z','2026-12-10','2026-12-10T25:00:00Z']) {
    assert(!enableWebsitePreview('?website-preview=' + value)); assert(!isWebsitePreview());
  }
});

test('preview links preserve their page and other query values', () => {
  const url = websitePreviewURL('https://example.org/week/?test=1', new Date('2026-12-10T11:42:00Z'));
  assert.equal(url.pathname, '/week/'); assert.equal(url.searchParams.get('test'), '1');
  assert.equal(url.searchParams.get('website-preview'), '2026-12-10T11:42:00.000Z');
});
