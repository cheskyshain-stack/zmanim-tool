import test from 'node:test';
import assert from 'node:assert/strict';
import { howFar } from '../js/upcoming.js';
import { excelSerial } from '../js/zmanim/solar.js';

const today = minutes => howFar({ in: minutes, daysOff: 0 });

test('same-day countdowns keep remaining minutes and use the correct plural', () => {
  for (const [minutes, text] of [
    [125, 'in 2 hours 5 minutes'], [90, 'in 1 hour 30 minutes'],
    [61, 'in 1 hour 1 minute'], [121, 'in 2 hours 1 minute'],
    [1439, 'in 23 hours 59 minutes'],
  ]) assert.equal(today(minutes), text);
});

test('round up once before splitting hours, omitting zero minutes', () => {
  for (const [minutes, text] of [
    [125.1, 'in 2 hours 6 minutes'], [119.1, 'in 2 hours'],
    [120, 'in 2 hours'], [60, 'in 1 hour'], [59.1, 'in 1 hour'],
    [59, 'in 59 minutes'], [1, 'in 1 minute'], [0.1, 'in 1 minute'],
  ]) assert.equal(today(minutes), text);
});

test('arrival, start grace, and passed candle times retain their wording', () => {
  assert.equal(today(0), 'now');
  assert.equal(today(-1), 'now');
  assert.equal(today(-5), 'now');
  assert.equal(today(-5.1), '');
  assert.equal(howFar(null), '');
});

test('later dates keep their day labels and near-midnight times keep minutes', () => {
  assert.equal(howFar({ in: 125, daysOff: 1 }), 'tomorrow');
  assert.equal(howFar({ in: 10, daysOff: 1 }), 'in 10 minutes');
  assert.equal(howFar({ in: 3000, daysOff: 2,
    serial: excelSerial(new Date('2026-10-12T00:00:00Z')) }), 'Monday');
});
