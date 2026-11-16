import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsDatedChartName, seatsIsRoomChartName, seatsChartName, seatsCopiedChartName } from '../js/seats/chart-names.js';

test('copy titles remain distinct and keep their suffix within the chart-name limit', () => {
  assert.equal(seatsCopiedChartName('Family seating', [' FAMILY   SEATING (COPY) ', 'Family seating (copy 3)']), 'Family seating (copy 2)');
  const name = 'מ'.repeat(80), first = seatsCopiedChartName(name), next = seatsCopiedChartName(name, [first]);
  assert.equal(first.length, 80); assert.ok(first.endsWith(' (copy)'));
  assert.equal(next.length, 80); assert.ok(next.endsWith(' (copy 2)'));
});

test('dated chart titles use the New York calendar day across midnight and daylight saving', () => {
  assert.equal(seatsDatedChartName(new Date('2026-10-26T02:00:00Z')), 'Seating plan - Oct 25, 2026 at 10:00 PM');
  assert.equal(seatsDatedChartName('2026-10-26T04:00:00Z'), 'Seating plan - Oct 26, 2026 at 12:00 AM');
  assert.equal(seatsDatedChartName('2026-01-03T04:30:00Z'), 'Seating plan - Jan 2, 2026 at 11:30 PM');
  assert.equal(seatsDatedChartName('2026-01-03T05:00:00Z'), 'Seating plan - Jan 3, 2026 at 12:00 AM');
});

test('invalid requested dates fall back to today without accepting null or booleans as dates', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T14:00:00Z') });
  for (const date of [new Date('invalid'), NaN, null, '', false, {}]) {
    assert.equal(seatsDatedChartName(date), 'Seating plan - Oct 26, 2026 at 10:00 AM');
  }
});

test('same-day title collisions are case insensitive and choose the first unused suffix', () => {
  const date = new Date('2026-10-26T14:00:00Z'), base = 'Seating plan - Oct 26, 2026 at 10:00 AM';
  assert.equal(seatsDatedChartName(date, [base.toUpperCase(), base + ' (3)']), base + ' (2)');
  assert.equal(seatsDatedChartName(date, [base, base + ' (2)', base + ' (4)']), base + ' (3)');
  assert.equal(seatsDatedChartName(date, ['  seating   PLAN - Oct 26, 2026 at 10:00 AM  ']), base + ' (2)');
  assert.equal(seatsDatedChartName(date, ['Seating plan - Oct 25, 2026 at 10:00 PM']), base);
});

test('only exact room titles are replaced while custom room-prefixed names stay intact', () => {
  for (const name of ['7:30', '7:30 מנין', '7:30 מניין', '7:30 minyan', ' 7 : 30   MINYAN ', 'Main shul', ' MAIN   SHUL ']) {
    assert.equal(seatsIsRoomChartName(name), true, name);
  }
  for (const name of ['7:30 Yom Kippur reserved', '7:30 minyan family section', '7:30 מנין - Reserved', 'Main shul wedding', '7:45 minyan', 'Custom chart', '']) {
    assert.equal(seatsIsRoomChartName(name), false, name);
  }
  const custom = '  7:30 minyan family section  ';
  assert.equal(seatsChartName(custom, { updatedAt: '2026-01-01T12:00:00Z' }), custom);
});

test('legacy names use a valid last-edit date, then creation date, then today', () => {
  const now = new Date('2026-10-26T14:00:00Z');
  assert.equal(seatsChartName('7:30 מנין', { updatedAt: '2026-01-03T03:00:00Z', createdAt: '2025-12-01T17:00:00Z' }, now), 'Seating plan - Jan 2, 2026 at 10:00 PM');
  assert.equal(seatsChartName('7:30 minyan', { updatedAt: 'invalid', createdAt: '2025-12-01T17:00:00Z' }, now), 'Seating plan - Dec 1, 2025 at 12:00 PM');
  assert.equal(seatsChartName('Main shul', { updatedAt: null, createdAt: false }, now), 'Seating plan - Oct 26, 2026 at 10:00 AM');
  assert.equal(seatsChartName('7:30 minyan', {}, now, ['Seating plan - Oct 26, 2026 at 10:00 AM']), 'Seating plan - Oct 26, 2026 at 10:00 AM (2)');
});
